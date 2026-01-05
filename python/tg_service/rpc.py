from __future__ import annotations

import asyncio
import json
import sys

from .protocol import shutdown_stdout_writer, write_jsonrpc_message


async def handle_rpc(service) -> None:
    import threading

    loop = asyncio.get_running_loop()
    input_queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=1000)
    shutdown_event = threading.Event()

    def stdin_reader():
        try:
            for line in sys.stdin:
                if shutdown_event.is_set():
                    break
                future = asyncio.run_coroutine_threadsafe(input_queue.put(line.strip()), loop)
                future.result()
        except Exception as e:
            print(f"Stdin reader error: {e}", file=sys.stderr)
        finally:
            try:
                future = asyncio.run_coroutine_threadsafe(input_queue.put(None), loop)
                future.result(timeout=1)
            except Exception:
                pass

    reader_thread = threading.Thread(target=stdin_reader, daemon=True)
    reader_thread.start()

    async def process_request(line: str):
        try:
            request = json.loads(line)
            method = request.get("method")
            params = request.get("params", {})
            req_id = request.get("id")

            result = None
            error = None

            try:
                if method == "login":
                    result = await service.login(**params)
                elif method == "verify_code":
                    result = await service.verify_code(**params)
                elif method == "connect_with_session":
                    result = await service.connect_with_session(**params)
                elif method == "disconnect":
                    result = await service.disconnect(**params)
                elif method == "get_dialogs":
                    result = await service.get_dialogs(**params)
                elif method == "fetch_messages":
                    result = await service.fetch_messages(**params)
                elif method == "send_message":
                    result = await service.send_message(**params)
                elif method == "ping":
                    result = {"pong": True}
                else:
                    error = {"code": -32601, "message": f"Method not found: {method}"}
            except Exception as e:
                error = {"code": -32000, "message": str(e)}

            response = {"jsonrpc": "2.0", "id": req_id}
            if error:
                response["error"] = error
            else:
                response["result"] = result

            write_jsonrpc_message(response)

        except json.JSONDecodeError as e:
            error_response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Parse error: {e}"},
            }
            write_jsonrpc_message(error_response)

    semaphore = asyncio.Semaphore(32)
    in_flight: set[asyncio.Task] = set()

    async def run_request(line: str) -> None:
        await semaphore.acquire()
        try:
            await process_request(line)
        finally:
            semaphore.release()

    while True:
        try:
            line = await input_queue.get()

            if line is None:
                break

            if line:
                task = asyncio.create_task(run_request(line))
                in_flight.add(task)

                def _done(t: asyncio.Task) -> None:
                    in_flight.discard(t)

                task.add_done_callback(_done)

        except Exception as e:
            print(f"Unexpected error: {e}", file=sys.stderr)

    if in_flight:
        await asyncio.gather(*in_flight, return_exceptions=True)

    shutdown_event.set()

    for account_id in list(service.clients.keys()):
        try:
            await service.disconnect(account_id)
        except Exception:
            pass

    shutdown = getattr(service, "shutdown", None)
    if shutdown is not None:
        try:
            await shutdown()
        except Exception:
            pass

    http_client = getattr(service, "http_client", None)
    if http_client is not None:
        try:
            await http_client.aclose()
        except Exception:
            pass

    shutdown_stdout_writer()
