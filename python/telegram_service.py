"""Telegram Service for TUI"""

import asyncio
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from tg_service.rpc import handle_rpc
from tg_service.service import TelegramService

# Set up logging as recommended by Telethon docs
logging.basicConfig(
    format='[%(levelname)s %(asctime)s] %(name)s: %(message)s',
    level=logging.WARNING,
    stream=sys.stderr
)
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


def _create_service_from_env() -> TelegramService:
    api_id = int(os.getenv("TELEGRAM_API_ID", "0"))
    api_hash = os.getenv("TELEGRAM_API_HASH", "")
    convex_url = os.getenv("CONVEX_URL", "")

    if not api_id or not api_hash:
        print("Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set", file=sys.stderr)
        sys.exit(1)

    service = TelegramService(api_id, api_hash, convex_url)

    service._write_notification({
        "type": "log",
        "message": f"Python service started (API ID: {api_id}, Convex: {'enabled' if convex_url else 'disabled'})",
    })

    return service


if __name__ == "__main__":
    try:
        # On Windows, use WindowsSelectorEventLoopPolicy for better compatibility
        if sys.platform == 'win32':
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

        asyncio.run(handle_rpc(_create_service_from_env()))
    except KeyboardInterrupt:
        pass
