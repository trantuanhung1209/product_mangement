# Verification evidence

## Automated

Đã chạy ngày 23/10/2026:

```text
backend/.venv/bin/python -m pytest backend/tests -q
8 passed, 1 warning in 0.67s
```

Coverage gồm status, JSON content type của 200/404/422, Pydantic validation/malformed JSON, middleware order, request ID, timing header, 500 re-raise/default response và slow endpoint mock delay.

## Runtime Uvicorn

Đã chạy Uvicorn với `ENABLE_LAB_ROUTES=true` ở port 8002/8003.

| Request | Evidence |
|---|---|
| success | 200, `application/json`, request/timing headers |
| HTTPException | 404, `application/json`, request/timing headers |
| validation | 422, `application/json`, request/timing headers |
| RuntimeError | 500, `text/plain; charset=utf-8`, body `Internal Server Error` |
| slow | client `2.002629s`; process header `2001.17ms` |

Runtime log ở port 8003 xác nhận success order đầy đủ; validation chỉ có A/B before và after, không endpoint. Không có browser/frontend verification vì Phase 00B chỉ thêm development API lab.
