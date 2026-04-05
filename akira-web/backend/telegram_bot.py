"""
Akira ↔ Telegram bridge (long polling).

Loads environment from the repo root ``.env`` (same as ``backend.server``).

Required:
  TELEGRAM_BOT_TOKEN — from @BotFather

Recommended:
  TELEGRAM_ALLOWED_USER_IDS — comma-separated numeric Telegram user IDs.
  If unset, any user who finds the bot can use it (fine for private testing only).

Optional:
  AKIRA_API_BASE — default ``http://127.0.0.1:8100`` (no trailing slash)
  TELEGRAM_ENABLE_TOOLS — set to ``1`` / ``true`` / ``yes`` to allow all Akira tools
    over Telegram (dangerous if the API runs on your machine). Default: tools off.

Corporate TLS inspection (``SSL: CERTIFICATE_VERIFY_FAILED`` to api.telegram.org):

  * Best: ``TELEGRAM_SSL_CA_BUNDLE`` — path to a PEM file with your org root/intermediate CA
    (IT can export this). ``REQUESTS_CA_BUNDLE`` / ``SSL_CERT_FILE`` are also used if they
    point to an existing file.
  * Last resort: ``TELEGRAM_VERIFY_SSL=0`` — disables TLS verification for Telegram only
    (insecure; use only if you cannot install the CA).

Run the API first, then from the repo root::

  pip install -r backend/requirements.txt
  python -m backend.telegram_bot

Commands: /start, /help, /new (new Akira conversation).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from typing import Any, Dict, Optional, Set, Tuple

import httpx
from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters
from telegram.request import HTTPXRequest

logger = logging.getLogger(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

try:
    import dotenv

    dotenv.load_dotenv()
except ImportError:
    pass

TELEGRAM_MAX_MESSAGE = 4096


def _truthy(val: Optional[str]) -> bool:
    if val is None:
        return False
    return val.strip().lower() in ("1", "true", "yes", "on")


def _resolve_ca_bundle_path() -> Optional[str]:
    """PEM path for corporate TLS inspection, or None."""
    for key in ("TELEGRAM_SSL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE"):
        raw = os.getenv(key)
        if not raw:
            continue
        path = raw.strip().strip('"').strip("'")
        if path and os.path.isfile(path):
            return path
    return None


def _build_telegram_http_request() -> Optional[HTTPXRequest]:
    """
    Custom httpx client for Telegram API when a corporate CA is needed or verify is off.
    Default None = library defaults (public CA bundle only).
    """
    ca_path = _resolve_ca_bundle_path()
    verify_off = os.getenv("TELEGRAM_VERIFY_SSL", "1").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    )

    httpx_kwargs: Dict[str, Any] = {}
    if ca_path:
        httpx_kwargs["verify"] = ca_path
        logger.info("Telegram HTTPS: using CA bundle %s", ca_path)
    elif verify_off:
        httpx_kwargs["verify"] = False
        logger.warning(
            "TELEGRAM_VERIFY_SSL=0: certificate verification to api.telegram.org is disabled. "
            "Prefer exporting your organization's root CA and setting TELEGRAM_SSL_CA_BUNDLE."
        )

    if not httpx_kwargs:
        return None

    return HTTPXRequest(
        connect_timeout=30.0,
        read_timeout=120.0,
        write_timeout=60.0,
        pool_timeout=5.0,
        media_write_timeout=120.0,
        httpx_kwargs=httpx_kwargs,
    )


def _parse_allowed_ids(raw: Optional[str]) -> Optional[Set[int]]:
    """None => no allowlist (any user). Non-empty set => only those user IDs."""
    if raw is None or not str(raw).strip():
        return None
    out: Set[int] = set()
    for part in str(raw).split(","):
        part = part.strip()
        if not part:
            continue
        out.add(int(part))
    return out if out else None


def _api_base() -> str:
    base = (os.getenv("AKIRA_API_BASE") or "http://127.0.0.1:8100").rstrip("/")
    return base


async def _fetch_all_tools_disabled_map(client: httpx.AsyncClient, base: str) -> Dict[str, bool]:
    r = await client.get(f"{base}/api/settings")
    r.raise_for_status()
    data = r.json()
    tools = data.get("tools") or []
    return {t["name"]: False for t in tools if t.get("name")}


async def _call_akira_chat(
    client: httpx.AsyncClient,
    base: str,
    message: str,
    chat_id: Optional[str],
    x_user_id: str,
    settings_extra: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[str], str, Optional[str]]:
    """
    POST /api/chat (SSE). Returns (akira_chat_id, reply_text, error_message).
    """
    settings: Dict[str, Any] = {"stream": False}
    if settings_extra:
        settings.update(settings_extra)

    body: Dict[str, Any] = {"message": message, "settings": settings}
    if chat_id:
        body["chat_id"] = chat_id

    headers = {"Content-Type": "application/json", "X-User-ID": x_user_id}
    url = f"{base}/api/chat"

    acc_delta: list[str] = []
    out_chat_id: Optional[str] = None
    err: Optional[str] = None

    try:
        async with client.stream(
            "POST",
            url,
            json=body,
            headers=headers,
            timeout=httpx.Timeout(600.0, connect=30.0),
        ) as resp:
            if resp.status_code == 429:
                return None, "", "Rate limited. Wait a minute and try again."
            if resp.status_code != 200:
                text = (await resp.aread()).decode("utf-8", errors="replace")[:800]
                return None, "", f"API error ({resp.status_code}): {text}"

            buf = ""
            async for raw in resp.aiter_text():
                buf += raw
                parts = buf.split("\n\n")
                buf = parts.pop() or ""
                for part in parts:
                    if not part.strip():
                        continue
                    event = ""
                    data_str = ""
                    for line in part.split("\n"):
                        if line.startswith("event:"):
                            event = line[6:].strip()
                        elif line.startswith("data:"):
                            data_str = line[5:].strip()
                    if event == ":" or not data_str:
                        continue
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        if event == "error":
                            err = data_str
                        continue
                    if event == "meta":
                        out_chat_id = data.get("chat_id") or out_chat_id
                    elif event == "delta":
                        acc_delta.append(data.get("delta") or "")
                    elif event == "done":
                        out_chat_id = data.get("chat_id") or out_chat_id
                    elif event == "error":
                        err = data.get("error") or str(data)
    except httpx.ConnectError:
        return None, "", f"Cannot reach Akira at {base}. Is the API running?"
    except httpx.TimeoutException:
        return None, "", "Request timed out. Try a shorter question or check the API."

    if err:
        return out_chat_id, "", err
    return out_chat_id, "".join(acc_delta), None


def _split_telegram_chunks(text: str, limit: int = TELEGRAM_MAX_MESSAGE) -> list[str]:
    if not text:
        return ["(empty reply)"]
    chunks: list[str] = []
    s = text
    while s:
        chunks.append(s[:limit])
        s = s[limit:]
    return chunks


def _allowed_user(user_id: int, allowlist: Optional[Set[int]]) -> bool:
    if allowlist is None:
        return True
    return user_id in allowlist


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    await update.message.reply_text(
        "Hi — I forward your messages to Akira on this machine.\n"
        "Use /new to start a fresh conversation.\n"
        "Make sure the Akira API is running."
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    await update.message.reply_text("/new — forget this thread and start a new Akira chat.")


async def cmd_new(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    context.user_data.pop("akira_chat_id", None)
    await update.message.reply_text("Started a new Akira conversation.")


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return
    uid = update.effective_user.id if update.effective_user else 0
    allowlist: Optional[Set[int]] = context.application.bot_data.get("allowlist")
    if not _allowed_user(uid, allowlist):
        await update.message.reply_text("This bot is not available for your account.")
        return

    text = update.message.text.strip()
    if not text:
        return

    base = context.application.bot_data["api_base"]
    tools_disabled_map: Optional[Dict[str, bool]] = context.application.bot_data.get(
        "tools_disabled_map"
    )
    enable_tools = context.application.bot_data.get("enable_tools", False)
    settings_extra: Optional[Dict[str, Any]] = None
    if not enable_tools and tools_disabled_map is not None:
        settings_extra = {"enabled_tools": tools_disabled_map}

    akira_cid: Optional[str] = context.user_data.get("akira_chat_id")
    x_user = f"telegram-{uid}"

    stop = asyncio.Event()

    async def typing_loop() -> None:
        while not stop.is_set():
            try:
                await context.bot.send_chat_action(
                    chat_id=update.effective_chat.id,
                    action=ChatAction.TYPING,
                )
                await asyncio.wait_for(stop.wait(), timeout=4.0)
            except asyncio.TimeoutError:
                continue

    typing_task = asyncio.create_task(typing_loop())
    try:
        client: httpx.AsyncClient = context.application.bot_data["http_client"]
        new_id, reply, err = await _call_akira_chat(
            client, base, text, akira_cid, x_user, settings_extra
        )
        if new_id:
            context.user_data["akira_chat_id"] = new_id
        if err:
            await update.message.reply_text(err[:TELEGRAM_MAX_MESSAGE])
            return
        for chunk in _split_telegram_chunks(reply):
            await update.message.reply_text(chunk)
    finally:
        stop.set()
        typing_task.cancel()
        try:
            await typing_task
        except asyncio.CancelledError:
            pass


async def post_init(application: Application) -> None:
    base = _api_base()
    application.bot_data["api_base"] = base
    application.bot_data["allowlist"] = _parse_allowed_ids(os.getenv("TELEGRAM_ALLOWED_USER_IDS"))
    application.bot_data["enable_tools"] = _truthy(os.getenv("TELEGRAM_ENABLE_TOOLS"))

    client = httpx.AsyncClient()
    application.bot_data["http_client"] = client

    if application.bot_data["allowlist"] is None:
        logger.warning(
            "TELEGRAM_ALLOWED_USER_IDS is unset — any Telegram user can use this bot."
        )

    if application.bot_data["enable_tools"]:
        logger.warning("TELEGRAM_ENABLE_TOOLS is on — Akira tools can run on the API host.")
    else:
        try:
            application.bot_data["tools_disabled_map"] = await _fetch_all_tools_disabled_map(
                client, base
            )
            logger.info(
                "Telegram bridge: tools disabled for this session (%d tools).",
                len(application.bot_data["tools_disabled_map"]),
            )
        except Exception as e:
            logger.error("Could not load /api/settings; tools will default to API behavior: %s", e)
            application.bot_data["tools_disabled_map"] = None


async def post_shutdown(application: Application) -> None:
    client = application.bot_data.get("http_client")
    if client:
        await client.aclose()


def main() -> None:
    logging.basicConfig(
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        level=logging.INFO,
    )
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        logger.error("Set TELEGRAM_BOT_TOKEN in your environment or .env file.")
        sys.exit(1)

    builder = (
        Application.builder()
        .token(token)
        .post_init(post_init)
        .post_shutdown(post_shutdown)
    )
    tg_request = _build_telegram_http_request()
    if tg_request is not None:
        builder = builder.request(tg_request)
    app = builder.build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("new", cmd_new))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))

    logger.info("Telegram bot polling… Akira API expected at %s", _api_base())
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
