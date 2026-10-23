# Thí nghiệm có thể chạy lại

Chạy server lab:

```bash
cd backend
ENABLE_LAB_ROUTES=true .venv/bin/uvicorn app.main:app --reload --log-level info
```

| # | Hypothesis / command | Actual result đã chạy | Interpretation |
|---|---|---|---|
| 1 | `curl -i :8002/lab/success` trả 200 | 200 JSON, request ID/timing headers | normal flow về được A |
| 2 | Xem log khi success | `A before → B before → Endpoint → B after → A after` | thứ tự đăng ký B rồi A tạo order thực tế này |
| 3 | `curl -i -X POST :8002/lab/validate -H 'content-type: application/json' -d '{"name":"","price":0,"stock":-1}'` | 422 JSON; không có `Endpoint: validate` trong log | Pydantic validation trước endpoint |
| 4 | `curl -i :8002/lab/http-error` và `/lab/unhandled-error` | 404 JSON có headers; 500 plain text không headers | ExceptionMiddleware xử lý 404, ServerErrorMiddleware xử lý 500 |
| 5 | `curl -w '%{time_total}' :8002/lab/slow` | client 2.002629s; process header 2001.17ms | `asyncio.sleep` tạo wait I/O giả lập |

Chạy unit experiments không cần server:

```bash
backend/.venv/bin/python -m pytest backend/tests -q
```

Kết quả thực tế: `8 passed` (có một warning deprecation upstream của FastAPI/Starlette TestClient).
