# Phase 01 — Database Learning

## Engine, Pool, Connection, Session

`engine` trong `app/db/database.py` là factory SQLAlchemy gắn với `DATABASE_URL`; nó không phải một connection đơn lẻ. Engine chứa connection pool với `pool_size`, `max_overflow` và `pool_pre_ping=True`. Mỗi `engine.connect()` mượn một physical connection từ pool, thực hiện SQL rồi trả lại khi `close()` hoặc context manager kết thúc. `SessionLocal` tạo ORM `Session`, một unit of work theo dõi objects và transaction; Session chỉ mượn connection khi thật sự cần query/flush. Trong NestJS TypeORM, Engine gần `DataSource`, Connection là client từ driver pool, còn Session gần `EntityManager`/transaction scope.

## Request lấy và trả connection

`get_db()` là FastAPI generator dependency: tạo `Session`, `yield` cho endpoint tương lai, rollback nếu endpoint raise exception, rồi luôn `close()` trong `finally`. `close()` không đóng TCP connection; nó trả connection về pool để request sau tái sử dụng. Test `test_session_dependency_closes_connection` chạy `SELECT 1`, đóng generator và kiểm tra `pool.checkedout() == 0`. Hiện chưa có CRUD endpoint nên dependency chưa được gắn vào route — đó là việc Phase API sau, không cần tạo endpoint giả ở Phase 01.

## Commit và rollback

`session.commit()` flush SQL và xác nhận transaction: test sau đó mở Session khác vẫn thấy category. `session.rollback()` hủy transaction chưa commit: test không thấy category rollback ở Session khác. Khi `IntegrityError` xảy ra (unique/FK), Session phải rollback trước khi tái sử dụng. Test `test_commit_persists_and_rollback_discards` và log `experiment=transaction` chứng minh hai kết quả này. TypeORM tương đương `queryRunner.commitTransaction()` / `rollbackTransaction()`.

## Alembic

Alembic quản lý lịch sử schema có version, thay vì `Base.metadata.create_all()`. `migrations/versions/20261023_01_create_catalog_tables.py` là migration đầu tiên, tạo `categories` rồi `products` với foreign key. `alembic upgrade head` so sánh version hiện tại trong bảng `alembic_version` và chạy migration chưa áp dụng. `migrations/env.py` nạp `Base.metadata` để autogenerate có thể thấy models sau này; migration hiện tại được review và viết rõ ràng.

## Decimal và UTC

`Product.price` là `Numeric(10, 2)` và annotation `Decimal`, tránh sai số binary float cho tiền. `created_at`/`updated_at` dùng `DateTime(timezone=True)` với `datetime.now(UTC)` trong ORM và `now()` server default trong migration; PostgreSQL schema xác nhận `timestamp with time zone`. PostgreSQL chuẩn hóa instant `timestamptz`, còn application luôn tạo datetime UTC. Không tự động serialize Decimal sang JSON ở Phase này vì chưa có API Product.
