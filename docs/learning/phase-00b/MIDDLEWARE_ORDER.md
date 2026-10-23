# Middleware order

Hai middleware thuần ASGI nằm ở `backend/app/core/middleware.py`:

- A = `TimingMiddleware`: tạo request ID, đo `perf_counter`, thêm response headers.
- B = `LifecycleMiddleware`: đánh dấu biên trước/sau inner app.

`app.add_middleware(LifecycleMiddleware)` chạy trước về mặt đăng ký, sau đó `app.add_middleware(TimingMiddleware)`. Do Starlette bọc ngược, request vào theo A → B → endpoint; response quay về B → A.

Kết quả đã chạy (`pytest` và Uvicorn port 8003):

```text
A before
B before
Endpoint: success
B after
A after status=200 duration_ms=...
```

| Case | B after | A after / headers | Lý do |
|---|---|---|---|
| 200 | Có | Có | endpoint trả response bình thường |
| 404 `HTTPException` | Có | Có | `ExceptionMiddleware` biến exception thành response ở phía trong B |
| 422 validation | Có | Có | FastAPI handler tạo response trước khi endpoint chạy |
| 500 `RuntimeError` | Không | Không | B/A re-raise; `ServerErrorMiddleware` ở ngoài tạo 500 |

Không dùng `try/except` để đổi exception thành 200. Các `except` trong A/B chỉ log rồi `raise`, nên stack trace và semantics 500 còn nguyên.
