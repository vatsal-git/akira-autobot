<p align="center">
  <img src="frontend/public/logo.jpg" alt="Akira Autobot" width="120" height="120" style="border-radius: 20px;">
</p>

<h1 align="center">Akira Autobot</h1>

<p align="center">
  <strong>A self-evolving AI assistant that controls your desktop, writes its own tools, and gets smarter over time</strong>
</p>

<p align="center">
  <a href="#-key-innovations"><img src="https://img.shields.io/badge/AI-Self--Evolving-blueviolet?style=for-the-badge" alt="Self-Evolving AI"></a>
  <a href="#-desktop-automation"><img src="https://img.shields.io/badge/Desktop-Automation-orange?style=for-the-badge" alt="Desktop Automation"></a>
  <a href="#-architecture"><img src="https://img.shields.io/badge/Stack-Full--Stack-blue?style=for-the-badge" alt="Full Stack"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white" alt="Electron">
</p>

<br>

<!-- DEMO GIF PLACEHOLDER -->
<p align="center">
  <img src="docs/demo.gif" alt="Akira Autobot Demo" width="800">
  <br>
  <em>Akira automating desktop tasks with natural language</em>
</p>

---

## What Makes Akira Different?

Most AI assistants are **static** - they do what they're programmed to do. Akira is **dynamic**:

| Traditional AI Assistant | Akira Autobot |
|--------------------------|---------------|
| Fixed set of capabilities | **Writes new tools on demand** |
| Can't interact with your desktop | **Full desktop automation** with multiple fallback strategies |
| Forgets everything between sessions | **Persistent memory** that grows over time |
| Single LLM provider | **Multi-provider** (OpenRouter, Anthropic/Bedrock) |
| Chat-only interface | **Web, Desktop App, Browser Extension, Telegram** |

---

## Key Innovations

### Self-Evolving Architecture

Akira can **modify itself** while running:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SELF-MODIFICATION LOOP                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   User: "I need a tool that can resize images"                  │
│                           │                                     │
│                           ▼                                     │
│   ┌─────────────────────────────────────────┐                   │
│   │  Akira writes new tool:                 │                   │
│   │  backend/tools/media/resize_image.py    │                   │
│   └─────────────────────────────────────────┘                   │
│                           │                                     │
│                           ▼                                     │
│   ┌─────────────────────────────────────────┐                   │
│   │  Hot-reload: Tool available instantly   │                   │
│   │  No server restart required             │                   │
│   └─────────────────────────────────────────┘                   │
│                           │                                     │
│                           ▼                                     │
│   ┌─────────────────────────────────────────┐                   │
│   │  Akira uses the new tool immediately    │                   │
│   └─────────────────────────────────────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**What Akira can modify:**
- **Its own tools** - Create new Python tools that become immediately available
- **System prompt** - Adjust its own personality, capabilities, and behavior guidelines
- **Tool definitions** - Modify schemas, timeouts, and default states
- **Memory** - Build persistent knowledge that survives across sessions

### Desktop Automation

Akira doesn't just chat - it **acts**. Three-tier automation with intelligent fallback:

```
┌────────────────────────────────────────────────────────────────────────┐
│                     DESKTOP AUTOMATION ENGINE                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  TIER 1: Windows UIA (Accessibility API)                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  • Native Windows control access                                 │  │
│  │  • Direct element interaction (buttons, menus, text fields)      │  │
│  │  • Works with: Win32, WPF, most desktop apps                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                         │
│                    ╔═════════╧═════════╗                               │
│                    ║  UIA not working? ║                               │
│                    ╚═════════╤═════════╝                               │
│                              ▼                                         │
│  TIER 2: Vision Parsing (EasyOCR + OmniParser)                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  • Screenshot → AI vision analysis                               │  │
│  │  • OCR for text recognition                                      │  │
│  │  • OmniParser for UI element detection                           │  │
│  │  • Works with: Web apps, Electron, custom UI frameworks          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                         │
│                    ╔═════════╧═════════╗                               │
│                    ║  Parse failed?    ║                               │
│                    ╚═════════╤═════════╝                               │
│                              ▼                                         │
│  TIER 3: Direct Screen Interaction                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  • PyAutoGUI mouse/keyboard control                              │  │
│  │  • Screenshot + LLM reasoning                                    │  │
│  │  • Works with: Anything visible on screen                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**Desktop tools available:**

| Tool | Capability |
|------|------------|
| `windows_uia` | Query accessibility tree, invoke controls, set values |
| `desktop_mouse` | Click, drag, scroll, move cursor |
| `desktop_keyboard` | Type text, press keys, hotkey combinations |
| `desktop_screen_query` | Screenshot, get mouse position, screen size |
| `desktop_ui_parse` | Vision-based UI element detection |
| `desktop_wait` | Intelligent pauses for animations/loading |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Web App     │  │  Desktop     │  │  Browser     │  │  Telegram    │     │
│  │  (React)     │  │  (Electron)  │  │  Extension   │  │  Bot         │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
└─────────┼──────────────────┼──────────────────┼──────────────────┼───────────┘
          │                  │                  │                  │
          └──────────────────┴─────────┬────────┴──────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FASTAPI BACKEND                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                           API LAYER                                    │ │
│  │   POST /api/chat (SSE)  │  GET /api/history  │  POST /api/task (SSE)   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                        │
│  ┌─────────────────┬───────────────┼───────────────┬─────────────────────┐  │
│  │                 │               │               │                     │  │
│  ▼                 ▼               ▼               ▼                     │  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐  │  │
│  │   LLM    │  │   Task   │  │  Memory  │  │     TOOL ENGINE          │  │  │
│  │ Service  │  │ Manager  │  │  Store   │  │  ┌────────────────────┐  │  │  │
│  │          │  │          │  │          │  │  │ File Management    │  │  │  │
│  │ Streaming│  │ Plan +   │  │ Search + │  │  │ Desktop Control    │  │  │  │
│  │ Tool Loop│  │ Execute  │  │ Inject   │  │  │ Internet Search    │  │  │  │
│  └────┬─────┘  └──────────┘  └──────────┘  │  │ Memory Management  │  │  │  │
│       │                                     │  │ System Tools       │  │  │  │
│       ▼                                     │  │ + Hot Reload       │  │  │  │
│  ┌──────────────────────────────────────┐  │  └────────────────────┘  │  │  │
│  │           LLM PROVIDERS              │  └──────────────────────────┘  │  │
│  │  ┌────────────┐    ┌──────────────┐  │                                │  │
│  │  │ OpenRouter │    │  Anthropic   │  │                                │  │
│  │  │ (100+ LLMs)│    │  (Bedrock)   │  │                                │  │
│  │  └────────────┘    └──────────────┘  │                                │  │
│  └──────────────────────────────────────┘                                │  │
│                                                                          │  │
│  ┌──────────────────────────────────────────────────────────────────────┐│  │
│  │  PERSISTENCE: akira_history.json │ akira_memory.json │ screenshots/  ││  │
│  └──────────────────────────────────────────────────────────────────────┘│  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Features

### Multi-Platform Access

| Platform | Description |
|----------|-------------|
| **Web App** | React 18 + Vite 5, PWA support, works offline |
| **Desktop App** | Electron wrapper, native feel, always accessible |
| **Browser Extension** | Chrome sidepanel, context-aware assistance |
| **Telegram Bot** | Chat from anywhere, mobile-friendly |

### Intelligent Chat

- **Streaming responses** with SSE (Server-Sent Events)
- **Markdown rendering** with GitHub-flavored syntax
- **Mermaid diagrams** rendered inline
- **Code blocks** with syntax highlighting
- **Image & file attachments** for vision-capable models
- **Conversation branching** - fork at any message
- **Voice input/output** via Web Speech API

### Tool System

20+ built-in tools across 6 categories:

```
backend/tools/
├── desktop_control/          # Windows automation
│   ├── windows_uia.py        # Accessibility API
│   ├── desktop_mouse.py      # Mouse control
│   ├── desktop_keyboard.py   # Keyboard control
│   ├── desktop_screen_query.py
│   ├── desktop_ui_parse.py   # Vision parsing
│   └── desktop_wait.py
├── file_management/          # Sandboxed file ops
│   ├── read_file.py
│   ├── write_file.py
│   ├── patch_file.py
│   └── list_dir.py
├── internet_search/          # Web capabilities
│   ├── web_search.py
│   └── fetch_webpage.py
├── memory_management/        # Persistent memory
│   ├── store_memory.py
│   ├── search_memories.py
│   └── list_memories.py
├── media_devices/            # Hardware access
│   └── camera_capture.py
└── system_tools/             # Meta operations
    ├── execute_command.py
    └── reload_tools.py       # Hot reload!
```

**Adding a new tool is simple:**

```python
# backend/tools/my_category/my_tool.py

TOOL_DEF = {
    "name": "my_tool",
    "description": "What this tool does",
    "input_schema": {
        "type": "object",
        "properties": {
            "param": {"type": "string", "description": "Parameter description"}
        },
        "required": ["param"]
    }
}

def call_tool(input: dict, context: dict) -> str:
    # Your tool logic here
    return "Result"
```

Then call `reload_tools` or restart - Akira can now use it.

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- API keys for OpenRouter and/or AWS Bedrock

### 1. Clone & Configure

```bash
git clone https://github.com/yourusername/akira-autobot.git
cd akira-autobot
```

Create `.env` in the project root:

```env
# Choose your LLM provider
DEFAULT_MODEL=openrouter

# OpenRouter (access to 100+ models)
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4

# OR Anthropic via AWS Bedrock
# DEFAULT_MODEL=anthropic
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# AWS_REGION=us-east-1
# CLAUDE_INFERENCE_PROFILE=anthropic.claude-3-5-sonnet-...

# Optional settings
PORT=8100
MAX_TOKENS=131072
DEFAULT_TEMPERATURE=0.7
AGI_MODE=1  # Enable memory injection
```

### 2. Start Backend

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8100
```

### 3. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` - you're ready!

### 4. Optional: Desktop App

```bash
cd akira-desktop
npm install
npm run dev
```

### 5. Optional: Telegram Bot

```bash
# Add to .env:
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ALLOWED_USER_IDS=123456789  # Your Telegram user ID

# Run:
python -m backend.telegram_bot
```

---

## Desktop Automation Examples

### Open an app and interact with it

```
User: Open Notepad and type "Hello World"

Akira: I'll help with that.
[Uses windows_uia to find/launch Notepad]
[Uses desktop_keyboard to type the text]
Done! Notepad is open with your text.
```

### Web automation when UIA fails

```
User: Click the "Submit" button on this web form

Akira: The button isn't accessible via UIA (web app). 
Let me use vision parsing instead.
[Uses desktop_ui_parse → get_ui_elements]
[Identifies button coordinates]
[Uses desktop_mouse to click]
Form submitted!
```

### Complex multi-step automation

```
User: Take a screenshot of VS Code, find the Explorer panel, 
and tell me what files are open

Akira: [Uses desktop_screen_query → screenshot]
[Uses desktop_ui_parse to identify VS Code elements]
[Analyzes the explorer panel content]
I can see 3 files open: main.py, utils.py, and README.md
```

---

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend port | `8100` |
| `DEFAULT_MODEL` | LLM provider (`openrouter` / `anthropic`) | `openrouter` |
| `OPENROUTER_API_KEY` | OpenRouter API key | - |
| `OPENROUTER_MODEL` | Model to use | `anthropic/claude-sonnet-4` |
| `MAX_TOKENS` | Max output tokens | `131072` |
| `DEFAULT_TEMPERATURE` | Sampling temperature | `0.7` |
| `AGI_MODE` | Enable memory injection | `false` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | - |
| `TELEGRAM_ALLOWED_USER_IDS` | Allowed Telegram users | - |

---

## Project Structure

```
akira-autobot/
├── backend/
│   ├── server.py              # FastAPI app entry
│   ├── akira_system_prompt.md # AI personality & guidelines
│   ├── api/routers/           # REST endpoints
│   ├── core/                  # Utilities, stores, rate limiting
│   ├── services/              # LLM orchestration, task manager
│   └── tools/                 # Pluggable tool modules
├── frontend/
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── pages/             # Route pages
│   │   └── api/               # API clients
│   └── vite.config.js         # PWA + proxy config
├── akira-desktop/             # Electron app
├── extension/                 # Chrome extension
└── .env                       # Configuration (not committed)
```

---

## Roadmap

- [ ] **Linux/macOS desktop automation** - Currently Windows-only for UIA
- [ ] **Plugin marketplace** - Share and discover community tools
- [ ] **Multi-agent orchestration** - Spawn specialized sub-agents
- [ ] **Local LLM support** - Ollama, llama.cpp integration
- [ ] **Voice-first mode** - Continuous voice conversation
- [ ] **Mobile app** - React Native client

---

## Contributing

Contributions are welcome! Whether it's:

- **New tools** - Add capabilities to `backend/tools/`
- **Bug fixes** - Help make Akira more stable
- **Documentation** - Improve guides and examples
- **Ideas** - Open an issue to discuss features

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Akira Autobot</strong> - Not just an assistant, but an evolving partner
</p>

<p align="center">
  <a href="#quick-start">Get Started</a> •
  <a href="https://github.com/yourusername/akira-autobot/issues">Report Bug</a> •
  <a href="https://github.com/yourusername/akira-autobot/issues">Request Feature</a>
</p>
