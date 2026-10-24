# Phase 07 — Seed Data & Testing

## 1. Seed data khác migration thế nào?

Migration thay đổi cấu trúc database, ví dụ tạo bảng `products`; Alembic quản lý
thứ tự các migration đó. Seed chỉ thêm dữ liệu mẫu vào cấu trúc đã có. Script
`scripts.seed` không gọi `create_all()` hay tạo migration: nó dùng 10 danh mục
và 100 sản phẩm có marker ổn định trong description để lần chạy sau nhận diện
record đã seed. Vì vậy seed không ghi đè hay xóa sản phẩm người dùng đã sửa.

## 2. Unit test và integration test khác nhau thế nào?

Unit test cô lập một hàm nhỏ; ví dụ có thể kiểm tra formatter mà không gọi API.
Các test hiện có chủ yếu là integration test: `TestClient` gọi route FastAPI,
route dùng `Session` thật, rồi PostgreSQL và Redis test xác nhận kết quả. Điều
này chậm hơn nhưng phù hợp để bảo vệ transaction, foreign key, cache và query
SQL của Product Catalog.

## 3. pytest fixture hoạt động ra sao?

Fixture là hàm pytest chuẩn bị tài nguyên và `yield` để cleanup. Ví dụ fixture
`cache_redis` trong `tests/test_cache.py` ping Redis test, flush database 15
trước/sau mỗi test, rồi đóng client. Fixture `client` override `get_db` để API
dùng engine từ `TEST_DATABASE_URL`, không chạm database development.

## 4. Mock khác gọi service thật như thế nào?

Mock thay thế dependency để kiểm tra một nhánh khó tái tạo; `UnavailableRedis`
trong `test_cache.py` giả lập Redis lỗi. Ngược lại cache HIT/MISS, TTL và
invalidation chạy với Redis thật từ `TEST_REDIS_URL`. Ưu tiên service thật cho
database/cache vì mục tiêu là bắt lỗi integration, chỉ mock khi mô phỏng lỗi.

## 5. Vì sao cần test database riêng?

Test tạo category/product ngẫu nhiên, flush cache và có thể rollback. Nếu dùng
`DATABASE_URL` development thì dữ liệu học tập bị lẫn, còn production có nguy
cơ mất hoặc lộ dữ liệu. `TEST_DATABASE_URL` trỏ đến `product_catalog_test`;
Alembic và pytest chỉ được phép chạy tại đó. Redis test dùng database số 15,
khác database local mặc định là 0.

## 6. Đọc test failure và debug thế nào?

Chạy `pytest -x` để dừng ở lỗi đầu, rồi đọc assertion cuối cùng và response
status/body. Với API, thêm `-vv` để thấy tên test; với database, kiểm tra
`TEST_DATABASE_URL` và migration bằng `alembic current`. Với cache, dùng
`redis-cli -n 15 --scan` để kiểm tra key test, thay vì `KEYS *` trong code.

## 7. Kiểm thử API → Database → Redis → Frontend

Luồng thực tế là frontend Axios gọi `/api/v1/products`, FastAPI validate
Pydantic, service commit PostgreSQL rồi invalidate versioned cache Redis. Test
`test_cache.py` kiểm tra request đầu `MISS`, request kế `HIT`, mutation làm
request kế tiếp thành `MISS`. Ở frontend, `npm run typecheck` bảo vệ contract
TypeScript và `npm run build` kiểm tra bundle production; Browser Network giúp
kiểm tra payload mutation và header `X-Cache` khi chạy local.
