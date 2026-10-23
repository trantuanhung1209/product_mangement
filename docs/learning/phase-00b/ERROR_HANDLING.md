# Error handling internals

## Ba loại lỗi trong lab

| Trigger | Response thực tế | Endpoint chạy? | Chủ thể xử lý |
|---|---|---:|---|
| `/lab/http-error` raise `HTTPException(404)` | 404 JSON `{"detail": ...}` | Có | `ExceptionMiddleware` + handler FastAPI |
| invalid/malformed `POST /lab/validate` | 422 JSON `detail` | Không | FastAPI `RequestValidationError` handler |
| `/lab/unhandled-error` raise `RuntimeError` | 500 `text/plain` | Có | `ServerErrorMiddleware` mặc định |

`ExceptionMiddleware` ở `starlette/middleware/exceptions.py:18` khởi tạo handler cho `HTTPException`; FastAPI đăng ký handler riêng cho `RequestValidationError`. Vì exception handled được đổi thành ASGI response *bên trong* user middleware, B và A nhận được response rồi log `after` và thêm headers.

`ServerErrorMiddleware` ở `starlette/middleware/errors.py:127` bọc toàn stack. Với `debug=False` và không có custom 500 handler, nó gửi `Internal Server Error`, sau đó luôn re-raise exception. Đây là lý do `TestClient` mặc định ném lại `RuntimeError`; `TestClient(..., raise_server_exceptions=False)` mới cho test quan sát HTTP 500.

500 mặc định là plain text, nên yêu cầu content-type JSON chỉ áp dụng response API handled trong lab (200/404/422). Không thêm custom JSON 500 handler: mục tiêu là quan sát behavior mặc định của ServerErrorMiddleware.
