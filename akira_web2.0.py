import logging
import os
import json
from datetime import datetime, timedelta
import dotenv
import streamlit as st
from llm_service import LLM_Service
from logger import setup_logging


dotenv.load_dotenv()

# Setup logging
logger = setup_logging()


AVAILABLE_PROVIDERS = ["anthropic"]


class ChatbotUI:
    def __init__(self, llm_service):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.logger.info("Initializing ChatbotUI")
        self.llm_service = llm_service
        self.initialize_session_state()

    def initialize_session_state(self):
        """Initialize the session state variables"""
        session_vars = {
            "messages": [],
            "llm_history": [],
            "current_chat_id": None,
            "sidebar_view": "history",
            "settings": {
                "max_tokens": int(os.getenv("MAX_TOKENS", 131072)),
                "temperature": float(os.getenv("DEFAULT_TEMPREATURE", 0.7)),
                "current_model": os.getenv("DEFAULT_MODEL", "anthropic"),
                "enabled_tools": {
                    tool["name"]: True for tool in self.llm_service.tools_def
                },
                "ollama_model": os.getenv("OLLAMA_MODEL", "llama3"),
            },
        }

        # Initialize session state variables if they don't exist
        for key, default_value in session_vars.items():
            if key not in st.session_state:
                st.session_state[key] = default_value

    def display_sidebar(self):
        """Display the sidebar with navigation tabs"""
        with st.sidebar:
            # Create toggle between History and Settings views
            col1, col2, col3 = st.columns(3)
            with col1:
                history_button_type = (
                    "secondary"
                    if st.session_state.sidebar_view == "history"
                    else "tertiary"
                )
                if st.button(
                    "History", use_container_width=True, type=history_button_type
                ):
                    st.session_state.sidebar_view = "history"
                    st.rerun()

            with col2:
                history_button_type = (
                    "secondary"
                    if st.session_state.sidebar_view == "form"
                    else "tertiary"
                )
                if st.button(
                    "Form", use_container_width=True, type=history_button_type
                ):
                    st.session_state.sidebar_view = "form"
                    st.rerun()

            with col3:
                settings_button_type = (
                    "secondary"
                    if st.session_state.sidebar_view == "settings"
                    else "tertiary"
                )
                if st.button("⚙️", use_container_width=True, type=settings_button_type):
                    st.session_state.sidebar_view = "settings"
                    st.rerun()

            # Display content based on current view
            if st.session_state.sidebar_view == "settings":
                self.display_settings_sidebar()
            elif st.session_state.sidebar_view == "history":
                self.display_history_sidebar()
            else:
                st.markdown("🚧Work In Progress...")

    def display_settings_sidebar(self):
        """Display settings controls in the sidebar"""
        with st.container():
            # Model selection
            st.subheader("Model Settings")

            # Model provider selection
            selected_provider = st.selectbox(
                "Model Provider",
                options=AVAILABLE_PROVIDERS,
                index=AVAILABLE_PROVIDERS.index(
                    st.session_state.settings["current_model"]
                ),
                help="Select which AI model provider to use",
            )

            # If provider changed, update session state
            if selected_provider != st.session_state.settings["current_model"]:
                st.session_state.settings["current_model"] = selected_provider
                self.llm_service._set_provider(selected_provider)
                st.success(f"Switched to {selected_provider} provider")

            # Token and temperature settings
            st.session_state.settings["max_tokens"] = st.slider(
                "Max Tokens",
                min_value=10,
                max_value=int(os.getenv("MAX_TOKENS", 131072)),
                value=st.session_state.settings["max_tokens"],
                step=10,
            )

            st.session_state.settings["temperature"] = st.slider(
                "Temperature",
                min_value=0.0,
                max_value=1.0,
                value=st.session_state.settings["temperature"],
                step=0.1,
                help="Higher values make output more random, lower values more deterministic",
            )

            # Tool settings
            st.subheader("Tool Settings")

            # Initialize tool settings if not present
            if "enabled_tools" not in st.session_state.settings:
                st.session_state.settings["enabled_tools"] = {
                    tool["name"]: True for tool in self.llm_service.tools_def
                }

            # Create toggles for each tool
            for tool in self.llm_service.tools_def:
                tool_name = tool["name"]
                tool_enabled = st.toggle(
                    f"Enable {tool_name}",
                    value=st.session_state.settings["enabled_tools"].get(
                        tool_name, True
                    ),
                    help=f"Toggle {tool['description']}",
                )
                st.session_state.settings["enabled_tools"][tool_name] = tool_enabled

    def display_history_sidebar(self):
        """Display chat history in the sidebar organized by date"""
        if st.button(
            "Start A New Chat",
            help="New chat",
            type="secondary",
            use_container_width=True,
        ):
            self._reset_chat()
            st.rerun()

        # Load history from file
        history_data = self.llm_service.load_history()

        if not history_data:
            st.info("No conversation history found.")
            return

        # Group chats by date
        today = datetime.now().date()
        yesterday = today - timedelta(days=1)

        chat_groups = {"Today": [], "Yesterday": [], "Older": []}

        # Sort and categorize chats
        for chat_id, chat_data in sorted(
            history_data.items(),
            key=lambda x: datetime.fromisoformat(
                x[1].get("last_updated", x[1]["created_at"])
            ),
            reverse=True,
        ):
            last_msg_time = (
                max(
                    datetime.fromisoformat(
                        msg.get("timestamp", chat_data["created_at"])
                    )
                    for msg in chat_data["messages"]
                )
                if chat_data["messages"]
                else datetime.fromisoformat(chat_data["created_at"])
            )

            chat_date = last_msg_time.date()

            if chat_date == today:
                chat_groups["Today"].append((chat_id, chat_data))
            elif chat_date == yesterday:
                chat_groups["Yesterday"].append((chat_id, chat_data))
            else:
                chat_groups["Older"].append((chat_id, chat_data))

        # Display chat groups
        for group_name, chats in chat_groups.items():
            if chats:
                with st.expander(group_name, expanded=(group_name == "Today")):
                    self._render_chat_group(chats)

    def _render_chat_group(self, chats):
        """Render a group of chats in the sidebar"""
        for chat_id, chat_data in chats:
            messages = chat_data["messages"]
            msg_count = len(messages)

            # Get chat title - simplified logic with prioritization
            chat_title = chat_data.get("title")
            if not chat_title and messages:
                content = messages[-1]["content"]
                content = content.replace("```", "").replace("`", "")
                chat_title = f"{content[:18]}{'...' if len(content) > 18 else ''}"

            # Default title if still not set
            if not chat_title:
                chat_title = f"Chat {chat_id[:4]}"

            # Calculate last message time only once
            if messages:
                timestamps = [
                    msg.get("timestamp", chat_data["created_at"]) for msg in messages
                ]
                last_msg_time = max(datetime.fromisoformat(ts) for ts in timestamps)
            else:
                last_msg_time = datetime.fromisoformat(chat_data["created_at"])

            time_display = last_msg_time.strftime("%H:%M")

            is_current = chat_id == st.session_state.current_chat_id
            emphasis = "**" if is_current else ""
            button_label = (
                f"{emphasis}{chat_title} {time_display} ({msg_count}){emphasis}"
            )

            if st.button(button_label, key=f"chat_{chat_id}", type="tertiary"):
                self._load_chat(chat_id, chat_data)

    def _load_chat(self, chat_id, chat_data):
        """Load a selected chat into the current session"""
        self.logger.info(f"Loading chat session: {chat_id}")
        st.session_state.messages = chat_data["messages"].copy()
        st.session_state.llm_history = chat_data["messages"].copy()
        st.session_state.current_chat_id = chat_id
        st.rerun()

    def _reset_chat(self):
        """Reset the current chat session"""
        self.logger.info("Resetting chat session")
        st.session_state.messages = []
        st.session_state.llm_history = []
        st.session_state.current_chat_id = None

    def display_current_chat(self):
        """Display all messages in the current chat"""
        for message in st.session_state.messages:
            avatar = "👤" if message["role"] == "user" else "🐞"
            with st.chat_message(message["role"], avatar=avatar):
                st.markdown(message["content"], unsafe_allow_html=True)

    def handle_user_input(self):
        """Process user input and generate responses"""
        prompt = st.chat_input("Ask Akira")
        if not prompt:
            return

        self.logger.info(f"Received user input: {prompt[:50]}...")

        # Add user message to chat
        timestamp = datetime.now().isoformat()
        user_message = {"role": "user", "content": prompt, "timestamp": timestamp}
        st.session_state.messages.append(user_message)

        # Display user message
        with st.chat_message("user", avatar="👤"):
            st.markdown(prompt)

        # Generate and display assistant response
        with st.chat_message("assistant", avatar="🐞"):
            response_placeholder = st.empty()
            full_response = ""

            try:
                # Stream the response
                for response_chunk in self.llm_service.invoke_llm_streaming(
                    user_message=prompt,
                    history=st.session_state.llm_history,
                    max_tokens=st.session_state.settings["max_tokens"],
                    temperature=st.session_state.settings["temperature"],
                ):
                    full_response += response_chunk
                    response_placeholder.markdown(
                        full_response + "▌", unsafe_allow_html=True
                    )

                # Final update without cursor
                response_placeholder.markdown(full_response, unsafe_allow_html=True)

                # Save chat to history
                chat_id = self.llm_service.save_to_history(
                    user_message, st.session_state.current_chat_id
                )
                st.session_state.current_chat_id = chat_id

                # Save assistant response
                assistant_timestamp = datetime.now().isoformat()
                assistant_message = {
                    "role": "assistant",
                    "content": full_response,
                    "timestamp": assistant_timestamp,
                }

                self.llm_service.save_to_history(assistant_message, chat_id)

                # Update session state
                st.session_state.llm_history.append(user_message)
                st.session_state.llm_history.append(assistant_message)
                st.session_state.messages.append(assistant_message)

                # Update history file
                self.save_chat(chat_id, st.session_state.messages)
                self.logger.info("Request processed successfully. Rerunning app.")
                st.rerun()

            except Exception as e:
                error_message = f"Error occurred: {str(e)}"
                response_placeholder.error(error_message)

                # Save error in history
                if not st.session_state.current_chat_id:
                    chat_id = self.llm_service.save_to_history(user_message, None)
                    st.session_state.current_chat_id = chat_id

                self.llm_service.save_to_history(
                    {
                        "role": "assistant",
                        "content": error_message,
                        "timestamp": datetime.now().isoformat(),
                    },
                    st.session_state.current_chat_id,
                )

    def save_chat(self, chat_id, messages):
        """Save the current chat to history file"""
        history_data = self.llm_service.load_history() or {}

        # Create or update chat data
        if chat_id not in history_data:
            history_data[chat_id] = {
                "created_at": datetime.now().isoformat(),
                "messages": [],
            }

        # Update messages and timestamp
        history_data[chat_id]["messages"] = messages
        history_data[chat_id]["last_updated"] = datetime.now().isoformat()

        # Save to file
        history_file = os.path.join("chat_history", "history.json")
        os.makedirs(os.path.dirname(history_file), exist_ok=True)

        with open(history_file, "w") as f:
            json.dump(history_data, f)

    def run(self):
        """Run the chatbot application"""
        self.display_current_chat()
        self.handle_user_input()
        self.display_sidebar()


@st.cache_resource
def get_llm_service():
    """Get or create a cached instance of LLM_Service"""
    return LLM_Service()


def main():
    """Main function to run the chatbot application"""
    st.set_page_config(
        page_title="Akira",
        page_icon="🐞",
        layout="wide",
        initial_sidebar_state="auto",
    )

    llm_service = get_llm_service()

    if "chatbot_ui" not in st.session_state:
        st.session_state.chatbot_ui = ChatbotUI(llm_service)

    st.session_state.chatbot_ui.run()


if __name__ == "__main__":
    main()
