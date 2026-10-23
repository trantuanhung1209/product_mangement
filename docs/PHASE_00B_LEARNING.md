# Phase 00B — FastAPI Request Lifecycle Learning

FastAPI chạy trên Starlette và Uvicorn: Uvicorn chuyển HTTP thành ASGI `scope`, `receive`, `send`; Starlette chạy middleware và routing; FastAPI parse request rồi gọi Pydantic/endpoint. Đây gần với server → filter chain → controller trong Spring Boot, nhưng ASGI dùng async callable.

`RequestLoggingMiddleware` trong `backend/app/core/middleware.py` là middleware ứng dụng còn giữ lại từ Phase 00B. Nó tạo `X-Request-ID`, đo thời gian bằng `time.perf_counter()`, ghi method/path/status/duration bằng `logging`, và không log request body. Thời gian này là application duration, không phải toàn bộ network latency client.

Khi response bắt đầu (`http.response.start`), middleware thêm `X-Request-ID` và `X-Process-Time-Ms`. Nếu exception chưa được xử lý đi ra ngoài middleware, nó được log rồi re-raise để `ServerErrorMiddleware` giữ nguyên 500/stack trace; middleware không che lỗi bằng response 200.

FastAPI validate JSON trước endpoint. Ví dụ `ProductCreate` trong `backend/app/schemas/product.py` trim name, kiểm tra `Decimal` price, stock, category ID và `HttpUrl`; dữ liệu lỗi trả 422 JSON, endpoint không chạy. Điều này tương đương NestJS DTO với ValidationPipe.

Business errors dùng `HTTPException` trong services. Ví dụ `get_product_or_404()` trả 404 JSON, còn duplicate category trả 409 sau rollback. Starlette `ExceptionMiddleware` chuyển `HTTPException` thành response JSON; SQL exception không bị trả trực tiếp cho client.
