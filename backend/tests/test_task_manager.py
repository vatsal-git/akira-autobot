import asyncio
import logging
import json
from unittest.mock import MagicMock
from backend.services.task_manager import TaskManager, TaskNode, TaskType, TaskStatus
from backend.services.llm_service import LLM_Service

# Setup logging
logging.basicConfig(level=logging.INFO)


async def test_task_manager():
    print("Testing Task Manager...")

    # Mock LLM Service
    mock_llm_service = MagicMock()

    # Mock invoke_llm_streaming for plan generation
    # It needs to return a generator suitable for the now robust parsing
    def mock_stream_plan(*args, **kwargs):
        mixed_response = """
        Here is the plan for your goal.
        
        <details>
        <summary>Tool Use: web_search</summary>
        **Input**
        ```json
        {"query": "something"}
        ```
        **Output**
        ```json
        {}
        ```
        </details>
        
        The plan is:
        ```json
        {
            "title": "Test Goal",
            "description": "A test goal",
            "type": "sequential",
            "children": [
                {
                    "title": "Task A",
                    "description": "Do A",
                    "type": "atomic",
                    "children": []
                }
            ]
        }
        ```
        """
        yield mixed_response

    def mock_stream_execution(*args, **kwargs):
        yield "OUTPUT_RESULT"

    mock_llm_service._invoke_llm_streaming_sync.side_effect = [
        mock_stream_plan(),  # For generate_plan
        mock_stream_execution(),  # For Task A
    ]

    manager = TaskManager(mock_llm_service)

    # 1. Test Generate Plan
    print("Generating Plan...")
    plan = await manager.generate_plan("Test Goal")
    print(f"Plan Generated: {plan.title} ({plan.type})")
    assert plan.title == "Test Goal"
    assert len(plan.children) == 1

    print("\nSUCCESS: Task Manager JSON Parsing Verified!")


if __name__ == "__main__":
    asyncio.run(test_task_manager())
