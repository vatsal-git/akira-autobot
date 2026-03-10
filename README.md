# Akira

**Akira** is a full-stack conversational AI assistant platform that combines a pluggable large language model (LLM) backend with a modern chat interface, tool-augmented reasoning, and optional desktop packaging. It is designed for extensibility, multi-provider support, and a consistent user experience across web and native clients.

---

## Overview

Akira provides:

- **Multi-provider LLM integration** — Switch between **OpenRouter** (unified API for many models) and **Anthropic Claude** (via AWS Bedrock) without code changes. Configuration is environment-driven.
- **Tool use (function calling)** — The assistant can invoke a curated set of tools (file I/O, web search, screenshots, system prompt editing, theme control, memory, and more) with streaming tool-call handling and configurable enable/disable per conversation.
- **Streaming chat API** — Server-Sent Events (SSE) for low-latency token streaming, with heartbeat keepalives, configurable timeouts, and support for images and file attachments (including vision-capable models).
- **Conversation history & branching** — Persisted chat history with branch-from-message support for exploring alternative reply paths.
- **Task decomposition** — A dedicated task API that uses the LLM to break high-level goals into a tree of sequential/parallel subtasks and streams plan and execution progress.
- **Customizable system prompt** — The assistant’s base behavior is defined in a Markdown file; the model can read and edit it via tools, enabling self-improvement and persona tuning.
- **Theme & settings** — User-selectable UI themes (persisted via API), plus configurable temperature, max tokens, thinking budget, and tool toggles.
- **Web and desktop** — React + Vite frontend for the browser; Electron wrapper for a desktop app that reuses the same UI and talks to the same backend.

The backend is implemented in **Python** (FastAPI, Pydantic, async streaming); the frontend in **React** with Vite; optional **Electron** app for desktop. All APIs are REST/SSE and can be consumed by other clients.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Clients                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Web (React)  │  │ Electron     │  │ Other API consumers    │ │
│  │ localhost:   │  │ Desktop App  │  │ (curl, scripts, etc.)  │ │
│  │ 5173         │  │              │  │                         │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────┘ │
└─────────┼──────────────────┼───────────────────────┼─────────────┘
          │                  │                       │
          ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend (FastAPI) — http://localhost:8000                       │
│  ┌─────────────────────────────────────────────────────────────┐
│  │  API: /api/chat (SSE), /api/history, /api/task (SSE),         │
│  │       /api/settings, /api/theme, /api/health, /api/ready     │
│  └─────────────────────────────────────────────────────────────┘
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐ │
│  │ LLM Service     │  │ Task Manager    │  │ Tool discovery    │ │
│  │ (streaming,     │  │ (plan + execute │  │ (backend/tools/*) │ │
│  │  tool loops)    │  │  tree)          │  │                   │ │
│  └────────┬────────┘  └────────┬────────┘  └─────────┬──────────┘ │
│           │                     │                     │            │
│  ┌────────▼─────────────────────▼─────────────────────▼──────────┐ │
│  │  Providers: OpenRouter | Anthropic (Bedrock)                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  Persistence: akira_history.json, theme_config.json, screenshots/   │
└─────────────────────────────────────────────────────────────────┘
```

- **Frontend** (`frontend/`): React 18, Vite 5, React Router, Markdown (GFM) rendering, Mermaid diagrams. Uses `/api` proxy in dev to the backend.
- **Backend** (`backend/`): FastAPI app, CORS for dev origins and Electron, rate limiting on chat, static serving of built frontend and screenshots.
- **Desktop** (`desktop/`): Electron loads the same React app (dev server or built `dist`), exposes API base URL via preload; backend must be running separately.

---

## Features in Detail

### LLM providers

| Provider    | Description                    | Configuration (env) |
|------------|--------------------------------|----------------------|
| **OpenRouter** | Single API for many models; auto-ranked model list when `OPENROUTER_API_KEY` is set | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `DEFAULT_MODEL=openrouter`, etc. |
| **Anthropic**  | Claude via AWS Bedrock         | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BEDROCK_ENDPOINT`, `CLAUDE_INFERENCE_PROFILE` |

Default provider is set via `DEFAULT_MODEL` (e.g. `openrouter` or `anthropic`). The frontend can switch provider in settings when the backend exposes `available_providers`.

### Tools (function calling)

Tools are discovered from `backend/tools/`: each module defines `TOOL_DEF` (name, description, input_schema, optional default_enabled) and `call_tool(input, context)`. The LLM service builds provider-specific tool schemas and runs tool loops during streaming.

| Tool                 | Purpose |
|----------------------|--------|
| `read_file`         | Read file contents (optional line range). |
| `write_file`        | Write or append to files; creates parent dirs. |
| `patch_file`        | Apply patch-style edits. |
| `execute_command`   | Run shell commands (use with care). |
| `get_system_prompt` | Return current system prompt from `akira_system_prompt.md`. |
| `edit_system_prompt`| Overwrite system prompt file (self-improvement). |
| `reload_tools`      | Reload tool definitions from `backend/tools` without restart. |
| `web_search`        | Web search (optional API key). |
| `screenshot`        | Capture screen to `screenshots/`. |
| `set_theme`         | Set UI theme (persisted). |
| `adjust_llm_settings`| Change model/settings from within conversation. |
| `store_memory` / `search_memories` / `list_memories` | Persistent memory store. |

Users can enable/disable tools per conversation via the settings UI; the backend injects the active tool list into the system prompt for that request.

### Chat API

- **POST /api/chat** — Body: `message`, optional `chat_id`, `images[]`, `files[]`, `settings` (e.g. temperature, max_tokens, thinking_enabled, thinking_budget, enabled_tools, mood, stream). Response: SSE stream with events `meta`, `delta`, `settings`, `theme`, `done`, `error`. Supports vision (images) and file attachments; text files are inlined into the message.
- **POST /api/chat/branch** — Branch a conversation at a given message index with new content; returns new `chat_id` and messages.
- **GET /api/history** — List chats (metadata only).
- **GET /api/history/{chat_id}** — Full messages for one chat.
- **DELETE /api/history/{chat_id}** — Delete a chat.

### Task API

- **POST /api/task** — Body: `goal`. Streams SSE events: `plan` (task tree), `update` (per-node progress), `done` or `error`. The TaskManager uses the LLM to generate a structured task tree (sequential/parallel/atomic) and then executes nodes, feeding results back into context.

### Other endpoints

- **GET /api/settings** — Default UI settings and bounds (tools, providers, token/temperature/thinking limits).
- **GET /api/theme** — Current theme name for the frontend.
- **GET /api/health** — Liveness.
- **GET /api/ready** — Readiness (history file + provider reachable).
- **GET /api/screenshots/{filename}** — Serve screenshot images (e.g. after screenshot tool).

---

## Prerequisites

- **Python** 3.10+ (backend).
- **Node.js** 18+ (frontend and desktop).
- **API keys / credentials** for at least one LLM provider:
  - **OpenRouter**: [OpenRouter](https://openrouter.ai) API key.
  - **Anthropic (Bedrock)**: AWS credentials and Bedrock endpoint/profile.

---

## Quick start

### 1. Clone and backend

```bash
git clone <repository-url>
cd Akira
```

Create a `.env` in the project root (or backend) with the variables for your chosen provider, for example:

```env
# OpenRouter (default)
OPENROUTER_API_KEY=sk-or-...
DEFAULT_MODEL=openrouter

# Optional: override model, token limits, etc.
# OPENROUTER_MODEL=anthropic/claude-sonnet-4
# MAX_TOKENS=131072
# DEFAULT_TEMPREATURE=0.7
```

For Anthropic via Bedrock:

```env
DEFAULT_MODEL=anthropic
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
CLAUDE_INFERENCE_PROFILE=anthropic.claude-3-5-sonnet-...
# BEDROCK_ENDPOINT=...  # if using a custom endpoint
```

Install backend dependencies and run the API (from project root):

```bash
cd backend
pip install -r requirements.txt
# If requirements omit FastAPI/uvicorn, install: pip install fastapi uvicorn python-dotenv pydantic
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Or from project root:

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### 2. Frontend (web)

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend.

### 3. Desktop (optional)

Backend must be running. From `desktop/`:

```bash
cd desktop
npm install
npm run dev
```

This starts the frontend dev server and launches Electron. For production builds and installers, see [desktop/README.md](desktop/README.md).

---

## Configuration (environment)

Backend behavior is driven by environment variables (e.g. from `.env` at project root). Commonly used:

| Variable | Description | Example |
|----------|-------------|--------|
| `DEFAULT_MODEL` | Default LLM provider | `openrouter`, `anthropic` |
| `OPENROUTER_API_KEY` | OpenRouter API key | `sk-or-...` |
| `OPENROUTER_MODEL` | Preferred OpenRouter model | `anthropic/claude-sonnet-4` |
| `MAX_TOKENS` | Default max output tokens | `131072` |
| `DEFAULT_TEMPREATURE` | Default sampling temperature | `0.7` |
| `THINKING_BUDGET_MIN/MAX` | Bounds for extended thinking | e.g. `1024`, `128000` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | For Anthropic (Bedrock) | — |
| `CLAUDE_INFERENCE_PROFILE` | Bedrock model ID | `anthropic.claude-3-5-sonnet-...` |
| `BEDROCK_ENDPOINT` | Optional custom Bedrock endpoint | — |

Frontend:

- `VITE_API_URL` — Override API base URL (default in dev is often empty and relies on proxy).
- `VITE_BASE_PATH` — Base path for assets (e.g. `./` for Electron).

Desktop:

- `AKIRA_API_URL` — Backend URL (default `http://localhost:8000`).

---

## Project structure

```
Akira/
├── backend/
│   ├── main.py              # FastAPI app, CORS, routes, static mount
│   ├── akira_system_prompt.md
│   ├── akira_history.json    # Persisted chats (created at runtime)
│   ├── api/
│   │   └── routers/         # chat, history, task
│   ├── core/                 # logging, paths, rate_limit, history_store
│   ├── services/
│   │   ├── llm_service.py    # Orchestration, tool loop, history
│   │   ├── llm_providers.py  # OpenRouter, Anthropic (Bedrock)
│   │   ├── llm_tools.py      # Tool discovery, call_tool
│   │   └── task_manager.py  # Plan generation, execution tree
│   ├── tools/                # Tool modules (TOOL_DEF + call_tool)
│   └── scripts/              # e.g. rank_openrouter_models.py
├── frontend/
│   ├── src/
│   │   ├── api/              # chat, history, settings client
│   │   ├── components/       # ChatInput, MessageList, Sidebar, SettingsModal
│   │   ├── config/           # theme
│   │   ├── pages/            # ChatPage, etc.
│   │   └── utils/
│   ├── package.json
│   └── vite.config.js
├── desktop/                  # Electron wrapper (see desktop/README.md)
├── .env                      # Not committed; copy from example if provided
└── README.md                 # This file
```

---

## Development notes

- **Adding a tool**: Add a new `.py` in `backend/tools/` with `TOOL_DEF` and `call_tool`; call the `reload_tools` tool or restart the backend to register it.
- **System prompt**: Edit `backend/akira_system_prompt.md`; the assistant can also read/edit it via tools. Restart or next message picks up file changes.
- **OpenRouter model ranking**: Run `backend/scripts/rank_openrouter_models.py` (with `OPENROUTER_API_KEY` set) to print a ranked list of models.
- **Rate limiting**: Chat endpoint uses an in-memory rate limiter (e.g. 20 requests per minute per key); see `backend/core/rate_limit.py`.

---

## License

See repository license (e.g. MIT in desktop package.json). Use of third-party APIs (OpenRouter, Anthropic, AWS) is subject to their respective terms and pricing.

---

## Summary

Akira is a modular, production-oriented conversational AI stack with multi-provider LLMs, rich tool use, streaming chat, task decomposition, and optional desktop packaging. Configure your preferred provider and API keys, run the backend and frontend (or desktop), and extend behavior via system prompt and pluggable tools in `backend/tools/`.
