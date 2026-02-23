import json
import logging
import time
import uuid
import asyncio
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Request, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from backend.core.rate_limit import rate_limit_dependency

logger = logging.getLogger(__name__)

router = APIRouter()

# SSE heartbeat interval when no data is sent (seconds)
SSE_HEARTBEAT_INTERVAL = 25.0
# Total stream duration timeout (seconds); no assistant save on timeout
STREAM_TOTAL_TIMEOUT = 600.0  # 10 minutes

MAX_MESSAGE_LENGTH = 100_000
MAX_IMAGES = 5
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024  # 5MB
MAX_FILES = 5
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5MB


class ImageBlock(BaseModel):
    data: str  # base64-encoded
    media_type: str

    @field_validator("data")
    @classmethod
    def image_size_limit(cls, v: str) -> str:
        import base64
        try:
            decoded = base64.b64decode(v, validate=True)
        except Exception:
            decoded = b""
        if len(decoded) > MAX_IMAGE_SIZE_BYTES:
            raise ValueError(
                f"Image size exceeds {MAX_IMAGE_SIZE_BYTES // (1024*1024)}MB limit"
            )
        return v


class FileBlock(BaseModel):
    name: str
    data: str  # base64-encoded
    mime_type: str

    @field_validator("data")
    @classmethod
    def file_size_limit(cls, v: str) -> str:
        import base64
        try:
            decoded = base64.b64decode(v, validate=True)
        except Exception:
            decoded = b""
        if len(decoded) > MAX_FILE_SIZE_BYTES:
            raise ValueError(
                f"File size exceeds {MAX_FILE_SIZE_BYTES // (1024*1024)}MB limit"
            )
        return v


class ChatRequest(BaseModel):
    message: str
    chat_id: Optional[str] = None
    images: Optional[List[ImageBlock]] = None
    files: Optional[List[FileBlock]] = None
    settings: Optional[Dict[str, Any]] = None

    @field_validator("message")
    @classmethod
    def message_length(cls, v: str) -> str:
        if len(v) > MAX_MESSAGE_LENGTH:
            raise ValueError(
                f"Message length exceeds {MAX_MESSAGE_LENGTH} character limit"
            )
        return v

    @field_validator("images")
    @classmethod
    def image_count(cls, v: Optional[List[ImageBlock]]) -> Optional[List[ImageBlock]]:
        if v is not None and len(v) > MAX_IMAGES:
            raise ValueError(f"At most {MAX_IMAGES} images allowed")
        return v

    @field_validator("files")
    @classmethod
    def file_count(cls, v: Optional[List["FileBlock"]]) -> Optional[List["FileBlock"]]:
        if v is not None and len(v) > MAX_FILES:
            raise ValueError(f"At most {MAX_FILES} files allowed")
        return v

    @field_validator("chat_id")
    @classmethod
    def chat_id_format(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return v
        try:
            uuid.UUID(v)
        except (ValueError, TypeError):
            raise ValueError("chat_id must be a valid UUID")
        return v


class BranchRequest(BaseModel):
    chat_id: str
    message_index: int
    new_content: str


async def _chat_event_stream(
    request: Request,
    llm,
    user_content,
    history_messages: list,
    chat_id: str,
    max_tokens: int,
    temperature: float,
    thinking_enabled: bool,
    thinking_budget: int,
    enabled_tools_map: Optional[Dict[str, bool]],
    mood: Optional[str] = None,
):
    """Async generator: yields SSE lines with meta, delta, done/error; handles disconnect and heartbeat."""
    request_id = str(uuid.uuid4())
    last_yield_time = asyncio.get_event_loop().time()
    stream_start = time.monotonic()
    full_response = ""

    try:
        yield f"event: meta\ndata: {json.dumps({'chat_id': chat_id, 'request_id': request_id})}\n\n"
        last_yield_time = asyncio.get_event_loop().time()

        stream = llm.invoke_llm_streaming(
            user_message=user_content,
            history=history_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            thinking_enabled=thinking_enabled,
            thinking_budget=thinking_budget,
            enabled_tools_map=enabled_tools_map,
            mood=mood,
        )
        stream_anext = stream.__anext__
        while True:
            if await request.is_disconnected():
                logger.info(
                    "Client disconnected, request_id=%s chat_id=%s",
                    request_id,
                    chat_id,
                )
                return
            try:
                chunk = await asyncio.wait_for(
                    stream_anext(), timeout=SSE_HEARTBEAT_INTERVAL
                )
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
                continue
            if time.monotonic() - stream_start > STREAM_TOTAL_TIMEOUT:
                yield f"event: error\ndata: {json.dumps({'error': 'Stream duration timeout', 'code': 'timeout'})}\n\n"
                return
            if isinstance(chunk, dict) and chunk.get("type") == "settings":
                payload = {k: v for k, v in chunk.items() if k != "type"}
                yield f"event: settings\ndata: {json.dumps(payload)}\n\n"
            elif isinstance(chunk, dict) and chunk.get("type") == "theme":
                payload = {k: v for k, v in chunk.items() if k != "type"}
                yield f"event: theme\ndata: {json.dumps(payload)}\n\n"
            else:
                full_response += chunk
                yield f"event: delta\ndata: {json.dumps({'delta': chunk})}\n\n"
            last_yield_time = asyncio.get_event_loop().time()

        assistant_msg = {
            "role": "assistant",
            "content": full_response,
            "timestamp": datetime.now().isoformat(),
        }
        llm.save_to_history(assistant_msg, chat_id)
        yield f"event: done\ndata: {json.dumps({'chat_id': chat_id})}\n\n"

    except asyncio.CancelledError:
        logger.info("Stream cancelled request_id=%s chat_id=%s", request_id, chat_id)
        raise
    except Exception as e:
        logger.error(
            "SSE stream error request_id=%s chat_id=%s: %s",
            request_id,
            chat_id,
            e,
            exc_info=True,
        )
        yield f"event: error\ndata: {json.dumps({'error': str(e), 'code': 'stream_error'})}\n\n"


def _decode_file_to_message_part(name: str, raw: bytes, mime_type: str) -> str:
    """Decode file bytes into a message snippet Akira can understand. Prefer text; otherwise note the attachment."""
    if mime_type.startswith("text/") or mime_type in (
        "application/json",
        "application/xml",
        "application/javascript",
        "application/x-python",
    ):
        try:
            text = raw.decode("utf-8")
            return f"\n\n[Attached file: {name}]\n```\n{text}\n```"
        except UnicodeDecodeError:
            pass
    # Try UTF-8 for any other type (e.g. .md, .csv, .py)
    try:
        text = raw.decode("utf-8")
        if text.strip():
            return f"\n\n[Attached file: {name}]\n```\n{text}\n```"
    except UnicodeDecodeError:
        pass
    return f"\n\n[User attached binary file: {name}]"


@router.post("/chat", dependencies=[Depends(rate_limit_dependency)])
async def chat_stream(body: ChatRequest, request: Request):
    """Send a message and receive an SSE stream of assistant chunks."""
    import base64 as b64

    llm = request.app.state.llm_service

    settings = body.settings or {}
    enabled_tools_map = settings.get("enabled_tools")
    max_tokens = settings.get("max_tokens", 131072)
    temperature = settings.get("temperature", 0.7)
    thinking_enabled = settings.get("thinking_enabled", True)
    thinking_budget = settings.get("thinking_budget", 16000)
    mood = settings.get("mood")  # Agent's current mood; injected into system prompt at send time

    message = body.message

    # Merge non-image files into message text so Akira can understand them
    if body.files:
        for f in body.files:
            if (f.mime_type or "").startswith("image/"):
                continue  # handled as images below
            raw = b64.b64decode(f.data, validate=True)
            message += _decode_file_to_message_part(f.name, raw, f.mime_type or "")

    images_data = []
    if body.images:
        images_data = [(b64.b64decode(img.data), img.media_type) for img in body.images]
    # Include image/* files from body.files as images for vision
    if body.files:
        for f in body.files:
            if (f.mime_type or "").startswith("image/"):
                raw = b64.b64decode(f.data, validate=True)
                images_data.append((raw, f.mime_type or "image/png"))

    if images_data:
        user_content = llm.format_message_with_images(message, images_data)
    else:
        user_content = message

    history_messages = []
    if body.chat_id:
        all_history = llm.load_history()
        chat_data = all_history.get(body.chat_id)
        if chat_data:
            history_messages = chat_data.get("messages", [])

    user_msg = {
        "role": "user",
        "content": user_content,
        "timestamp": datetime.now().isoformat(),
    }
    chat_id = llm.save_to_history(user_msg, body.chat_id)

    return StreamingResponse(
        _chat_event_stream(
            request=request,
            llm=llm,
            user_content=user_content,
            history_messages=history_messages,
            chat_id=chat_id,
            max_tokens=max_tokens,
            temperature=temperature,
            thinking_enabled=thinking_enabled,
            thinking_budget=thinking_budget,
            enabled_tools_map=enabled_tools_map,
            mood=mood,
        ),
        media_type="text/event-stream",
    )


@router.post("/chat/branch")
async def branch_chat(body: BranchRequest, request: Request):
    """Branch a conversation at a given message index."""
    llm = request.app.state.llm_service
    new_chat_id, new_messages = llm.branch_conversation(
        body.chat_id, body.message_index, body.new_content
    )
    return {"chat_id": new_chat_id, "messages": new_messages}
