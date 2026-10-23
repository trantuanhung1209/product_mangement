import logging
import time
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send


logger = logging.getLogger("app.lifecycle")
logger.setLevel(logging.INFO)


class RequestLoggingMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid4().hex
        started_at = time.perf_counter()
        status_code: int | None = None
        method = scope["method"]
        path = scope["path"]
        logger.info("Request started method=%s path=%s request_id=%s", method, path, request_id)

        async def send_with_timing(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                duration_ms = (time.perf_counter() - started_at) * 1000
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (b"x-request-id", request_id.encode()),
                        (b"x-process-time-ms", f"{duration_ms:.2f}".encode()),
                    ]
                )
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_timing)
        except Exception:
            logger.exception("Request failed method=%s path=%s request_id=%s", method, path, request_id)
            raise
        else:
            duration_ms = (time.perf_counter() - started_at) * 1000
            logger.info(
                "Request completed method=%s path=%s status=%s duration_ms=%.2f request_id=%s",
                method,
                path,
                status_code,
                duration_ms,
                request_id,
            )
