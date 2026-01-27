import os
import json
import uuid
import logging
from datetime import datetime
import streamlit as st
from llm_providers import BaseLLMProvider, AnthropicProvider, OpenAIProvider
from llm_tools import LLM_Tools


class LLM_Service(LLM_Tools):
    def __init__(self, provider_name=None):
        super().__init__()
        self.logger = logging.getLogger(self.__class__.__name__)
        self.logger.info("Initializing LLM_Service")
        self.history_file_path = "akira_history.json"
        self._set_provider(provider_name or "anthropic")

    def _set_provider(self, provider_name: str) -> BaseLLMProvider:
        """Get the appropriate LLM provider based on name"""
        providers = {
            "anthropic": AnthropicProvider,
            # "openai": OpenAIProvider,
            # Add more providers here as needed
        }

        if provider_name.lower() not in providers:
            raise ValueError(
                f"Unsupported provider: {provider_name}. Available providers: {list(providers.keys())}"
            )

        provider_class = providers[provider_name.lower()]

        self.provider = provider_class()

    def get_enabled_tools(self):
        """Get the list of tools that are currently enabled in settings"""
        if (
            hasattr(st, "session_state")
            and "settings" in st.session_state
            and "enabled_tools" in st.session_state.settings
        ):
            # Filter tools based on enabled status
            enabled_tools = []
            for tool in self.tools_def:
                if st.session_state.settings["enabled_tools"].get(tool["name"], True):
                    enabled_tools.append(tool)
            return enabled_tools
        else:
            # Return all tools if settings not available
            return self.tools_def

    def save_to_history(self, message, chat_id=None):
        try:
            # If no chat_id provided, generate a new one
            if chat_id is None:
                chat_id = str(uuid.uuid4())

            # Load existing history or create new structure
            if os.path.exists(self.history_file_path):
                with open(self.history_file_path, "r", encoding="utf-8") as f:
                    history = json.load(f)
            else:
                history = {}

            # Add or update chat entry
            if chat_id not in history:
                history[chat_id] = {
                    "created_at": datetime.now().isoformat(),
                    "messages": [],
                }

            # Add new message to chat
            message_with_timestamp = message.copy()
            message_with_timestamp["timestamp"] = datetime.now().isoformat()
            history[chat_id]["messages"].append(message_with_timestamp)

            self.logger.debug(f"Saving message to chat {chat_id}")

            # Write updated history back to file
            with open(self.history_file_path, "w", encoding="utf-8") as f:
                json.dump(history, f, indent=2, ensure_ascii=False)

            return chat_id
        except Exception as e:
            self.logger.error(f"Error saving history: {e}", exc_info=True)
            return None

    def load_history(self):
        """Load conversation history from file"""
        try:
            if os.path.exists(self.history_file_path):
                with open(self.history_file_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            return {}
        except Exception as e:
            self.logger.error(f"Error loading history: {e}", exc_info=True)
            return {}

    def handle_tool_use(self, messages, tool_content):
        tool_name = tool_content["name"]
        tool_input = tool_content["input"]
        status, tool_result = self.call_tool(tool_name, tool_input)

        if status != 200:
            error_message = f"Some error occured in tool call, please check and refactor: {json.dumps(tool_result)}"
            messages.append(
                {
                    "role": "user",
                    "content": [{"type": "text", "text": error_message}],
                }
            )
            return

        messages.append({"role": "assistant", "content": [tool_content]})
        messages.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_content["id"],
                        "content": json.dumps(tool_result),
                    }
                ],
            }
        )

    def invoke_llm_streaming(
        self, user_message, history=None, max_tokens=4000, temperature=0.7
    ):
        """Streaming version of invoke_llm that yields partial responses and handles multiple tool calls"""
        history = history or []

        # Keep only required message fields
        keys_to_keep = ["role", "content"]
        messages = [{k: d[k] for k in keys_to_keep if k in d} for d in history]

        # Format user message appropriately
        if isinstance(user_message, str):
            messages.append(
                {"role": "user", "content": [{"type": "text", "text": user_message}]}
            )
        else:
            messages.append({"role": "user", "content": user_message})

        full_response = ""
        continue_after_tool = True

        while continue_after_tool:
            continue_after_tool = False  # Reset for this iteration
            current_tool_use = None
            tool_input_json = ""
            in_tool_section = False

            try:
                # Get only enabled tools
                enabled_tools = self.get_enabled_tools()

                # Get streaming response from provider
                for chunk in self.provider.invoke_streaming(
                    messages=messages,
                    tools=enabled_tools,  # Use filtered tools
                    max_tokens=max_tokens,
                    temperature=temperature,
                ):
                    # Handle content_block_delta with text_delta
                    if (
                        chunk.get("type") == "content_block_delta"
                        and chunk.get("delta", {}).get("type") == "text_delta"
                    ):
                        text_chunk = chunk["delta"].get("text", "")
                        full_response += text_chunk
                        yield text_chunk

                    # Handle tool_use (beginning of a tool call)
                    elif (
                        chunk.get("type") == "content_block_start"
                        and chunk.get("content_block", {}).get("type") == "tool_use"
                    ):
                        current_tool_use = chunk.get("content_block")
                        in_tool_section = True
                        tool_input_json = ""  # Reset the JSON accumulator

                        # Format the tool call nicely with emoji and styling
                        tool_msg = f"\n\n🔧 **Using tool: {current_tool_use.get('name', 'unknown')}**\n"
                        full_response += tool_msg
                        yield tool_msg

                    # Handle tool input JSON building
                    elif (
                        chunk.get("type") == "content_block_delta"
                        and chunk.get("delta", {}).get("type") == "input_json_delta"
                        and current_tool_use
                    ):
                        tool_input_json += chunk.get("delta", {}).get(
                            "partial_json", ""
                        )
                        # We don't yield anything here as we're accumulating the JSON

                    # Handle message_delta with stop_reason "tool_use"
                    elif (
                        chunk.get("type") == "message_delta"
                        and chunk.get("delta", {}).get("stop_reason") == "tool_use"
                        and in_tool_section
                    ):
                        tool_input = json.loads(tool_input_json)

                        # Now we have a complete tool call
                        tool_content = {
                            "id": current_tool_use.get("id", "unknown"),
                            "name": current_tool_use.get("name", "unknown"),
                            "input": tool_input,
                            "type": "tool_use",
                        }

                        # Handle the tool use
                        tool_name = tool_content["name"]
                        tool_input = tool_content["input"]

                        # Format the tool execution message nicely
                        tool_exec_msg = f"\n<details>\n<summary>📥 Tool Input: {tool_name}</summary>\n\n```json\n{json.dumps(tool_input, indent=2)}\n```\n\n</details>\n"
                        yield tool_exec_msg
                        full_response += tool_exec_msg

                        # Call the tool with a loading indicator
                        yield "\n⏳ *Processing...*\n"

                        # Call the tool
                        status, tool_result = self.call_tool(tool_name, tool_input)

                        # Add tool use to messages
                        messages.append(
                            {"role": "assistant", "content": [tool_content]}
                        )

                        # Add tool result to messages
                        messages.append(
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": tool_content["id"],
                                        "content": json.dumps(tool_result),
                                    }
                                ],
                            }
                        )

                        # Format the tool result nicely
                        if status == 200:
                            tool_result_msg = f"\n<details>\n<summary>✅ Tool Result</summary>\n\n```json\n{json.dumps(tool_result, indent=2)}\n```\n\n</details>\n"
                        else:
                            tool_result_msg = f"\n<details>\n<summary>❌ Tool Error</summary>\n\n```json\n{json.dumps(tool_result, indent=2)}\n```\n\n</details>\n"

                        yield tool_result_msg
                        full_response += tool_result_msg

                        # Set flag to continue after this tool call
                        continue_after_tool = True

                        # Reset for potential next tool use
                        current_tool_use = None
                        tool_input_json = ""
                        in_tool_section = False

                        # Break the current streaming loop to start a new request with updated messages
                        break

            except Exception as e:
                error_message = f"❌ **Error occurred during LLM invocation:** {e}"
                yield error_message
                full_response += error_message

            # If we need to continue after a tool call
            if continue_after_tool:
                yield "\n\n*Continuing with tool results...*\n\n"

        return full_response

    def chat_based_response(
        self, user_message, history=None, max_tokens=4000, temperature=0, chat_id=None
    ):
        history = history or []

        if not user_message:
            return None, chat_id

        # Save user message to history with the provided chat_id
        chat_id = self.llm_service.save_to_history(
            {"role": "user", "content": user_message}, chat_id
        )

        self.logger.info(f"Generating Chat response for chat_id: {chat_id}")

        try:
            response = self.invoke_llm(user_message, history, max_tokens, temperature)

            self.logger.debug(
                f"Response generated: {response[:100]}..."
            )  # Log first 100 chars

            # Save assistant response with the same chat_id
            self.llm_service.save_to_history(
                {"role": "assistant", "content": response}, chat_id
            )

            return response, chat_id

        except Exception as e:
            self.logger.error(
                f"Error occurred in chat_based_response: {str(e)}", exc_info=True
            )
            error_message = f"Error occurred: {str(e)}"

            # Save error message with the same chat_id
            self.llm_service.save_to_history(
                {"role": "assistant", "content": error_message}, chat_id
            )

            return error_message, chat_id

    def form_based_response(
        self, input1, input2, input3, prompt, max_tokens, temperature
    ):
        self.logger.info("Generating Form response")

        input_data = {
            "input1": input1,
            "input2": input2,
            "input3": input3,
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        try:
            formatted_prompt = prompt.format(
                input1=input1, input2=input2, input3=input3
            )

            response = self.invoke_claude(
                user_message=formatted_prompt,
                max_tokens=max_tokens,
                temperature=temperature,
            )

            self.logger.debug(f"Form response generated: {response[:100]}...")

            self.save_to_history(input_data, response)

            return response

        except Exception as e:
            self.logger.error(
                f"Error occurred in form_based_response: {str(e)}", exc_info=True
            )
            error_message = f"Error occurred: {str(e)}"
            self.save_to_history(input_data, error_message)

            return error_message
