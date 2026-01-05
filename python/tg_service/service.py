from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import httpx
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import User

from .convex_sync import sync_message
from .dialogs import fetch_messages as fetch_messages_impl
from .dialogs import get_dialogs as get_dialogs_impl
from .handlers import register_handlers
from .protocol import write_notification

logger = logging.getLogger(__name__)


class TelegramService:
    def __init__(self, api_id: int, api_hash: str, convex_url: str):
        self.api_id = api_id
        self.api_hash = api_hash
        self.convex_url = convex_url
        self.clients: dict[str, TelegramClient] = {}
        self.pending_logins: dict[str, dict] = {}
        self.http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
        )
        self._sync_queue: asyncio.Queue[dict] | None = None
        self._sync_worker_tasks: set[asyncio.Task] = set()
        self._last_sync_queue_full_ts = 0.0
        self._account_settings: dict[str, dict] = {}
        self._account_settings_refresh_tasks: dict[str, asyncio.Task] = {}
        self._last_settings_refresh_error_ts: dict[str, float] = {}

    def get_account_message_filters(self, account_id: str) -> dict[str, bool]:
        settings = self._account_settings.get(account_id) or {}
        return {
            "saveMessages": bool(settings.get("saveMessages", True)),
            "saveFromChannels": bool(settings.get("saveFromChannels", False)),
            "saveFromBots": bool(settings.get("saveFromBots", False)),
            "saveFromPrivate": bool(settings.get("saveFromPrivate", True)),
            "saveFromGroups": bool(settings.get("saveFromGroups", False)),
        }

    def should_handle_new_message(self, account_id: str, event) -> bool:
        filters = self.get_account_message_filters(account_id)
        if not filters["saveMessages"]:
            return False

        if event.is_private:
            return filters["saveFromPrivate"] or filters["saveFromBots"]
        if event.is_group:
            return filters["saveFromGroups"]
        if event.is_channel and not event.is_group:
            return filters["saveFromChannels"]
        if event.is_channel:
            return filters["saveFromGroups"]
        return True

    def _ensure_account_settings_refresh_task(self, account_id: str) -> None:
        if not self.convex_url:
            return
        if account_id in self._account_settings_refresh_tasks:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        async def _run() -> None:
            while True:
                await self._refresh_account_settings(account_id)
                await asyncio.sleep(30)

        self._account_settings_refresh_tasks[account_id] = loop.create_task(_run())

    async def _refresh_account_settings(self, account_id: str) -> None:
        if not self.convex_url:
            return
        try:
            resp = await self.http_client.post(
                f"{self.convex_url}/api/query",
                json={
                    "path": "accounts:get",
                    "args": {"accountId": account_id},
                },
            )
            if resp.status_code != 200:
                raise ValueError(f"Convex query failed: {resp.status_code}")
            body = resp.json()

            value = None
            if isinstance(body, dict) and body.get("status") == "success":
                value = body.get("value")
            elif isinstance(body, dict):
                value = body.get("value")

            if isinstance(value, dict):
                self._account_settings[account_id] = value
        except Exception as e:
            now = time.monotonic()
            last = self._last_settings_refresh_error_ts.get(account_id, 0.0)
            if (now - last) >= 60:
                self._last_settings_refresh_error_ts[account_id] = now
                self._write_notification({
                    "type": "error",
                    "message": f"Failed to refresh account settings: {str(e)[:80]}",
                })

    def ensure_sync_workers(self) -> None:
        if not self.convex_url:
            return
        if self._sync_queue is not None and self._sync_worker_tasks:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        if self._sync_queue is None:
            self._sync_queue = asyncio.Queue(maxsize=2000)

        if not self._sync_worker_tasks:
            for _ in range(4):
                task = loop.create_task(self._sync_worker())
                self._sync_worker_tasks.add(task)

    def enqueue_sync_message(self, payload: dict) -> bool:
        self.ensure_sync_workers()
        if self._sync_queue is None:
            return False
        try:
            self._sync_queue.put_nowait(payload)
            return True
        except asyncio.QueueFull:
            now = time.monotonic()
            if (now - self._last_sync_queue_full_ts) >= 5:
                self._last_sync_queue_full_ts = now
                self._write_notification({
                    "type": "error",
                    "message": "Sync queue full; dropping messages",
                })
            return False

    async def _sync_worker(self) -> None:
        if self._sync_queue is None:
            return

        while True:
            item = await self._sync_queue.get()
            if item is None:
                return
            try:
                await self._sync_message(**item)
            except Exception as e:
                self._write_notification({
                    "type": "error",
                    "message": str(e),
                })

    async def shutdown(self) -> None:
        for task in list(self._account_settings_refresh_tasks.values()):
            task.cancel()
        if self._account_settings_refresh_tasks:
            await asyncio.gather(*self._account_settings_refresh_tasks.values(), return_exceptions=True)
            self._account_settings_refresh_tasks.clear()
        if self._sync_queue is not None and self._sync_worker_tasks:
            for _ in range(len(self._sync_worker_tasks)):
                try:
                    self._sync_queue.put_nowait(None)
                except asyncio.QueueFull:
                    await self._sync_queue.put(None)

            await asyncio.gather(*self._sync_worker_tasks, return_exceptions=True)
            self._sync_worker_tasks.clear()

    async def login(self, phone: str, account_id: str) -> dict:
        session = StringSession()
        client = TelegramClient(session, self.api_id, self.api_hash)
        await client.connect()

        result = await client.send_code_request(phone)

        self.pending_logins[account_id] = {
            "client": client,
            "phone": phone,
            "phone_code_hash": result.phone_code_hash,
        }

        return {
            "phone_code_hash": result.phone_code_hash,
            "needs_code": True,
        }

    async def verify_code(
        self,
        account_id: str,
        phone: str,
        code: str,
        phone_code_hash: str,
        password: Optional[str] = None,
    ) -> dict:
        pending = self.pending_logins.get(account_id)
        if not pending:
            raise ValueError("No pending login for this account")

        client: TelegramClient = pending["client"]

        try:
            await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
        except Exception as e:
            if "Two-steps verification" in str(e) or "2FA" in str(e):
                if password:
                    await client.sign_in(password=password)
                else:
                    return {"needs_2fa": True}
            else:
                raise

        me = await client.get_me()
        session_string = client.session.save()

        self.clients[account_id] = client
        del self.pending_logins[account_id]

        self._write_notification({
            "type": "log",
            "message": f"Logged in as {me.first_name or me.username or 'Unknown'}",
        })

        await self._refresh_account_settings(account_id)
        self._ensure_account_settings_refresh_task(account_id)

        await register_handlers(self, client, account_id)

        name = ""
        if isinstance(me, User):
            name = f"{me.first_name or ''} {me.last_name or ''}".strip()

        return {
            "session_string": session_string,
            "name": name,
            "username": me.username if hasattr(me, "username") else None,
            "user_id": str(me.id),
        }

    async def connect_with_session(self, account_id: str, session_string: str) -> dict:
        client = TelegramClient(StringSession(session_string), self.api_id, self.api_hash)
        await client.connect()

        if not await client.is_user_authorized():
            return {"success": False, "error": "Session expired"}

        me = await client.get_me()
        self.clients[account_id] = client

        await self._refresh_account_settings(account_id)
        self._ensure_account_settings_refresh_task(account_id)
        await register_handlers(self, client, account_id)

        name = ""
        if isinstance(me, User):
            name = f"{me.first_name or ''} {me.last_name or ''}".strip()

        return {
            "success": True,
            "name": name,
            "username": me.username if hasattr(me, "username") else None,
        }

    async def disconnect(self, account_id: str) -> dict:
        client = self.clients.pop(account_id, None)
        if client:
            task = self._account_settings_refresh_tasks.pop(account_id, None)
            if task is not None:
                task.cancel()
            await client.disconnect()
            return {"success": True}
        return {"success": False, "error": "Client not found"}

    async def _sync_message(self, **kwargs) -> None:
        await sync_message(
            convex_url=self.convex_url,
            http_client=self.http_client,
            notify=self._write_notification,
            **kwargs,
        )

    def _write_notification(self, notification: dict):
        write_notification(notification)

    async def get_dialogs(self, account_id: str, limit: int = 50) -> list:
        client = self.clients.get(account_id)
        if not client:
            return []

        return await get_dialogs_impl(client, limit=limit)

    async def fetch_messages(self, account_id: str, peer_id: str, limit: int = 50) -> list:
        client = self.clients.get(account_id)
        if not client:
            return []

        return await fetch_messages_impl(client, peer_id=peer_id, limit=limit)

    async def send_message(
        self,
        account_id: str,
        peer_id: str,
        text: str,
        reply_to: Optional[int] = None,
    ) -> dict:
        client = self.clients.get(account_id)
        if not client:
            return {"success": False, "error": "Client not connected"}

        try:
            msg = await client.send_message(int(peer_id), text, reply_to=reply_to)
            return {
                "success": True,
                "message_id": msg.id,
                "timestamp": int(msg.date.timestamp() * 1000),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
