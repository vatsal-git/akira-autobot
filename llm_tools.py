import os
import json
import logging
import re
import shlex
import subprocess
import requests
from typing import Dict, Any


class LLM_Tools:
    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.logger.info("Initializing LLM Tools")
        self.tools_def = [
            {
                "name": "web_search",
                "description": "Performs a web search using Google Custom Search API",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query. Make it comprehensive or breif based on requirement.",
                        },
                        "results_count": {
                            "type": "integer",
                            "description": "Number of search results to fetch.",
                        },
                    },
                    "required": ["query", "results_count"],
                },
            },
            {
                "name": "execute_command",
                "description": "Executes non-destructive commands in the system's command prompt/terminal and returns the output. This function has safety restrictions that prevent potentially harmful operations.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The command to execute in the system shell. Must be non-destructive and safe. Commands that delete files/directories, or could otherwise cause data loss are blocked.",
                        }
                    },
                    "required": ["command"],
                },
            },
            {
                "name": "read_file",
                "description": "Read content from any type of file, supporting both text and binary files.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Path to the file to read",
                        }
                    },
                    "required": ["file_path"],
                },
            },
            {
                "name": "write_file",
                "description": "Write content to any type of file, supporting both text and binary files. Write to file only if prompted.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Path to the file to write",
                        },
                        "content": {
                            "type": "string",
                            "description": "Content to write (hex string if binary)",
                        },
                        "mode": {
                            "type": "string",
                            "description": "File mode: 'text' or 'binary'",
                        },
                    },
                    "required": ["file_path", "content"],
                },
            },
        ]
        self.tools_name_list = [tool["name"] for tool in self.tools_def]

    def call_tool(self, tool_name, tool_input):
        self.logger.info(f"Calling tool: {tool_name}")
        self.logger.debug(f"Tool input: {tool_input}")

        try:
            if tool_name == "web_search":
                status, tool_result = self._perform_web_search(
                    tool_input["query"], tool_input.get("results_count")
                )
            elif tool_name == "current_time":
                status, tool_result = self._get_timezone_time(
                    tool_input.get("timezone_name", None)
                )
            elif tool_name == "execute_command":
                status, tool_result = self._execute_command(tool_input["command"])
            elif tool_name == "read_file":
                status, tool_result = 200, self._read_file(tool_input["file_path"])
            elif tool_name == "write_file":
                status, tool_result = 200, self._write_file(
                    tool_input["file_path"],
                    tool_input["content"],
                    tool_input.get("mode", "text"),
                )
            else:
                error_msg = f"No such tool like {tool_name} found. Available tools: {self.tools_name_list}"
                self.logger.warning(error_msg)
                status, tool_result = 500, error_msg

            self.logger.info(f"Tool {tool_name} completed with status {status}")
            self.logger.debug(f"Tool result: {tool_result}")
            return status, tool_result

        except Exception as e:
            self.logger.error(f"Error in tool {tool_name}: {e}", exc_info=True)
            return 500, {"error": str(e), "tool": tool_name}

    def _perform_web_search(self, query: str, results_count) -> Dict[str, Any]:
        self.logger.info(f"Performing web search: {query}")
        self.logger.debug(f"Number of results: {results_count}")

        search_session = requests.Session()
        url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": os.getenv("SEARCH_API_KEY"),
            "cx": os.getenv("SEARCH_ENGINE_ID"),
            "q": query,
            "num": results_count or 5,
        }

        try:
            response = search_session.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                search_results = set()
                websites_searched = set()

                if "items" in data:
                    for item in data["items"]:
                        # Extract the display link (website domain)
                        if "displayLink" in item:
                            websites_searched.add(item.get("displayLink", ""))

                        search_results.add(
                            json.dumps(
                                {
                                    "title": item.get("title", ""),
                                    "snippet": item.get("snippet", ""),
                                }
                            )
                        )

                self.logger.info(
                    f"Search completed successfully, found {len(search_results)} results"
                )
                return 200, {
                    "search_results": list(search_results),
                    "websites_searched": list(websites_searched),
                }

            else:
                error_msg = f"Search API returned status code {response.status_code}"
                self.logger.error(error_msg)
                return 500, error_msg
        except Exception as e:
            self.logger.error(f"Error in web search: {e}", exc_info=True)
            return 500, str(e)

    def _execute_command(self, command: str) -> Dict[str, Any]:
        self.logger.info(f"Executing Command: {command}")

        # List of dangerous commands and patterns to block
        dangerous_patterns = [
            # Delete/remove commands
            r"rm\s+-rf",
            r"deltree",
            r"rmdir\s+/[sS]",
            r"del\s+/[fFsS]",
            # Format commands
            r"format",
            # System modification
            r"mkfs",
            r"fdisk",
            r"dd\s+if=",
            # User management that could be destructive
            r"userdel",
            r"groupdel",
            # Specific dangerous paths
            r"/usr",
            r"/etc",
            r"/var",
            r"/home",
            r"/root",
            r"/boot",
            r"/bin",
            r"/sbin",
            r"C:\\Windows",
            r"C:\\Program Files",
            r"C:\\System",
            # Wildcards with system directories
            r"system32",
            # Shutdown/reboot commands
            r"shutdown",
            r"reboot",
            r"init\s+[06]",
            r"halt",
            # Destructive git commands
            r"git\s+reset\s+--hard",
            r"git\s+clean\s+-[fd]",
            # Network dangerous commands
            r"iptables\s+-F",
            # Dangerous bash constructs
            r">\s+/dev/sd",
            r">\s+/dev/hd",
            # Chmod recursive on system directories
            r"chmod\s+-R",
            r"chmod\s+777",
        ]

        try:
            # Check if command contains dangerous patterns
            for pattern in dangerous_patterns:
                if re.search(pattern, command, re.IGNORECASE):
                    return 500, {
                        "error": "Command blocked for security reasons. This command contains potentially destructive operations.",
                        "command": command,
                        "blocked_pattern": pattern,
                    }

            # Block commands with pipe to dangerous operations
            if "|" in command and any(
                re.search(pattern, command, re.IGNORECASE)
                for pattern in dangerous_patterns
            ):
                return 500, {
                    "error": "Command blocked for security reasons. Piped command contains potentially destructive operations.",
                    "command": command,
                }

            is_windows = hasattr(subprocess, "CREATE_NO_WINDOW")

            if is_windows:
                # On Windows, use shell=True for commands like 'dir'
                process = subprocess.Popen(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    shell=True,
                    text=True,
                )
            else:
                # On Unix-like systems, avoid shell=True for better security
                process = subprocess.Popen(
                    shlex.split(command),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )

            # Get the output and error
            stdout, stderr = process.communicate(timeout=30)
            return_code = process.returncode

            return 200, {
                "stdout": stdout,
                "stderr": stderr,
                "return_code": return_code,
                "command": command,
                "success": return_code == 0,
            }

        except subprocess.TimeoutExpired:
            # Kill the process if it takes too long
            process.kill()
            stdout, stderr = process.communicate()
            return 500, {
                "error": "Command timed out after 30 seconds",
                "partial_stdout": stdout,
                "partial_stderr": stderr,
                "command": command,
            }
        except Exception as e:
            return 500, {"error": str(e), "command": command}

    def _read_file(self, file_path):
        """
        Read content from any type of file.

        Args:
            file_path (str): Path to the file to read

        Returns:
            dict: Dictionary containing file content and metadata
        """
        try:
            # First try to read as text
            try:
                with open(file_path, "r", encoding="utf-8") as file:
                    content = file.read()
                    file_type = "text"
            except UnicodeDecodeError:
                # If not text, read as binary
                with open(file_path, "rb") as file:
                    content = file.read()
                    content = (
                        content.hex()
                    )  # Convert binary to hex string for safe handling
                    file_type = "binary"

            stats = os.stat(file_path)

            self.logger.info(f"Successfully read file: {file_path}")
            self.logger.debug(f"File size: {stats.st_size} bytes, Type: {file_type}")
            return {
                "success": True,
                "content": content,
                "file_type": file_type,
                "size": stats.st_size,
                "path": file_path,
                "filename": os.path.basename(file_path),
            }

        except Exception as e:
            self.logger.error(f"Error reading file {file_path}: {e}", exc_info=True)
            return {"success": False, "error": str(e), "path": file_path}

    def _write_file(self, file_path, content, mode="text"):
        """
        Write content to any type of file.

        Args:
            file_path (str): Path to the file to write
            content (str): Content to write (hex string if binary)
            mode (str): 'text' or 'binary'

        Returns:
            dict: Dictionary containing operation result
        """
        try:
            if mode.lower() == "text":
                with open(file_path, "w", encoding="utf-8") as file:
                    file.write(content)
            elif mode.lower() == "binary":
                # Convert hex string back to binary
                binary_data = bytes.fromhex(content)
                with open(file_path, "wb") as file:
                    file.write(binary_data)
            else:
                return {
                    "success": False,
                    "error": f"Invalid mode: {mode}. Use 'text' or 'binary'.",
                    "path": file_path,
                }

            import os

            self.logger.info(f"Successfully wrote to file: {file_path}")
            return {
                "success": True,
                "path": file_path,
                "size": os.path.getsize(file_path),
                "filename": os.path.basename(file_path),
            }

        except Exception as e:
            self.logger.error(f"Error writing to file {file_path}: {e}", exc_info=True)
            return {"success": False, "error": str(e), "path": file_path}
