from __future__ import annotations

import asyncio
import logging

from telethon import events
from .mappers import get_event_media_type, get_peer_info, get_sender_info

logger = logging.getLogger(__name__)


async def register_handlers(service, client, account_id: str) -> None:
    @client.on(events.NewMessage(func=lambda e: service.should_handle_new_message(account_id, e)))
    async def on_new_message(event):
        try:
            await handle_new_message(service, event, account_id)
        except Exception as e:
            logger.error(f"Error in message handler: {e}")
            service._write_notification({
                "type": "error",
                "message": f"Handler error: {str(e)[:50]}",
            })

    service._write_notification({
        "type": "debug",
        "message": f"Message handlers registered for {account_id[:8]}...",
    })

    async def run_update_loop():
        try:
            service._write_notification({
                "type": "debug",
                "message": f"Starting update loop for {account_id[:8]}...",
            })
            await client.catch_up()
            service._write_notification({
                "type": "debug",
                "message": f"Update loop active for {account_id[:8]}",
            })
        except Exception as e:
            logger.error(f"Error in update loop: {e}")
            service._write_notification({
                "type": "error",
                "message": f"Update loop error: {str(e)[:50]}",
            })

    asyncio.create_task(run_update_loop())


async def handle_new_message(service, event, account_id: str) -> None:
    try:
        filters = service.get_account_message_filters(account_id)
        if not filters["saveMessages"]:
            return
        if event.is_private:
            if not (filters["saveFromPrivate"] or filters["saveFromBots"]):
                return
        elif event.is_group:
            if not filters["saveFromGroups"]:
                return
        elif event.is_channel:
            if not filters["saveFromChannels"]:
                return

        message = event.message
        chat = await event.get_chat()
        peer_id = str(event.chat_id)

        peer_type, name, username, is_bot = get_peer_info(chat)

        if peer_type == "user":
            if not (filters["saveFromPrivate"] or filters["saveFromBots"]):
                return
        elif peer_type == "chat":
            if not filters["saveFromGroups"]:
                return
        elif peer_type == "channel":
            if not filters["saveFromChannels"]:
                return

        sender = await message.get_sender()
        from_id, from_name, sender_is_bot = get_sender_info(sender)

        if getattr(message, "via_bot_id", None) is not None:
            is_bot = True
        if sender_is_bot:
            is_bot = True
        if is_bot and not filters["saveFromBots"]:
            return
        if peer_type == "user" and (not sender_is_bot) and (not filters["saveFromPrivate"]):
            return

        media_type = get_event_media_type(message)

        service.enqueue_sync_message({
            "account_id": account_id,
            "peer_id": peer_id,
            "peer_type": peer_type,
            "name": name,
            "username": username,
            "telegram_id": message.id,
            "text": message.text,
            "from_id": from_id,
            "from_name": from_name,
            "is_outgoing": message.out,
            "is_bot": is_bot,
            "timestamp": int(message.date.timestamp() * 1000),
            "media_type": media_type,
            "reply_to_id": message.reply_to_msg_id if message.reply_to else None,
        })

        service._write_notification({
            "type": "new_message",
            "account_id": account_id,
            "peer_id": peer_id,
            "message_id": message.id,
        })

    except Exception as e:
        import traceback

        logger.error(f"Message handler error: {traceback.format_exc()}")
        service._write_notification({
            "type": "error",
            "message": f"Handler error: {type(e).__name__}: {str(e)[:40]}",
        })
