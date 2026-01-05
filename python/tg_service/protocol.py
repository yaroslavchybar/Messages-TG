import json
import queue
import sys
import threading
import time


_stdout_writer = None
_stdout_writer_lock = threading.Lock()


class _StdoutWriter:
    def __init__(self) -> None:
        self._queue: queue.Queue[str | None] = queue.Queue(maxsize=10000)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._running = True
        self._thread.start()

    def write_line(self, line: str) -> None:
        try:
            self._queue.put_nowait(line)
        except queue.Full:
            pass

    def close(self, *, timeout_s: float = 1.0) -> None:
        if not self._running:
            return
        self._running = False
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            try:
                self._queue.put(None, timeout=timeout_s)
            except Exception:
                return
        self._thread.join(timeout=timeout_s)

    def _run(self) -> None:
        buffer: list[str] = []
        last_flush = time.monotonic()

        def flush() -> None:
            nonlocal last_flush
            if not buffer:
                return
            sys.stdout.write("\n".join(buffer) + "\n")
            sys.stdout.flush()
            buffer.clear()
            last_flush = time.monotonic()

        while True:
            try:
                item = self._queue.get(timeout=0.05)
            except queue.Empty:
                if buffer and (time.monotonic() - last_flush) >= 0.05:
                    flush()
                continue

            if item is None:
                flush()
                return

            buffer.append(item)
            if len(buffer) >= 100:
                flush()


def _get_stdout_writer() -> _StdoutWriter:
    global _stdout_writer
    if _stdout_writer is not None:
        return _stdout_writer
    with _stdout_writer_lock:
        if _stdout_writer is None:
            _stdout_writer = _StdoutWriter()
    return _stdout_writer


def shutdown_stdout_writer() -> None:
    global _stdout_writer
    if _stdout_writer is None:
        return
    with _stdout_writer_lock:
        if _stdout_writer is None:
            return
        _stdout_writer.close()
        _stdout_writer = None


def write_line(line: str) -> None:
    _get_stdout_writer().write_line(line)


def write_jsonrpc_message(message: dict) -> None:
    write_line(json.dumps(message))


def write_notification(notification: dict) -> None:
    write_jsonrpc_message({"jsonrpc": "2.0", "method": "notification", "params": notification})
