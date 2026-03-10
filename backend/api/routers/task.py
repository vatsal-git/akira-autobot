import json
import asyncio
import logging
import threading
from typing import Any
from queue import Queue, Empty
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class TaskRequest(BaseModel):
    goal: str


def _node_to_dict(node):
    """Serialize a TaskNode tree to a JSON-safe dict."""
    return {
        "id": node.id,
        "title": node.title,
        "description": node.description,
        "type": node.type.value,
        "status": node.status.value,
        "output": node.output_context or "",
        "children": [_node_to_dict(c) for c in node.children],
    }


@router.post("/task")
async def run_task(body: TaskRequest, request: Request):
    """Start a complex task and stream plan + progress updates via SSE."""
    llm: Any = request.app.state.llm_service

    update_queue: Queue = Queue()

    def on_update(node):
        update_queue.put(("update", _node_to_dict(node)))

    def run_in_thread():
        try:
            async def _run():
                plan = await llm.task_manager.generate_plan(body.goal)
                update_queue.put(("plan", _node_to_dict(plan)))
                await llm.task_manager.execute_plan(plan, on_update)
                update_queue.put(("done", _node_to_dict(plan)))

            asyncio.run(_run())
        except Exception as e:
            logger.error(f"Task execution error: {e}", exc_info=True)
            update_queue.put(("error", {"error": str(e)}))

    thread = threading.Thread(target=run_in_thread, daemon=True)
    thread.start()

    def event_stream():
        while True:
            try:
                event_type, payload = update_queue.get(timeout=1.0)
                yield f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
                if event_type in ("done", "error"):
                    break
            except Empty:
                if not thread.is_alive():
                    break
                yield ": keepalive\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream; charset=utf-8")
