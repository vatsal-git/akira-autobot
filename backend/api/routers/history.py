import logging
from typing import Any
from fastapi import APIRouter, Request, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/history")
async def list_chats(request: Request):
    """Return all chats with metadata (no full messages) for the sidebar."""
    llm: Any = request.app.state.llm_service
    all_history = llm.load_history()

    chats = []
    for chat_id, chat_data in all_history.items():
        messages = chat_data.get("messages", [])
        last_updated = chat_data.get("last_updated", chat_data.get("created_at", ""))
        title = chat_data.get("title")

        if not title and messages:
            first_user = next(
                (m for m in messages if m.get("role") == "user"), None
            )
            if first_user:
                text = _extract_text(first_user.get("content", ""))
                title = text[:40] + ("..." if len(text) > 40 else "") if text else None

        chats.append({
            "chat_id": chat_id,
            "title": title or f"Chat {chat_id[:6]}",
            "created_at": chat_data.get("created_at", ""),
            "last_updated": last_updated,
            "message_count": len(messages),
        })

    chats.sort(key=lambda c: c["last_updated"] or c["created_at"], reverse=True)
    return chats


@router.get("/history/{chat_id}")
async def get_chat(chat_id: str, request: Request):
    """Return full messages for a specific chat."""
    llm: Any = request.app.state.llm_service
    all_history = llm.load_history()
    chat_data = all_history.get(chat_id)
    if not chat_data:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {
        "chat_id": chat_id,
        "created_at": chat_data.get("created_at", ""),
        "messages": chat_data.get("messages", []),
    }


@router.delete("/history/{chat_id}")
async def delete_chat(chat_id: str, request: Request):
    """Delete a chat from history."""
    llm: Any = request.app.state.llm_service
    all_history = llm.load_history()
    if chat_id not in all_history:
        raise HTTPException(status_code=404, detail="Chat not found")
    del all_history[chat_id]

    import json
    with open(llm.history_file_path, "w", encoding="utf-8") as f:
        json.dump(all_history, f, indent=2, ensure_ascii=False)
    return {"ok": True}


def _extract_text(content):
    """Pull plain text from a message content field."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                return block.get("text", "")
    return ""
