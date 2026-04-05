"""Help command - list available commands."""
from backend.core.command_handler import register_command, list_commands


@register_command("help", "List all available commands")
def help_command(args: str, context: dict):
    """List available commands."""
    commands = list_commands()

    if not commands:
        return 200, "No commands available."

    lines = ["## Available Commands\n"]
    for cmd in commands:
        lines.append(f"- **/{cmd['name']}** - {cmd['description']}")

    return 200, "\n".join(lines)
