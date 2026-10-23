# Phase 01 — Database Report

**Ngày chạy:** 23/10/2026 (Asia/Ho_Chi_Minh)
**Trạng thái:** PASS.

## Những gì đã làm

- Thêm SQLAlchemy 2.1.6, Alembic 1.20.1, psycopg 3.3.6 và config `DATABASE_URL`/pool từ `.env`.
- Tạo Engine pool, `SessionLocal`, FastAPI-compatible `get_db()` generator dependency với rollback/close rõ ràng.
- Tạo `Category` và `Product`, relationship hai chiều, `Numeric(10,2)`, unique category, FK RESTRICT, UTC timestamps.
- Tạo Alembic config và migration `20261023_01_create_catalog_tables`; không dùng `create_all()`.
- Tạo integration tests và bốn thí nghiệm database; không thêm CRUD, Redis, frontend hay Docker Compose.

## Tests pass/fail

- `alembic -c backend/alembic.ini upgrade head`: PASS trên PostgreSQL test container.
- `pytest backend/tests -q` với `TEST_DATABASE_URL`: PASS — 16 passed, 1 warning upstream `TestClient`.
- Schema query trực tiếp xác nhận hai tables, `numeric(10,2)`, `timestamp with time zone`, unique name và FK `ON DELETE RESTRICT`.
- Phase 00/00B tests nằm trong suite và vẫn pass; runtime `/health` và `/docs` đều trả HTTP 200.

## Kết quả 4 thí nghiệm

| Thí nghiệm | Result |
|---|---|
| Connection pool | Hai `engine.connect()` tuần tự với pool size 1 chỉ tạo 1 physical connection. Không phải request nào cũng tạo PostgreSQL connection mới. |
| Session lifecycle | Generator `get_db()` close Session sau yield; sau `SELECT 1`, pool `checkedout()` trở về 0. |
| Transaction | Commit persist category; rollback không persist category. Unique/FK error cần rollback trước reuse Session. |
| Connection leak | Pool test size 1, max overflow 0: giữ một connection làm connection thứ hai timeout; đóng held connection thì connection mới lại chạy được. Cleanup luôn nằm trong `finally`. |

## Những vấn đề còn lại

- Integration test cần `TEST_DATABASE_URL` riêng; không bao giờ trỏ biến này tới database developer/production.
- Docker Desktop ban đầu chưa chạy; sau khi daemon sẵn sàng, container `postgres:16-alpine` tạm ở port 55432 đã dùng để verify. Không mount volume; container đã được dừng/xóa sau verification.
- Warning deprecation của FastAPI/Starlette `TestClient` là upstream; không ảnh hưởng kết quả test.
