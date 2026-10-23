# ASGI và request parsing

ASGI app là async callable nhận:

- `scope`: metadata một connection/request, ví dụ `type`, `method`, `path`, headers.
- `receive`: awaitable lấy event như `http.request` với bytes body.
- `send`: awaitable gửi event `http.response.start` và `http.response.body`.

Uvicorn `H11Protocol` nằm tại `uvicorn/protocols/http/h11_impl.py:41`; nó dùng h11 để chuyển bytes HTTP thành ASGI events và chuyển events send thành HTTP bytes. Uvicorn không biết route hay Pydantic.

`starlette.requests.Request.stream()` (`starlette/requests.py:235`) lặp `receive()` cho đến khi `more_body=False`. `Request.body()` (`:255`) gom chunk rồi cache bytes; `Request.json()` (`:264`) gọi `json.loads` trên body cache. FastAPI gọi các API này trong `get_request_handler()`.

Với JSON lỗi cú pháp, FastAPI bắt `json.JSONDecodeError` ngay trong `get_request_handler()` và phát sinh `RequestValidationError`. Với JSON đúng cú pháp nhưng `name=""`, `price=0`, `stock=-1`, Pydantic 2 kiểm tra constraints của `InventoryInput`. Cả hai trả 422 trước khi `logger.info("Endpoint: validate")` có thể chạy.

So với NestJS, ASGI scope gần `Request` metadata, `receive` gần body stream, và Pydantic validation ở đây đóng vai trò ValidationPipe. Đừng đọc body stream nhiều lần tùy tiện: Starlette bảo vệ stream đã consumed; dùng `body()` khi cần bytes được cache.
