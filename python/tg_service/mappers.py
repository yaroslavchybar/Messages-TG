from __future__ import annotations

from typing import Any, Optional, Tuple

from telethon.tl.types import Channel, Chat, User


def get_peer_info(chat: Any) -> Tuple[str, str, Optional[str], bool]:
    is_bot = False
    if isinstance(chat, Channel):
        peer_type = "channel" if chat.broadcast else "chat"
        name = chat.title
    elif isinstance(chat, Chat):
        peer_type = "chat"
        name = chat.title
    elif isinstance(chat, User):
        peer_type = "user"
        name = f"{chat.first_name or ''} {chat.last_name or ''}".strip()
        is_bot = getattr(chat, "bot", False)
    else:
        peer_type = "user"
        name = "Unknown"

    username = getattr(chat, "username", None)
    return peer_type, name, username, is_bot


def get_sender_info(sender: Any) -> Tuple[Optional[str], Optional[str], bool]:
    if not sender:
        return None, None, False

    from_id = str(getattr(sender, "id", None)) if getattr(sender, "id", None) is not None else None
    if isinstance(sender, User):
        from_name = f"{sender.first_name or ''} {sender.last_name or ''}".strip()
        is_bot = getattr(sender, "bot", False)
        return from_id, from_name, is_bot

    from_name = getattr(sender, "title", "Unknown")
    return from_id, from_name, False


def get_event_media_type(message: Any) -> Optional[str]:
    if message.photo:
        return "photo"
    if message.video:
        return "video"
    if message.audio:
        return "audio"
    if message.voice:
        return "voice"
    if message.document:
        return "document"
    if message.sticker:
        return "sticker"
    return None


def get_history_media_type(message: Any) -> Optional[str]:
    if message.photo:
        return "photo"
    if message.video:
        return "video"
    if message.document:
        return "document"
    if message.sticker:
        return "sticker"
    return None

