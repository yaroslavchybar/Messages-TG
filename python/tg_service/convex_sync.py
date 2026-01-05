from __future__ import annotations

import asyncio
import sys
from typing import Callable

import httpx


def _unwrap_value(body: object):
    if not isinstance(body, dict):
        return None
    if body.get("status") == "success":
        return body.get("value")
    if "value" in body and "status" not in body:
        return body.get("value")
    return body


def _to_ingest_args(kwargs: dict) -> dict:
    return {
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
    }


async def sync_messages(*, convex_url: str, http_client, notify: Callable[[dict], None], messages: list[dict]) -> None:
    if not convex_url:
        return

    filtered: list[dict] = []
    for msg in messages:
        if msg.get("peer_id") == "777000":
            continue
        filtered.append(msg)
    if not filtered:
        return

    max_retries = 3
    payload = {
        "path": "messages:batchIngest",
        "args": {
            "messages": [_to_ingest_args(m) for m in filtered],
        },
        "format": "json",
    }

    for attempt in range(max_retries):
        try:
            resp = await http_client.post(f"{convex_url}/api/mutation", json=payload)

            if resp.status_code == 200:
                value = _unwrap_value(resp.json())
                if len(filtered) == 1:
                    name = filtered[0].get("name", "Unknown")
                    text_preview = (filtered[0].get("text") or "[media]")[:30]
                    if isinstance(value, dict) and value.get("saved") is True:
                        notify({
                            "type": "sync",
                            "saved": True,
                            "message": f"Saved msg from {name}: {text_preview}",
                        })
                else:
                    if isinstance(value, dict) and isinstance(value.get("savedCount"), int):
                        saved_count = value.get("savedCount")
                        deduped_count = value.get("dedupedCount")
                        notify({
                            "type": "sync",
                            "saved": True,
                            "message": f"Saved {saved_count} msgs (deduped {deduped_count})",
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


async def sync_message(*, convex_url: str, http_client, notify: Callable[[dict], None], **kwargs) -> None:
    await sync_messages(convex_url=convex_url, http_client=http_client, notify=notify, messages=[kwargs])
