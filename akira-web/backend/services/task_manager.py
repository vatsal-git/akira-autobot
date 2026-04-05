import json
import logging
import asyncio
from enum import Enum
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import uuid


class TaskType(Enum):
    SEQUENTIAL = "sequential"
    PARALLEL = "parallel"
    ATOMIC = "atomic"  # A valid leaf node task


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskResult:
    task_id: str
    status: TaskStatus
    output: str
    error: Optional[str] = None


class TaskNode:
    def __init__(
        self,
        title: str,
        description: str,
        type: TaskType,
        children: List["TaskNode"] = None,
    ):
        self.id = str(uuid.uuid4())
        self.title = title
        self.description = description
        self.type = type
        self.children = children or []
        self.status = TaskStatus.PENDING
        self.result: Optional[TaskResult] = None
        self.output_context = ""  # To store result for parent/siblings

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "type": self.type.value,
            "status": self.status.value,
            "children": [child.to_dict() for child in self.children],
        }


class TaskManager:
    def __init__(self, llm_service):
        self.llm_service = llm_service
        self.logger = logging.getLogger(self.__class__.__name__)

    async def generate_plan(self, goal: str) -> TaskNode:
        """
        Uses the LLM to break down a high-level goal into a tree of tasks.
        """
        self.logger.info(f"Generating plan for goal: {goal}")

        system_prompt = """
        You are an expert Project Manager and System Architect.
        Your goal is to break down a user's complex request into smaller, manageable tasks.
        
        You must output a JSON structure representing the task tree.
        
        The structure should be:
        {
            "title": "Overall Goal",
            "description": "Description of the goal",
            "type": "sequential" | "parallel",
            "children": [
                {
                    "title": "Subtask 1",
                    "description": "Detailed instruction for this subtask",
                    "type": "atomic", 
                    "children": [] 
                },
                {
                    "title": "Subtask Group",
                    "description": "A group of tasks",
                    "type": "sequential" | "parallel",
                    "children": [...]
                }
            ]
        }
        
        Rules:
        1. "atomic" tasks are leaf nodes that perform actual work (queries, code generation, etc.).
        2. "sequential" tasks run their children one after another. Use this when step B depends on step A.
        3. "parallel" tasks run their children at the same time. Use this for independent work.
        4. Be granular but reasonable. don't over-complicate simple requests.
        5. RETURN ONLY THE JSON. No markdown formatting, no explanations.
        """

        # We use a non-streaming invocation for the plan generation to get the full JSON
        # However, our llm_service is mainly streaming. check if we can use a helper or just accumulate.
        # Ideally, we should add a non-streaming method to llm_service or just accumulate.
        # For now, let's use the streaming method and accumulate.

        full_response = ""
        for chunk in self.llm_service._invoke_llm_streaming_sync(
            user_message=f"Break down this goal: {goal}",
            history=[],
            max_tokens=4000,
            temperature=0.2,  # Low temp for structured output
            system_prompt=system_prompt,  # We need to ensure LLM service accepts system prompt override or we prepend it
        ):
            full_response += chunk

        # Clean response (sometimes they wrap in markdown blocks)
        # The response might contain tool logs, so we need to extract the JSON plan.
        try:
            plan_dict = self._extract_json_plan(full_response)
            root_node = self._parse_dict_to_node(plan_dict)
            return root_node
        except Exception as e:
            self.logger.error(f"Failed to parse plan JSON: {e}")
            self.logger.error(f"Response was: {full_response}")
            raise ValueError("Failed to generate a valid plan from LLM.")

    def _extract_json_plan(self, text: str) -> Dict:
        """
        Extracts the JSON plan object from a string that might contain other text and tool logs.
        """
        import re

        # Remove markdown code blocks if present to isolate JSON
        text = text.replace("```json", "").replace("```", "")

        # Find all JSON-like structures (starts with { and ends with })
        # We start from the end to find the plan which is usually last,
        # or we scan for the largest block?
        # A simple stack-based extractor is often more robust than regex for nested JSON

        candidates = []
        stack = []
        start_index = -1

        for i, char in enumerate(text):
            if char == "{":
                if not stack:
                    start_index = i
                stack.append("{")
            elif char == "}":
                if stack:
                    stack.pop()
                    if not stack:
                        # Found a complete JSON object
                        candidate_str = text[start_index : i + 1]
                        candidates.append(candidate_str)

        # Reverse to check the last ones first (plan is usually at the end)
        for candidate in reversed(candidates):
            try:
                data = json.loads(candidate)
                # Verify it looks like a plan
                if isinstance(data, dict) and "children" in data and "type" in data:
                    return data
            except json.JSONDecodeError:
                continue

        raise ValueError("No valid JSON plan found in response")

    def _parse_dict_to_node(self, data: Dict) -> TaskNode:
        task_type = TaskType(data.get("type", "atomic"))
        node = TaskNode(
            title=data.get("title", "Untitled Task"),
            description=data.get("description", ""),
            type=task_type,
        )

        children_data = data.get("children", [])
        for child_data in children_data:
            child_node = self._parse_dict_to_node(child_data)
            node.children.append(child_node)

        return node

    async def execute_plan(self, node: TaskNode, update_callback=None):
        """
        Executes the task tree.
        update_callback: function(node_id, status, result) to notify UI of progress.
        """
        node.status = TaskStatus.RUNNING
        if update_callback:
            update_callback(node)

        self.logger.info(f"Executing Node: {node.title} ({node.type})")

        try:
            if node.type == TaskType.ATOMIC:
                result = await self._execute_atomic_task(node)
                node.output_context = result
                node.status = TaskStatus.COMPLETED

            elif node.type == TaskType.SEQUENTIAL:
                context_so_far = ""
                for child in node.children:
                    # Pass context from previous siblings if needed?
                    # For simplicity, atomic tasks just execute. Complex data passing might need a shared context object.
                    await self.execute_plan(child, update_callback)
                    if child.status == TaskStatus.FAILED:
                        raise Exception(f"Child task {child.title} failed")
                    context_so_far += (
                        f"\nResult of {child.title}: {child.output_context}"
                    )
                node.output_context = context_so_far
                node.status = TaskStatus.COMPLETED

            elif node.type == TaskType.PARALLEL:
                # Run all children concurrently
                tasks = [
                    self.execute_plan(child, update_callback) for child in node.children
                ]
                await asyncio.gather(*tasks)

                # Check for failures
                failed = any(
                    child.status == TaskStatus.FAILED for child in node.children
                )
                if failed:
                    node.status = TaskStatus.FAILED
                else:
                    node.output_context = "\n".join(
                        [
                            f"Result of {c.title}: {c.output_context}"
                            for c in node.children
                        ]
                    )
                    node.status = TaskStatus.COMPLETED

        except Exception as e:
            self.logger.error(f"Task {node.title} failed: {e}")
            node.status = TaskStatus.FAILED
            node.output_context = str(e)

        if update_callback:
            update_callback(node)
        return node.output_context

    async def _execute_atomic_task(self, node: TaskNode) -> str:
        """
        Executes a leaf node task using the LLM.
        """
        self.logger.info(f"Running atomic task: {node.title}")

        # Simple execution: Ask LLM to perform the task
        # Ideally, this should have access to tools.
        # We reuse the llm_service's streaming but capture output.

        prompt = f"""
        Execute this specific task:
        Title: {node.title}
        Description: {node.description}
        
        Return the result clearly.
        """

        full_response = ""
        # We need to call invoke_llm not streaming for easier async handling,
        # OR we wrap the sync generator in a runner.
        # Since llm_service methods are likely blocking (requests), we might blocking the loop if we aren't careful.
        # But 'parallel' implies we want IO concurrency.
        # If llm_service uses 'requests' library synchronously, asyncio.gather won't truly parallelize IO unless we run in executor.

        loop = asyncio.get_event_loop()

        def run_sync_llm():
            response_accum = ""
            for chunk in self.llm_service._invoke_llm_streaming_sync(
                user_message=prompt,
                history=[],  # Atomic tasks currently stateless for simplicity, or we pass a global context
                max_tokens=2000,
            ):
                response_accum += chunk
            return response_accum

        # Run in executor to allow key parallelism if the underlying call is blocking
        full_response = await loop.run_in_executor(None, run_sync_llm)

        return full_response
