import logging
import os
import sys
import dotenv
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Project root is one level up from backend/
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dotenv.load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.core.logger import setup_logging
from backend.services.llm_service import LLM_Service
from backend.api.routers import chat, history, task
from backend.config.litellm_loader import list_model_aliases

setup_logging()

logger = logging.getLogger(__name__)

_DEFAULT_MODEL_ENV = os.getenv("DEFAULT_MODEL", "").strip() or None
llm_service = LLM_Service(default_model=_DEFAULT_MODEL_ENV)

app = FastAPI(title="Akira API", version="1.0.0")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Return JSON with a detail string so API clients (and the chat UI) never see an empty 500 body."""
    # HTTPException is handled by FastAPI's more-specific handler, not this one.
    logger.exception("%s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc) or type(exc).__name__},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:8100",
        "http://127.0.0.1:8100",
        "http://localhost:8001",
        "http://127.0.0.1:8001",
        "http://localhost:5731",
        "http://127.0.0.1:5731",
        "null",  # Electron / PyQt desktop (file:// or app load)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.llm_service = llm_service


def get_llm_service(request: Request) -> LLM_Service:
    """Dependency: return the LLM service from app state."""
    return request.app.state.llm_service


app.include_router(chat.router, prefix="/api/chat")
app.include_router(history.router, prefix="/api/history")
app.include_router(task.router, prefix="/api/task")


@app.get("/api/settings")
def get_default_settings(request: Request):
    """Return default settings and UI bounds (tools, model, token limits) so the frontend can initialize."""
    llm = get_llm_service(request)
    tools = [
        {
            "name": t["name"],
            "description": t["description"],
            "default_enabled": t.get("default_enabled", True),
        }
        for t in llm.tools_def
    ]
    max_tokens_default = int(os.getenv("MAX_TOKENS", 131072))
    agi_mode = os.getenv("AGI_MODE", "").strip().lower() in ("1", "true", "yes")
    available_models = list_model_aliases()
    current_model = getattr(llm.provider, "default_alias", None) or (
        available_models[0] if available_models else "default"
    )
    return {
        "max_tokens": max_tokens_default,
        "temperature": float(os.getenv("DEFAULT_TEMPERATURE", "0.7")),
        "current_model": current_model,
        "available_models": available_models,
        "thinking_enabled": True,
        "thinking_budget": 16000,
        "stream": True,
        "tools": tools,
        "agi_mode": agi_mode,
        "max_tokens_min": int(os.getenv("MAX_TOKENS_MIN", 1)),
        "max_tokens_max": int(os.getenv("MAX_TOKENS_MAX", 200000)),
        "temperature_min": float(os.getenv("TEMPERATURE_MIN", "0")),
        "temperature_max": float(os.getenv("TEMPERATURE_MAX", "2")),
        "thinking_budget_min": int(os.getenv("THINKING_BUDGET_MIN", 1024)),
        "thinking_budget_max": int(os.getenv("THINKING_BUDGET_MAX", 128000)),
    }


@app.get("/api/health")
def health():
    """Liveness: returns 200 if the process is up."""
    return {"status": "ok"}


@app.get("/api/ready")
def ready(request: Request):
    """Readiness: returns 200 if LLM provider and history file are usable, else 503."""
    try:
        llm = get_llm_service(request)
        path = getattr(llm, "history_file_path", None)
        if not path:
            from backend.services.llm_service import HISTORY_FILE

            path = HISTORY_FILE
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8"):
                pass
        _ = llm.provider
        return {"status": "ready"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


SCREENSHOTS_DIR = os.path.join(PROJECT_ROOT, "screenshots")


@app.get("/api/screenshots/{filename:path}")
def get_screenshot(filename: str):
    """Serve a screenshot image by filename. Used after the screenshot tool saves an image."""
    base = os.path.normpath(filename)
    if not base.endswith(".png") or ".." in base or base != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(SCREENSHOTS_DIR, filename)
    try:
        real = os.path.realpath(path)
        root_real = os.path.realpath(SCREENSHOTS_DIR)
        if not real.startswith(root_real) or not os.path.isfile(real):
            raise HTTPException(status_code=404, detail="Screenshot not found")
    except OSError:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(real, media_type="image/png")


# Serve the built React app in production
FRONTEND_BUILD = os.path.join(PROJECT_ROOT, "frontend", "dist")
if os.path.isdir(FRONTEND_BUILD):
    app.mount("/", StaticFiles(directory=FRONTEND_BUILD, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    os.chdir(PROJECT_ROOT)
    port = int(os.getenv("PORT", "8100"))
    uvicorn.run("backend.server:app", host="0.0.0.0", port=port, reload=True)
