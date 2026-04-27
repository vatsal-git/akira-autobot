# Akira Desktop

An AI-powered desktop assistant with multi-agent architecture for Windows. Built with Electron and React.

## Features

- **Multi-Agent System** - Orchestrator delegates tasks to specialized agents
- **Multi-Provider Support** - OpenRouter, Anthropic (Claude), AWS Bedrock
- **Extended Thinking** - Support for Claude's extended thinking mode with configurable budget
- **Desktop Automation** - Mouse, keyboard, OCR-based UI parsing, screen capture
- **Multiple Widget Modes** - Compact (floating), Sidebar, Window
- **Always-on-top** - Stays visible while working, collapsible to edge tab
- **Persistent Chat History** - Conversations saved across sessions
- **Response Caching** - Caches common responses for faster replies

## Architecture

### Multi-Agent System

The app uses a coordinated agent system:

| Agent | Role |
|-------|------|
| **Orchestrator** | Routes requests to appropriate specialist agents |
| **Desktop Agent** | Mouse/keyboard control, screen capture, OCR, UI automation |
| **File Agent** | Read, write, patch files, list directories |
| **System Agent** | Execute commands, system operations |
| **Web Agent** | Web search, fetch webpage content |
| **Memory Agent** | Store and recall information |

### Tools by Category

**Desktop Automation**
- `desktop_mouse` - Mouse movement, clicks, drag, scroll
- `desktop_keyboard` - Typing, key presses, shortcuts
- `desktop_screen_query` - Screenshot and screen analysis
- `desktop_ui_parse` - OCR-based UI element detection with coordinates
- `desktop_wait` - Delays and condition waiting
- `desktop_diagnose` - Screen/UI state diagnosis
- `windows_uia_*` - Windows UI Automation tools
- `camera_*` - Webcam capture

**File Operations**
- `read_file` - Read file contents
- `write_file` - Write/create files
- `patch_file` - Apply patches to files
- `list_dir` - List directory contents

**Web**
- `web_search` - Search the internet
- `fetch_webpage` - Retrieve webpage content

**Memory**
- `store_memory` - Save information
- `search_memories` - Find stored information
- `list_memories` - List all memories

**System**
- `execute_command` - Run shell commands
- `reload_tools` - Hot-reload tool definitions

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- Windows 10/11

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

This starts both the Vite dev server (frontend) and Electron.

## Build

```bash
npm run build
```

Creates a portable Windows executable in `release/`.

## Configuration

### Provider Setup

1. Launch the app
2. Open Settings (gear icon)
3. Select your provider:
   - **OpenRouter**: Get key at [openrouter.ai/keys](https://openrouter.ai/keys)
   - **Anthropic**: Get key at [console.anthropic.com](https://console.anthropic.com/settings/keys)
   - **AWS Bedrock**: Configure Access Key ID, Secret Key, and region
4. Choose a model
5. (Optional) Configure extended thinking budget for Claude models

### Model Settings

For Claude models with extended thinking:
- **Max Tokens**: Total output token limit (must exceed thinking budget)
- **Thinking Budget**: Tokens allocated for reasoning (min 1024)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Toggle collapse/expand |
| `Enter` | Send message |
| `Shift+Enter` | New line in input |

## Widget Modes

- **Compact** - Small floating window, click corners to relocate
- **Sidebar** - Full-height panel anchored to screen edge
- **Window** - Standard resizable window

## Desktop Automation Workflow

The Desktop Agent follows a strict OCR-based workflow:

1. **Screenshot** → Capture current screen state
2. **UI Parse** → Detect all UI elements with coordinates via OCR
3. **Identify Target** → Find the element to interact with
4. **Get Coordinates** → Resolve exact click position
5. **Perform Action** → Execute mouse/keyboard action
6. **Verify** → Screenshot again to confirm success

This ensures reliable automation by always knowing what's on screen before acting.

## Data Storage

- **Settings**: `%APPDATA%/akira-desktop/akira-settings.json`
- **Chat History**: `%APPDATA%/akira-desktop/akira-chat-history.json`
- **Memories**: Stored via memory agent tools

## Tech Stack

- **Frontend**: React 18, Vite, Framer Motion, React Markdown
- **Backend**: Electron 28, Node.js
- **OCR**: Tesseract.js
- **AI Providers**: OpenRouter, Anthropic API, AWS Bedrock SDK

## License

MIT
