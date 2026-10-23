# Timing và logging

`TimingMiddleware` tạo `uuid4().hex` cho từng HTTP request, ghi `A before`, và bọc `send`. Khi nhận `http.response.start`, nó thêm:

- `X-Request-ID`
- `X-Process-Time-Ms` (mili-giây từ `time.perf_counter()`)

Log `A after` gồm method, path, status, duration và request ID. Request body không được log, nên `name`/payload không bị ghi ra log.

Kết quả chạy `/lab/slow` bằng Uvicorn:

```text
client_total_seconds=2.002629
x-process-time-ms: 2001.17
```

`await asyncio.sleep(2)` nhường event loop thay vì block thread. Application duration là khoảng A đo; endpoint duration là thời gian bên trong endpoint (lab không đo riêng); client-observed latency còn gồm network, request body upload và response transfer. Với `RuntimeError`, response 500 do outer `ServerErrorMiddleware` tạo nên A không nhìn thấy `http.response.start`: không có hai header và không có `A after`.

Khi bật lab, `logging.basicConfig(level=logging.INFO)` giúp log INFO hiển thị với Uvicorn mặc định. Production nên cấu hình handler/format/central log ở entrypoint vận hành, không sao chép body request vào log.
