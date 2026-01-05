from __future__ import annotations

import json
import time
from pathlib import Path


class PersistentQueue:
    def __init__(self, queue_dir: str = ".queue"):
        self.queue_dir = Path(queue_dir)
        self.queue_dir.mkdir(exist_ok=True)
        self._counter = 0

    def write(self, item: dict) -> str:
        self._counter += 1
        filename = f"{int(time.time())}_{self._counter}.json"
        filepath = self.queue_dir / filename
        tmp_path = self.queue_dir / f"{filename}.tmp"
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(item, f)
        tmp_path.replace(filepath)
        return filename

    def read_all(self) -> list[tuple[str, dict]]:
        items: list[tuple[str, dict]] = []
        for filepath in sorted(self.queue_dir.glob("*.json")):
            try:
                with filepath.open("r", encoding="utf-8") as f:
                    items.append((filepath.name, json.load(f)))
            except Exception:
                continue
        return items

    def delete(self, filename: str) -> None:
        filepath = self.queue_dir / filename
        if filepath.exists():
            filepath.unlink()
