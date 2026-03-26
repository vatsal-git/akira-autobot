# Akira

**Akira** is a full-stack conversational AI assistant: a **FastAPI** backend with multi-provider LLMs, streaming tool use, and a **React + Vite** chat UI (optional **Electron** desktop). It is built for extensibility, provider switching, and a polished day-to-day chat experience—including markdown, diagrams, attachments, and voice.

---

## Resume-ready project summary

Use the bullets below (tweak wording to first person) on a resume, LinkedIn, or portfolio. They reflect what the project implements end to end.

### Product and scope

- Owned an **AI chat product** from API design through UI: streaming conversations, multi-chat history, settings, branching, task planning, and optional voice and camera input.
- Delivered a **multi-provider LLM layer** so one codebase talks to **OpenRouter** (many models, one HTTP API) and **Anthropic Claude via AWS Bedrock**, including streaming responses and **function calling / tool loops** across providers.

### Backend (Python)

- Built a **FastAPI** service with **REST + Server-Sent Events (SSE)** for low-latency token streaming, **heartbeat keepalives**, a **long stream timeout** (10 minutes), and **stop/cancel** behavior when the client aborts.
- Implemented **Pydantic** request models with validation: max message length, image/file **count and size** limits, **UUID** `chat_id` enforcement, and safe **base64** handling for attachments.
- Designed a **pluggable tool system**: Python modules under `backend/tools/` export `TOOL_DEF` + `call_tool`; tools are **discovered at runtime** and can be **reloaded without restarting** the server.
- Ran tool handlers in a **bounded thread pool** with **configurable timeouts** (request-level, per-tool defaults, and optional per-invocation caps).
- Persisted conversations to **JSON** with **cross-platform file locking** (Windows `msvcrt` / Unix `fcntl`) and **atomic writes** to avoid corrupted history under concurrent access.
- Implemented **branch-from-message**: fork a chat at a given index with new user content and a new `chat_id`.
- Added **in-memory rate limiting** on chat (e.g. requests per minute per IP or `X-User-ID`).
- Built a **long-term memory** store (`akira_memory.json`) with **search** and lock-safe updates; **AGI mode** optionally **injects relevant memories** into the system prompt from the user’s latest message.
- Implemented a **TaskManager** that asks the LLM for a **JSON task tree** (sequential / parallel / leaf tasks), then **executes** it asynchronously while **streaming progress** over SSE.
- Hardened **file tools** with a **workspace root**, **path canonicalization**, **traversal checks**, **blocked paths** (e.g. `.git`, `node_modules`), and **atomic** text writes.
- Loaded the assistant **system prompt from Markdown** on disk with an **in-code fallback**; merged an **authoritative list of enabled tools** into the prompt so capability answers stay consistent with what is actually exposed.
- Injected **per-message timestamps** (`[Sent at: …]`) into content so the model can reason about timing across a long thread.
- Added **autonomous mode** logic: when the user is idle, the backend can prompt the model for a **proactive thought or tool use** (with a **no-op** path when there is nothing useful to do).
- Exposed **health** (`/api/health`) and **readiness** (`/api/ready`) checks; served **built static frontend** from the same process in production; exposed **secure filename-only** serving for **PNG screenshots** under `/api/screenshots/`.
- Centralized **logging** and **environment-driven** defaults (temperature, token limits, thinking budget bounds, optional **AGI_MODE**, default provider).
- Wrote **automated tests** around task tooling and **tool schema filtering** (e.g. ensuring API-facing tool definitions do not leak internal fields).

### Frontend (React / JavaScript)

- Implemented the chat app with **React 18**, **Vite 5**, **React Router**, **react-markdown** + **remark-gfm** for **GitHub-flavored markdown**.
- Built **rich assistant rendering**: fenced **code blocks** with dedicated UI, **collapsible “thinking”** and **tool-use** sections (streaming-safe parsing), and **Mermaid** diagrams with **theme variables** tied to CSS custom properties.
- Delivered **multi-image** and **generic file** attachments, wired to the same limits as the backend, for **vision** and text-file context.
- Consumed SSE in the client with **`AbortController`** for **stop generation**, plus handlers for **meta**, **delta**, **settings**, **done**, and **error** events.
- Created a **settings** surface: provider, **temperature**, **max tokens**, **extended thinking** toggle and **budget**, **per-tool toggles**, **stream vs buffer** mode, **autonomous mode**, and **light/dark appearance**—with **localStorage** persistence for user preferences.
- Integrated **Web Speech API** for **dictation** and **text-to-speech** (voice conversation mode) where the browser supports it.
- Added **camera capture** for attaching live photos to messages.
- Used **audio feedback** when a response completes (optional UX polish).
- Configured **vite-plugin-pwa** and **Workbox**: **web app manifest**, **service worker**, **offline shell**, and **runtime caching** for Google Fonts.
- Set up a **dev proxy** from the Vite server to the API; supported **configurable API base URL** for packaged or alternate deployments (e.g. Electron).

### Desktop and tooling

- Packaged or documented an **Electron** app that **reuses the same React UI** and points at a configurable backend URL (see `desktop/README.md`).
- Authored a **script** to **rank OpenRouter models** (with optional cached JSON output) to inform default model choices.

### Architecture and API design

- Treated the backend as the **single source of truth** for **tool definitions** and **provider capabilities**, while keeping the UI **stateless** aside from local preferences and appearance.
- Used **SSE** instead of WebSockets for **simple, firewall-friendly** streaming with standard HTTP infrastructure.

---

## Overview

Akira provides:

- **Multi-provider LLM integration** — Switch between **OpenRouter** and **Anthropic (Bedrock)** using environment and UI settings.
- **Tool use (function calling)** — Curated tools under `backend/tools/`; streaming tool rounds; per-conversation enable/disable from the UI; authoritative tool list injected into the system prompt.
- **Streaming chat API** — SSE with heartbeats and timeouts; images and file attachments for vision-capable models.
- **Conversation history and branching** — JSON persistence with locking; branch from a message with new content.
- **Task decomposition** — Task API streams a plan (task tree) and execution updates.
- **Customizable system prompt** — Markdown file on the server; service APIs to read/write programmatically (`LLM_Service`); fallback prompt in code if the file is missing.
- **Appearance and settings** — Light/dark UI (client-side, persisted locally); temperature, max tokens, thinking budget, tools, stream mode, autonomous mode via settings API + localStorage.
- **Web and desktop** — React + Vite for the browser; PWA support; Electron option for desktop.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Clients                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Web (React)  │  │ Electron     │  │ Other API consumers    │ │
│  │ (Vite dev)   │  │ Desktop App  │  │ (curl, scripts, etc.)  │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────┘ │
└─────────┼──────────────────┼───────────────────────┼─────────────┘
          │                  │                       │
          ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend (FastAPI) — default PORT from env (see Quick start)       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  API: /api/chat (SSE), /api/history, /api/task (SSE),       │ │
│  │       /api/settings, /api/health, /api/ready,               │ │
│  │       /api/screenshots/{filename}                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐ │
│  │ LLM Service     │  │ Task Manager    │  │ Tool discovery   │ │
│  │ (streaming,     │  │ (plan + execute │  │ (backend/tools)  │ │
│  │  tool loops)    │  │  task tree)     │  │                  │ │
│  └────────┬────────┘  └────────┬────────┘  └─────────┬────────┘ │
│           │                     │                     │            │
│  ┌────────▼─────────────────────▼─────────────────────▼──────────┐ │
│  │  Providers: OpenRouter | Anthropic (Bedrock)                   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│  Persistence: akira_history.json, akira_memory.json, screenshots/   │
└─────────────────────────────────────────────────────────────────┘
```

- **Frontend** (`frontend/`): React 18, Vite 5, React Router, Markdown (GFM), Mermaid, PWA (Workbox). Dev server proxies `/api` to the backend.
- **Backend** (`backend/`): FastAPI, CORS for local dev and Electron, rate limiting on chat, optional static serving of `frontend/dist`.
- **Desktop** (`desktop/`): Electron loads the React app; backend runs separately.

---

## Features in detail

### LLM providers

| Provider       | Description                    | Configuration (env) |
|----------------|--------------------------------|----------------------|
| **OpenRouter** | Unified API for many models    | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `DEFAULT_MODEL=openrouter`, etc. |
| **Anthropic**  | Claude via AWS Bedrock         | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BEDROCK_ENDPOINT` (optional), `CLAUDE_INFERENCE_PROFILE` |

### Tools (function calling)

Tools live in `backend/tools/`: each module defines `TOOL_DEF` (name, description, `input_schema`, optional `default_enabled`, optional `timeout_seconds`) and `call_tool(input, context)`. The LLM service maps them to provider-specific schemas and runs tool rounds during streaming.

**Current modules** (as checked in from `backend/tools/`):

| Tool              | Purpose |
|-------------------|--------|
| `read_file`       | Read file contents under the workspace (optional line range). |
| `write_file`      | Write or append; uses sandboxed paths and atomic writes. |
| `patch_file`      | Apply patch-style edits. |
| `list_dir`        | List directory entries under the workspace. |
| `execute_command` | Run shell commands (use with care; environment-dependent). |
| `web_search`      | Web search (optional API keys per implementation). |
| `reload_tools`    | Reload tool definitions from disk without server restart. |
| `store_memory`    | Append a long-term memory record. |
| `search_memories` | Search stored memories by text. |
| `list_memories`   | List stored memories. |

Users enable or disable tools per conversation in the UI; only enabled tools are sent to the model and listed in the injected system prompt section.

### Chat API

- **POST /api/chat** — Body: `message`, optional `chat_id`, `images[]`, `files[]`, `settings` (temperature, `max_tokens`, thinking flags, `enabled_tools`, `stream`, etc.). Response: SSE with events such as `meta`, `delta`, `settings`, `done`, `error` (and heartbeats). Text files can be inlined into the message on the server; images use vision-capable models when available.
- **POST /api/chat/branch** — Branch at `message_index` with `new_content`; returns a new `chat_id`.
- **GET /api/history** — List chats (metadata).
- **GET /api/history/{chat_id}** — Full messages for one chat.
- **DELETE /api/history/{chat_id}** — Delete a chat.

### Task API

- **POST /api/task** — Body: `goal`. Streams SSE: plan (task tree), per-node updates, `done` or `error`. The `TaskManager` uses the LLM to produce a structured tree (sequential / parallel / atomic) and executes it.

### Other endpoints

- **GET /api/settings** — Defaults and bounds for the UI (tools list, providers, token/temperature/thinking limits, `agi_mode`, etc.).
- **GET /api/health** — Liveness.
- **GET /api/ready** — Readiness (history file usable + provider initialized).
- **GET /api/screenshots/{filename}** — Serve a PNG from the project `screenshots/` directory (path-safe).

---

## Prerequisites

- **Python** 3.10+ (backend).
- **Node.js** 18+ (frontend and desktop).
- **API keys / credentials** for at least one LLM provider (OpenRouter and/or AWS Bedrock for Anthropic).

---

## Quick start

### 1. Clone and configure

```bash
git clone <repository-url>
cd Akira
```

Create a `.env` in the **project root** (loaded by `backend/main.py`):

```env
# OpenRouter
OPENROUTER_API_KEY=sk-or-...
DEFAULT_MODEL=openrouter

# Optional
# OPENROUTER_MODEL=anthropic/claude-sonnet-4
# MAX_TOKENS=131072
# DEFAULT_TEMPERATURE=0.7
```

For Anthropic via Bedrock:

```env
DEFAULT_MODEL=anthropic
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
CLAUDE_INFERENCE_PROFILE=anthropic.claude-3-5-sonnet-...
# BEDROCK_ENDPOINT=...   # if using a custom endpoint
```

### 2. Backend

Default HTTP port is **8002** (override with `PORT` in `.env`).

```bash
pip install -r backend/requirements.txt
# Also install FastAPI stack if needed, e.g.:
# pip install fastapi uvicorn python-dotenv pydantic
cd <project-root>
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8002
```

Ensure `frontend/vite.config.js` **`server.proxy['/api'].target`** matches your backend port (it is set to `http://localhost:8002` in the repo).

**Telegram bot (optional):** With the API already running, set `TELEGRAM_BOT_TOKEN` in `.env`, optionally `TELEGRAM_ALLOWED_USER_IDS` (comma-separated numeric user IDs — strongly recommended), then from the project root:

```bash
python -m backend.telegram_bot
```

Messages are sent to `POST /api/chat`. Tools are **off** for Telegram by default; set `TELEGRAM_ENABLE_TOOLS=1` only if you accept tools executing on the machine that runs the API. Use `/new` in Telegram to start a new Akira thread.

### 3. Frontend (web)

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (often `http://localhost:5173`). The dev server proxies `/api` to the backend.

### 4. Desktop (optional)

Backend must be running. See [desktop/README.md](desktop/README.md).

```bash
cd desktop
npm install
npm run dev
```

---

## Configuration (environment)

| Variable | Description | Example |
|----------|-------------|--------|
| `PORT` | Backend listen port | `8002` |
| `DEFAULT_MODEL` | Default LLM provider | `openrouter`, `anthropic` |
| `OPENROUTER_API_KEY` | OpenRouter API key | `sk-or-...` |
| `OPENROUTER_MODEL` | OpenRouter model id | `anthropic/claude-sonnet-4` |
| `MAX_TOKENS` | Default max output tokens | `131072` |
| `DEFAULT_TEMPERATURE` | Default sampling temperature | `0.7` |
| `THINKING_BUDGET_MIN` / `THINKING_BUDGET_MAX` | Thinking token bounds | e.g. `1024`, `128000` |
| `AGI_MODE` | When truthy, inject memory search into system prompt | `1` / `true` |
| `AWS_*`, `CLAUDE_INFERENCE_PROFILE`, `BEDROCK_ENDPOINT` | Bedrock / Anthropic | — |

**Frontend:** `VITE_API_URL` — API base when not using the dev proxy. `VITE_BASE_PATH` — e.g. `./` for Electron file URLs.

**Desktop:** `AKIRA_API_URL` — Backend URL (often `http://localhost:8002`).

**Telegram bridge:** `TELEGRAM_BOT_TOKEN` (required to run the bot), `TELEGRAM_ALLOWED_USER_IDS` (optional allowlist), `AKIRA_API_BASE` (default `http://127.0.0.1:8002`), `TELEGRAM_ENABLE_TOOLS` (set to `1` to allow tools; default is off). On locked-down networks, `SSL: CERTIFICATE_VERIFY_FAILED` to Telegram is usually corporate TLS inspection: set `TELEGRAM_SSL_CA_BUNDLE` to a PEM file with your org CA, or as a last resort `TELEGRAM_VERIFY_SSL=0` (insecure). `REQUESTS_CA_BUNDLE` / `SSL_CERT_FILE` are used the same way if they point to a real file.

---

## Project structure

```
Akira/
├── backend/
│   ├── main.py                 # FastAPI app, CORS, routes, static mount
│   ├── akira_system_prompt.md
│   ├── akira_history.json    # Runtime (gitignored in normal setups)
│   ├── akira_memory.json     # Long-term memories
│   ├── api/routers/            # chat, history, task
│   ├── core/                   # logging, paths, rate_limit, history_store, memory_store, file_access
│   ├── services/
│   │   ├── llm_service.py      # Orchestration, tool loop, history, autonomous hook
│   │   ├── llm_providers.py   # OpenRouter, Anthropic (Bedrock)
│   │   ├── llm_tools.py       # Discovery, timeouts, call_tool
│   │   └── task_manager.py    # Plan + execute task tree
│   ├── tools/                  # Tool modules (TOOL_DEF + call_tool)
│   ├── telegram_bot.py         # Optional Telegram ↔ /api/chat bridge
│   ├── tests/
│   └── scripts/                # e.g. rank_openrouter_models.py
├── frontend/
│   ├── src/
│   │   ├── api/                # chat, history, settings clients
│   │   ├── components/         # ChatInput, MessageList, Sidebar, SettingsModal, MermaidChart, …
│   │   ├── config/             # theme / appearance
│   │   ├── pages/              # ChatPage, …
│   │   └── utils/              # voice, sound, …
│   ├── vite.config.js          # PWA + proxy
│   └── package.json
├── desktop/                    # Electron (see desktop/README.md)
├── .env                        # Not committed
└── README.md
```

---

## Development notes

- **Adding a tool**: Add `backend/tools/<name>.py` with `TOOL_DEF` and `call_tool`; call the `reload_tools` tool or restart the backend.
- **System prompt**: Edit `backend/akira_system_prompt.md` (or use `LLM_Service` read/write helpers in code). Keep tool names in the prompt aligned with actual tools in `backend/tools/`.
- **OpenRouter model ranking**: Run `backend/scripts/rank_openrouter_models.py` with `OPENROUTER_API_KEY` set.
- **Rate limiting**: `backend/core/rate_limit.py` — default 20 requests per minute per client key.

---

## License

See repository license (e.g. MIT in `desktop/package.json` if applicable). Use of third-party APIs (OpenRouter, Anthropic, AWS) is subject to their terms and pricing.

---

## Short summary

Akira is a **modular full-stack AI assistant**: **FastAPI** + **SSE** streaming, **multi-provider** LLMs, **sandboxed tools** and **memory**, **task planning**, a **React** chat UI with **markdown**, **Mermaid**, **PWA**, and optional **voice**, **camera**, and **Electron**. Configure providers via `.env`, run the backend and frontend, and extend behavior with new tools under `backend/tools/`.
