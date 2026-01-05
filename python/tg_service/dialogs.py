from __future__ import annotations

from telethon.tl.types import Channel, Chat, User

from .mappers import get_history_media_type


async def get_dialogs(client, limit: int = 50) -> list:
    dialogs = []
    async for dialog in client.iter_dialogs(limit=limit):
        entity = dialog.entity
        if isinstance(entity, Channel):
            peer_type = "channel" if entity.broadcast else "chat"
        elif isinstance(entity, Chat):
            peer_type = "chat"
        else:
            peer_type = "user"

        dialogs.append({
            "peer_id": str(dialog.id),
            "peer_type": peer_type,
            "name": dialog.name,
            "username": getattr(entity, "username", None),
            "unread_count": dialog.unread_count,
            "last_message": dialog.message.text if dialog.message else None,
            "last_message_at": int(dialog.message.date.timestamp() * 1000) if dialog.message else None,
        })
    return dialogs


async def fetch_messages(client, peer_id: str, limit: int = 50) -> list:
    messages = []
    async for msg in client.iter_messages(int(peer_id), limit=limit):
        sender = await msg.get_sender() if msg.sender_id else None
        from_name = None
        if sender and isinstance(sender, User):
            from_name = f"{sender.first_name or ''} {sender.last_name or ''}".strip()
        elif sender:
            from_name = getattr(sender, "title", "Unknown")

        media_type = get_history_media_type(msg)

        messages.append({
            "telegram_id": msg.id,
            "text": msg.text,
            "from_id": str(msg.sender_id) if msg.sender_id else None,
            "from_name": from_name,
            "is_outgoing": msg.out,
            "timestamp": int(msg.date.timestamp() * 1000),
            "media_type": media_type,
            "reply_to_id": msg.reply_to_msg_id if msg.reply_to else None,
        })
    return messages

