# Phase 00B — Request Lifecycle Lab Report

**Ngày chạy:** 23/10/2026 (Asia/Ho_Chi_Minh)
**Trạng thái:** PASS — chỉ Phase 00B; không triển khai Phase 01.

## Implemented files

- `backend/app/core/middleware.py`: middleware A (timing/request ID) và B (lifecycle).
- `backend/app/schemas/lab.py`, `backend/app/routers/lab.py`: năm development-only endpoints.
- `backend/app/main.py`, `backend/app/core/config.py`, `.env.example`: registration có điều kiện qua `ENABLE_LAB_ROUTES`.
- `backend/tests/test_lab.py`: lifecycle, errors, validation, headers, timing và lab gating.
- `docs/learning/phase-00b/*.md`: 8 tài liệu học/verification theo yêu cầu.

## Framework versions

FastAPI 0.161.1, Starlette 1.9.0, Uvicorn 0.54.0, Pydantic 2.14.1.

## Request lifecycle

```text
Client → Uvicorn H11Protocol → ServerErrorMiddleware → A timing → B lifecycle
       → ExceptionMiddleware → FastAPI parse/validate/dependencies → endpoint
       → response serialization → B → A → client
```

Source evidence: `Starlette.build_middleware_stack` (`starlette/applications.py:63`), `ServerErrorMiddleware` (`starlette/middleware/errors.py:127`), `ExceptionMiddleware` (`starlette/middleware/exceptions.py:18`), `get_request_handler` (`fastapi/routing.py:397`), `solve_dependencies` (`fastapi/dependencies/utils.py:643`), `Request.stream/body/json` (`starlette/requests.py:235/255/264`) và Uvicorn `H11Protocol` (`uvicorn/protocols/http/h11_impl.py:41`).

## Middleware experiment results

Đăng ký B rồi A cho log thực tế `A before → B before → Endpoint → B after → A after`. 404 và 422 chạy cả hai after và có `X-Request-ID`, `X-Process-Time-Ms`. RuntimeError khiến B/A log exception rồi re-raise; after không chạy và 500 mặc định không có hai header vì nó do outer `ServerErrorMiddleware` tạo.

## Error experiment results

| Scenario | Result thực tế |
|---|---|
| success | 200 JSON |
| `HTTPException` | 404 JSON |
| Pydantic/malformed JSON | 422 JSON trước endpoint |
| `RuntimeError` | 500 plain-text `Internal Server Error`; stack vẫn được re-raised |
| slow | client 2.002629s; process-time 2001.17ms |

## Tests thực tế

- `backend/.venv/bin/python -m pytest backend/tests -q`: PASS — 9 passed, 1 upstream deprecation warning.
- Uvicorn runtime tại ports 8002/8003: success, 404, 422, 500 và slow đã được gọi bằng curl.

## Problems encountered

- Uvicorn default log configuration ban đầu chỉ hiện exception từ app logger, không hiện INFO lifecycle. Lab giờ khởi tạo standard logging ở INFO chỉ khi lab routes được bật.
- FastAPI 0.161.1 đưa `_IncludedRouter` vào `app.routes`; test routing cần không giả định mọi object có `.path`.
- `TestClient` emits an upstream deprecation warning. Không thêm dependency hay workaround không cần thiết.

## Unverified items

- Không đo concurrency/load hoặc client network latency ngoài localhost; đây không phải mục tiêu lab.
- Không browser-verify frontend vì Phase 00B không thay đổi frontend.

## Git

- Branch: `feature/phase-00b-request-lifecycle`
- Commits: xem `git log --oneline feature/phase-00-foundation..HEAD` sau khi handoff.

## Questions cần tự trả lời

Xem [REVIEW_QUESTIONS.md](learning/phase-00b/REVIEW_QUESTIONS.md): trọng tâm là middleware order, 422 trước endpoint, 500 propagation và giới hạn của application timing.
