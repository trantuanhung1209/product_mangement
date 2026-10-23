# Phase 02 — REST API Report

**Ngày chạy:** 23/10/2026 (Asia/Ho_Chi_Minh)

## Files changed

- `app/api/router.py`, `app/api/v1/router.py`, API v1 endpoints Products/Categories.
- `app/schemas/product.py`, `app/schemas/category.py` cho create/PUT/PATCH/response contracts.
- `app/services/product.py`, `app/services/category.py` cho business rules và transaction boundary.
- `app/db/database.py` lazy-load Engine/Session factory để registration API không kết nối DB khi import.
- `tests/test_api.py` và hai tài liệu Phase 02.

## API table

| Resource | Methods |
|---|---|
| `/api/v1/products` | GET, POST |
| `/api/v1/products/{product_id}` | GET, PUT, PATCH, DELETE |
| `/api/v1/categories` | GET, POST |
| `/api/v1/categories/{category_id}` | PUT, DELETE |

POST trả 201; GET/PUT/PATCH trả 200; DELETE trả 204 không body. Not found là 404, request validation là 422, duplicate/FK conflict là 409 JSON.

## Test results

- `alembic -c backend/alembic.ini upgrade head`: PASS trên PostgreSQL test database.
- `pytest backend/tests -q` với `TEST_DATABASE_URL`: PASS — 22 passed, 1 upstream TestClient warning.
- API tests: category/product CRUD, PUT/PATCH, 422, duplicate 409, category missing 404, category FK conflict 409, rollback after duplicate, delete 204, JSON errors và prefix.
- Runtime: `/health`, `/docs`, `/lab/success` đều HTTP 200. OpenAPI có đủ bốn API v1 paths; tổng 16 operations (bao gồm health/lab).

## Những lỗi đã xử lý

- Database Engine cũ khởi tạo lúc import; API routes cần import `get_db`, nên đã lazy-load để Health/Lab không bị phụ thuộc connection khi import.
- Services rollback `IntegrityError` trước khi trả 409 để Session không bị lỗi transaction state.
- Category delete kiểm tra products trước delete và vẫn fallback 409 khi database constraint race xảy ra.

## Những vấn đề còn lại

- GET list chưa có pagination, search, filter hoặc sort theo đúng phạm vi Phase 02.
- Không có authentication/authorization và không có frontend CRUD.
- Database integration tests cần `TEST_DATABASE_URL` độc lập; không trỏ tới database development/production.
