import asyncio
import logging
from unittest.mock import MagicMock
from backend.services.task_manager import TaskManager, TaskNode, TaskType, TaskStatus
from backend.services.llm_service import LLM_Service

# Setup logging
logging.basicConfig(level=logging.INFO)


async def test_task_manager():
    print("Testing Task Manager Tool Execution Fix...")

    # Mock LLM Service - THIS IS TRICKY because the error happened deeper in the provider
    # but the fix was in get_enabled_tools.
    # We should instantiate a Real LLM_Service but mock the provider to avoid API calls?
    # Or just verifying get_enabled_tools behavior is enough.

    # Use real LLM Service class structure but mock the provider
    llm_service = LLM_Service()
    llm_service.provider = MagicMock()

    # Verify get_enabled_tools returns correctly filtered keys
    print("Checking get_enabled_tools...")
    tools = llm_service.get_enabled_tools()
    print(f"Tools count: {len(tools)}")

    # Check if 'default_enabled' matches
    for tool in tools:
        if "default_enabled" in tool:
            print(f"FAILURE: 'default_enabled' found in {tool['name']}")
            return
        if "custom" in tool:
            print(f"FAILURE: 'custom' found in {tool['name']}")
            return
        print(f"Tool {tool['name']} OK. Keys: {list(tool.keys())}")

    print("\nSUCCESS: Tools are correctly filtered!")


if __name__ == "__main__":
    asyncio.run(test_task_manager())
