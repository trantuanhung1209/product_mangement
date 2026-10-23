# Phase 00 — Verification Report

**Ngày chạy:** 23/10/2026 (Asia/Ho_Chi_Minh)  
**Trạng thái:** PASS — phạm vi Phase 00 hoàn tất.

## Files created

- `.gitignore`, `.env.example`, `README.md`
- `backend/pyproject.toml`
- `backend/app/main.py`, `backend/app/core/config.py`
- `backend/app/routers/health.py`, `backend/app/schemas/health.py` cùng các package marker cần thiết
- `backend/tests/test_health.py`
- `frontend/package.json`, TypeScript/Vite config, `index.html`
- `frontend/src/api.ts`, `App.tsx`, `main.tsx`, `components/Header.tsx`, `pages/HomePage.tsx`, `pages/NotFoundPage.tsx`
- `docs/PHASE_00_FOUNDATION.md` và báo cáo này

`frontend/package-lock.json` được sinh bởi `npm install` để chốt dependency frontend.

## Architecture summary

- Root `.env` (copy từ `.env.example`) tập trung `CORS_ORIGINS` cho FastAPI và `VITE_API_URL` cho Vite.
- Pydantic Settings đọc `.env`, parse `CORS_ORIGINS` thành `list[str]`; biến Vite không liên quan được bỏ qua an toàn.
- Uvicorn chạy FastAPI; `main.py` đăng ký CORS middleware và health router.
- React Router định tuyến Home/Not Found. `HomePage` gọi Axios `GET /health` lúc mount và khi người dùng bấm nút, thể hiện loading/success/error.
- Không có PostgreSQL, ORM, migrations, Redis, JWT, CRUD, Docker hay UI framework.

## Commands tested and results

| Check | Command / method | Result |
|---|---|---|
| Backend dependency install | `backend/.venv/bin/python -m pip install -e 'backend[dev]'` | PASS |
| Backend unit test | `backend/.venv/bin/python -m pytest backend/tests` | PASS — 1 passed |
| API health runtime | `curl -i http://127.0.0.1:8000/health` | PASS — HTTP 200, expected JSON |
| Swagger runtime | `curl -I http://127.0.0.1:8000/docs` | PASS — HTTP 200 |
| Default CORS runtime | OPTIONS request with `Origin: http://localhost:5173` | PASS — `access-control-allow-origin: http://localhost:5173` |
| Environment CORS runtime | Started temporary port 8001 with `CORS_ORIGINS='["http://example.test"]'` and sent OPTIONS | PASS — response allowed `http://example.test` |
| Frontend dependency install | `cd frontend && npm install` | PASS — no vulnerabilities reported |
| TypeScript | `cd frontend && npm run typecheck` | PASS |
| Production build | `cd frontend && npm run build` | PASS |
| Frontend dev server | `npm run dev -- --host 127.0.0.1`; requested `/` | PASS — HTTP 200 |

Browser automation was attempted, but no browser surface was available in this environment. The visual click flow is therefore not browser-verified; the API request, CORS preflight, frontend build and dev server were all verified independently.

## Known issues

- The frontend intentionally has minimal unstyled HTML; UI design is not in Phase 00.
- The Vite API URL is build-time environment input. Restart `npm run dev` after changing `.env`.
- The backend unit test emits an upstream FastAPI/Starlette deprecation warning about `TestClient`; it does not fail the test and no code workaround was added in this foundation phase.

## Git branch and commits

- Branch: `feature/phase-00-foundation`
- Commit: recorded after final status check in this report's implementation handoff.

## Kiến thức cần hiểu trước Phase 01

1. Kích hoạt đúng Python virtual environment và cài dependency từ `pyproject.toml`.
2. Route FastAPI, Pydantic response schema, và cách Uvicorn import `app.main:app`.
3. Tách config theo environment; không commit `.env` hay secret.
4. Browser cần CORS khi React và API chạy khác origin; `curl` thành công không tự chứng minh CORS.
5. Axios `baseURL` + React state quyết định UI hiển thị trạng thái request.
6. Dùng `/docs`, `curl /health`, TypeScript typecheck và build như các kiểm tra nền tảng trước khi thêm feature.
