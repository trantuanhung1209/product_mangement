# Request flow thực tế

```text
HTTP client → Uvicorn H11Protocol → ASGI scope/receive/send
  → ServerErrorMiddleware → Timing (A) → Lifecycle (B)
  → ExceptionMiddleware → FastAPI route handler
  → body parse + solve_dependencies + Pydantic validation
  → endpoint → serialize_response → send response
```

Đăng ký B trước rồi A trong `app/main.py` tạo A ở phía ngoài B. Đây không phải giả định: `Starlette.build_middleware_stack()` ở `starlette/applications.py:63` ghép `ServerErrorMiddleware`, `user_middleware`, `ExceptionMiddleware`, rồi bọc bằng `reversed(middleware)`.

Với `POST /lab/validate`, `fastapi.routing.get_request_handler()` (`fastapi/routing.py:397`) đọc body, sau đó gọi `solve_dependencies()` (`fastapi/dependencies/utils.py:643`). Nếu body JSON hoặc field không hợp lệ, FastAPI tạo `RequestValidationError`; endpoint `validate()` không chạy. Nếu hợp lệ, model `InventoryInput` đi vào hàm và response model được serialize bởi `fastapi.routing.serialize_response()` (`:320`).

So với Spring Boot: đây giống DispatcherServlet → filter chain → argument resolver / Bean Validation → controller → message converter. Điểm cần nhớ: `X-Process-Time-Ms` là thời gian app middleware đo; nó không mặc định là toàn bộ TCP/client latency.
