# Akira Desktop

An always-on-top AI assistant widget for Windows with multi-agent orchestration, desktop automation, and tool execution capabilities.

## Features

- **Multi-Agent System**: Orchestrator pattern with 5 specialized agents
- **Desktop Automation**: Mouse, keyboard, screenshots, and Windows UI Automation
- **Tool Execution**: File operations, shell commands, web search, memory storage
- **Multiple LLM Providers**: OpenRouter, OpenAI, Anthropic (direct), AWS Bedrock
- **Extended Thinking**: Support for Claude's extended thinking with configurable budgets
- **Widget Modes**: Compact corner widget, sidebar, or windowed mode
- **Chat Persistence**: Saves conversations locally with history browsing
- **Response Caching**: Intelligent caching for repeated queries

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- Windows 10/11 (for full desktop automation features)

### Install Dependencies

```bash
cd akira-desktop
npm install
```

### Run Development Mode

```bash
npm run dev
```

This starts both:
- Vite dev server on `http://localhost:1420` (hot reload for React)
- Electron in development mode (connects to Vite)

You can also run them separately:

```bash
# Terminal 1: Start Vite
npm run dev:vite

# Terminal 2: Start Electron (after Vite is ready)
npm run dev:electron
```

### Build for Production

```bash
npm run build
```

This will:
1. Auto-increment the patch version in `package.json`
2. Build the Vite frontend to `dist/`
3. Package with electron-packager to `release/vX.X.X/`
4. Create a zip file for distribution

Build outputs:
- `release/vX.X.X/Akira-win32-x64/` - Portable folder
- `release/vX.X.X/Akira-vX.X.X-win32-x64.zip` - Distribution zip

### Project Structure

```
akira-desktop/
├── electron/                 # Electron main process
│   ├── main.js              # App entry, window management, IPC handlers
│   ├── preload.js           # Bridge between main and renderer
│   ├── system-prompt.js     # Legacy system prompt
│   ├── agents/              # Multi-agent system
│   │   ├── init.js          # Agent initialization
│   │   ├── index.js         # Agent registry
│   │   ├── base-agent.js    # Base agent class
│   │   ├── orchestrator.js  # Akira orchestrator
│   │   ├── async-task-manager.js
│   │   ├── response-cache.js
│   │   ├── specialists/     # Specialist agents
│   │   │   ├── file-agent.js      # Dobby
│   │   │   ├── system-agent.js    # Vektor
│   │   │   ├── web-agent.js       # Samba
│   │   │   ├── memory-agent.js    # Smriti
│   │   │   └── desktop-agent.js   # BeneGes
│   │   ├── prompts/         # Agent system prompts
│   │   ├── capabilities/    # Agent capability manifests
│   │   ├── control/         # Emergency stop, clarification
│   │   └── task/            # Task parsing and building
│   ├── providers/           # LLM provider adapters
│   │   ├── index.js         # Provider registry
│   │   └── adapter.js       # API call adapter
│   └── tools/               # Tool implementations
│       ├── index.js         # Dynamic tool loader
│       ├── file-operations/ # read, write, patch, list
│       ├── system/          # execute-command, shell-session
│       ├── web/             # web-search, fetch-webpage
│       ├── memory/          # store, search, list, delete
│       ├── desktop-automation/  # mouse, keyboard, screenshot
│       ├── async/           # async task control
│       └── utils/           # PowerShell, Bedrock vision, etc.
├── src/                     # React frontend
│   ├── main.jsx
│   ├── App.jsx
│   ├── components/
│   │   ├── Widget.jsx       # Main widget container
│   │   ├── MessageList.jsx  # Chat messages
│   │   ├── ChatInput.jsx    # Input area
│   │   ├── SettingsPanel.jsx
│   │   ├── AgentActivityChip.jsx
│   │   ├── AlertComponents.jsx
│   │   └── SetupWizard.jsx
│   └── styles/              # CSS files
├── scripts/
│   └── build.js             # Production build script
├── package.json
└── vite.config.js
```

## Architecture

### Multi-Agent System

Akira uses an orchestrator pattern where the main agent (Akira) delegates tasks to specialized agents:

| Agent | Name | Responsibilities |
|-------|------|-----------------|
| **Akira** | Orchestrator | Routes requests, coordinates multi-agent tasks |
| **Dobby** | File Agent | Read, write, patch files; list directories |
| **Vektor** | System Agent | Execute shell commands, manage processes |
| **Samba** | Web Agent | Search the web, fetch webpage content |
| **Smriti** | Memory Agent | Store and recall long-term memories |
| **BeneGes** | Desktop Agent | Mouse, keyboard, screenshots, UI automation |

### Agent Communication

Agents can:
- **Delegate tasks** to other agents with scope constraints
- **Request help** from other agents
- **Escalate** back to the orchestrator
- Run tasks **asynchronously** and await results
- Use **emergency stop** for critical situations

### Task Definitions

Tasks support structured definitions with:
- **Scope**: `do` (required actions) and `dont` (forbidden actions)
- **Output visibility**: `user`, `internal`, or `user-summary`
- **Execution options**: sync/async, priority, clarification budgets

### Provider Support

| Provider | Endpoint | Features |
|----------|----------|----------|
| OpenRouter | openrouter.ai | Auto model selection, many models |
| OpenAI | api.openai.com | GPT-4, GPT-3.5 |
| Anthropic | api.anthropic.com | Claude models, extended thinking |
| AWS Bedrock | AWS SDK | Claude on AWS infrastructure |

## Configuration

### Settings (stored in electron-store)

- **Provider & Model**: Select LLM provider and model
- **Temperature**: Response creativity (0.0 - 1.0)
- **Extended Thinking**: Enable/disable and set token budget
- **Widget Mode**: compact, sidebar, or window
- **Tool Management**: Enable/disable specific tools

### Keyboard Shortcuts

- `Ctrl+Shift+A`: Toggle collapse/expand widget
- Arrow keys (when focused): Move widget position

### Widget Modes

- **Compact**: Small floating widget, positions in screen corners
- **Sidebar**: Full-height panel on left or right edge
- **Window**: Standard resizable window, shows in taskbar

## Tools Reference

### File Operations (Dobby)
- `read_file`: Read file contents with optional line ranges
- `write_file`: Create or overwrite files
- `patch_file`: Search-and-replace edits
- `list_directory`: List directory contents

### System (Vektor)
- `execute_command`: Run shell commands with streaming output
- `shell_session`: Manage working directory and history

### Web (Samba)
- `web_search`: Search the internet
- `fetch_webpage`: Extract content from URLs

### Memory (Smriti)
- `store_memory`: Save information for later
- `search_memories`: Find stored memories
- `list_memories`: List all memories
- `update_memory`: Modify existing memories
- `delete_memory`: Remove memories

### Desktop Automation (BeneGes)
- `desktop_mouse`: Click, drag, scroll, move
- `desktop_keyboard`: Type text, key combinations
- `desktop_screen_query`: Capture and analyze screenshots
- `desktop_ui_parse`: OCR-based UI element detection
- `desktop_wait`: Wait for UI conditions
- `desktop_diagnose`: Debug automation issues
- `windows_uia_*`: Windows UI Automation tools

## License

MIT
