from __future__ import annotations

import asyncio
import sys
from typing import Callable

import httpx


async def sync_message(*, convex_url: str, http_client, notify: Callable[[dict], None], **kwargs) -> None:
    if not convex_url:
        return

    peer_id = kwargs.get("peer_id")
    if peer_id == "777000":
        notify({
            "type": "sync",
            "saved": False,
            "message": "Skip: excluded peer 777000",
        })
        return

    name = kwargs.get("name", "Unknown")
    text_preview = (kwargs.get("text") or "[media]")[:30]

    max_retries = 3
    payload = {
        "path": "messages:ingest",
        "args": {
            "accountId": kwargs["account_id"],
            "peerId": kwargs["peer_id"],
            "peerType": kwargs["peer_type"],
            "name": kwargs["name"],
            "username": kwargs.get("username"),
            "telegramId": kwargs["telegram_id"],
            "text": kwargs.get("text"),
            "fromId": kwargs.get("from_id"),
            "fromName": kwargs.get("from_name"),
            "isOutgoing": kwargs["is_outgoing"],
            "timestamp": kwargs["timestamp"],
            "mediaType": kwargs.get("media_type"),
            "replyToId": kwargs.get("reply_to_id"),
            "isBot": kwargs.get("is_bot", False),
        },
    }

    for attempt in range(max_retries):
        try:
            resp = await http_client.post(f"{convex_url}/api/mutation", json=payload)

            if resp.status_code == 200:
                result = resp.json()
                if isinstance(result, dict) and result.get("saved") is True:
                    notify({
                        "type": "sync",
                        "saved": True,
                        "message": f"Saved msg from {name}: {text_preview}",
                    })
                return

            if resp.status_code >= 500 and attempt < (max_retries - 1):
                await asyncio.sleep(2 ** attempt)
                continue

            notify({
                "type": "error",
                "message": f"Convex error: {resp.status_code} - {resp.text[:50]}",
            })
            return
        except httpx.TimeoutException:
            if attempt < (max_retries - 1):
                await asyncio.sleep(2 ** attempt)
                continue
            notify({
                "type": "error",
                "message": "Convex timeout after retries",
            })
            return
        except Exception as e:
            notify({
                "type": "error",
                "message": f"Sync error: {str(e)[:50]}",
            })
            print(f"Error syncing message: {e}", file=sys.stderr)
            return

