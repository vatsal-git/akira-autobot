import re
import shlex
import subprocess
import logging

logger = logging.getLogger(__name__)

TOOL_DEF = {
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
    "default_enabled": True,
}

DANGEROUS_PATTERNS = [
    r"rm\s+-rf",
    r"deltree",
    r"rmdir\s+/[sS]",
    r"del\s+/[fFsS]",
    r"format",
    r"mkfs",
    r"fdisk",
    r"dd\s+if=",
    r"userdel",
    r"groupdel",
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
    r"system32",
    r"shutdown",
    r"reboot",
    r"init\s+[06]",
    r"halt",
    r"git\s+reset\s+--hard",
    r"git\s+clean\s+-[fd]",
    r"iptables\s+-F",
    r">\s+/dev/sd",
    r">\s+/dev/hd",
    r"chmod\s+-R",
    r"chmod\s+777",
]


def call_tool(tool_input: dict, context=None):
    command = tool_input.get("command", "")
    logger.info("Executing command: %s", command)
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return 500, {
                "error": "Command blocked for security reasons. This command contains potentially destructive operations.",
                "command": command,
                "blocked_pattern": pattern,
            }
    if "|" in command and any(
        re.search(p, command, re.IGNORECASE) for p in DANGEROUS_PATTERNS
    ):
        return 500, {
            "error": "Command blocked for security reasons. Piped command contains potentially destructive operations.",
            "command": command,
        }
    is_windows = hasattr(subprocess, "CREATE_NO_WINDOW")
    try:
        if is_windows:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=True,
                text=True,
            )
        else:
            process = subprocess.Popen(
                shlex.split(command),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
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
