from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path


class PersistentQueue:
    def __init__(self, queue_dir: str = ".queue"):
        self.queue_dir = Path(queue_dir)
        self.queue_dir.mkdir(exist_ok=True)
        self._db_path = self.queue_dir / "queue.sqlite3"
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self._db_path), timeout=2.0)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)"
        )
        self._migrate_legacy_files()

    def _migrate_legacy_files(self) -> None:
        legacy_files = sorted(self.queue_dir.glob("*.json"))
        if not legacy_files:
            return
        with self._lock:
            cur = self._conn.cursor()
            for filepath in legacy_files:
                try:
                    with filepath.open("r", encoding="utf-8") as f:
                        payload = json.load(f)
                    cur.execute(
                        "INSERT INTO queue (payload) VALUES (?)",
                        (json.dumps(payload, separators=(",", ":")),),
                    )
                    filepath.unlink(missing_ok=True)
                except Exception:
                    continue
            self._conn.commit()

    def write(self, item: dict) -> str:
        payload = json.dumps(item, separators=(",", ":"))
        with self._lock:
            cur = self._conn.cursor()
            cur.execute("INSERT INTO queue (payload) VALUES (?)", (payload,))
            self._conn.commit()
            return str(cur.lastrowid)

    def read_all(self) -> list[tuple[str, dict]]:
        with self._lock:
            cur = self._conn.cursor()
            rows = cur.execute(
                "SELECT id, payload FROM queue ORDER BY id ASC LIMIT 100"
            ).fetchall()

        items: list[tuple[str, dict]] = []
        for row_id, payload in rows:
            try:
                items.append((str(row_id), json.loads(payload)))
            except Exception:
                continue
        return items

    def delete(self, filename: str) -> None:
        try:
            row_id = int(filename)
        except Exception:
            row_id = None
        if row_id is None:
            return
        with self._lock:
            self._conn.execute("DELETE FROM queue WHERE id = ?", (row_id,))
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()
