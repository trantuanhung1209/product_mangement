# Phase 15 — Integration testing và rà soát rủi ro

## 1. Cách chạy test an toàn

Test auth chạy migration và xóa dữ liệu, nên **không bao giờ** trỏ vào database
dev. Dùng database, Redis và bucket riêng:

```bash
cd backend && source .venv/bin/activate
export TEST_DATABASE_URL='postgresql+psycopg://…/product_catalog_test'
export TEST_REDIS_URL='redis://localhost:6379/15'
pytest -v -rs          # -rs liệt kê test bị skip và lý do
```

- Test bị **skip không được tính là pass**. Lần chạy đầy đủ cuối cùng: 111 passed,
  0 skipped, 0 failed (Python 3.14 và 3.11).
- `tests/conftest.py` luôn ép `MINIO_BUCKET=product-images-test` (đổi bằng
  `TEST_MINIO_BUCKET`). Đã kiểm chứng: sau khi chạy toàn bộ suite, số object trong
  bucket dev `product-images` không đổi.
- Đã kiểm chứng test không phụ thuộc DB/Redis dev: với `DATABASE_URL` và
  `REDIS_URL` trỏ vào cổng không tồn tại, chỉ còn `TEST_*` hợp lệ, suite vẫn pass.
- Frontend: `cd frontend && npm test && npm run typecheck && npm run build`
  (76 test, API được mock; không cần backend).

## 2. Ma trận kiểm thử

| Phạm vi | Trạng thái | Test chính |
| --- | --- | --- |
| Auth: login, logout, refresh rotation, CSRF, blacklist, revoke phiên | COVERED | `test_auth.py`; frontend `sessionExpiry.test.tsx` |
| RBAC 401/403 | COVERED | `test_rbac.py`: 24 route; có test chặn route mới chưa được phân loại |
| Product CRUD, upload ảnh, upload lỗi rồi lưu lại | PARTIAL | `test_api.py`, `test_image_cache_race.py`; UI chỉ test với API giả |
| Ảnh MinIO, cleanup task, orphan | COVERED (CLI orphan chỉ test qua service) | `test_auth.py` (MinIO thật), `test_image_cleanup.py`, `test_image_cache_race.py` |
| Giỏ hàng: cô lập user, đồng thời | COVERED | `test_cart.py`, `test_cart_isolation.py` |
| Filter, search, cursor | COVERED | `test_product_query.py`, `test_product_cursor.py`, `test_cursor_tamper.py`; giao diện: `useProductsCursor.test.tsx`, `StorefrontShopPage.test.tsx` |
| Rate limit 429 + `Retry-After` | COVERED | `test_rate_limit.py`, `test_rate_limit_routes.py` |
| Cache invalidation + fallback | COVERED | `test_cache.py`, `test_image_cache_race.py` |
| Security headers, trusted proxy, log, lỗi 500/422 | COVERED | `test_security_hygiene.py`, `test_rate_limit.py` |
| Frontend ↔ backend thật (E2E trên trình duyệt) | MISSING | quyết định: không làm ở phase này |

## 3. Lỗi tìm được và đã sửa

Mỗi lỗi có test tái hiện chạy **fail trước khi sửa**.

1. **Upload ảnh chặn event loop.** `upload_product_image` là `async def` nhưng làm
   việc đồng bộ (Pillow, MinIO, DB): một upload chậm làm mọi request khác chờ
   (`/health` chờ 0,83 s). Sửa: đổi thành `def` để FastAPI chạy trong threadpool.
   Test: `test_slow_image_processing_does_not_block_other_requests`.
2. **Lỗi 422 phản hồi lại giá trị đã gửi.** FastAPI trả `"input"` trong từng lỗi, kể
   cả mật khẩu (`{"input": {"password": "…"}}`). Sửa: handler `RequestValidationError`
   trong `app/main.py` bỏ trường `input`, giữ `loc`, `msg`, `type`. Test:
   `test_validation_errors_do_not_echo_submitted_values`.
3. **Endpoint thu hồi phiên không có rate limit.** `DELETE /auth/sessions/{id}`,
   `/auth/sessions/others` và hai route revoke của admin nay dùng
   `limit_user_mutation` (30/phút/user, chung bộ đếm với các mutation khác). Test:
   `test_session_revocation_endpoints_are_rate_limited_per_user`.
4. **Secret yếu lọt qua kiểm tra khởi động.** Trước đây chỉ kiểm tra độ dài, tính
   khác nhau và placeholder. Nay từ chối thêm secret có dưới 8 ký tự khác nhau hoặc
   là một khối lặp lại (`"ab" * 20`, `"0123456789" * 4`). Với 200 000 secret hex
   32 ký tự ngẫu nhiên không có cái nào bị từ chối nhầm. Test trong `test_config.py`.
5. **Test có thể ghi vào bucket MinIO dev.** Xem mục 1; đã ép bucket test trong
   `conftest.py`.

## 4. Rủi ro đã giải quyết

- **Dependency chưa ghim.** Backend: `pyproject.toml` ghim chính xác, kèm
  `backend/requirements.lock` (48 package) lấy từ venv đã chạy test. Frontend: mọi
  dependency dùng version chính xác (không còn `latest`, `^`, `~`). Lock backend đã
  được cài vào venv mới trên Python 3.14 và 3.11 rồi chạy đủ 111 test.
- **Chưa chắc test có chạm DB dev hay không:** đã kiểm chứng (mục 1).

Nâng cấp dependency: sửa version, chạy lại toàn bộ test, rồi tạo lại lock backend
từ `pip list --format=freeze` (bỏ `pip` và gói `product-catalog-api`).

## 5. Rủi ro còn lại và giới hạn

- **Không có E2E với backend và trình duyệt thật.** Frontend test mock tầng API
  hoặc Axios adapter. Nếu cần, đề xuất Playwright, nhưng phải thêm dependency và
  tải trình duyệt, nên chưa làm.
- **Chưa có ESLint**, nên không có bước lint. Thêm ESLint là dependency mới, chưa
  làm.
- **Chưa chạy app trên trình duyệt** trong phase này.
- **Cursor chỉ dùng một phần ở giao diện.** `/shop` dùng cursor (“Tải thêm”) cho
  thứ tự mặc định và quay về offset khi chọn sắp xếp khác; admin và trang chủ vẫn
  dùng offset vì cần tổng số, nhảy trang và nhiều kiểu sắp xếp (xem
  `PHASE_13_LEARNING.md` mục 12). Muốn cursor cho các thứ tự khác phải mở rộng
  backend (cursor và index riêng cho từng thứ tự).
- **Backend chưa có Dockerfile** (Phase 16).
- **Kiểm tra secret chỉ là heuristic** (độ dài, tính khác nhau, placeholder, ít ký
  tự khác nhau, lặp khối). Không đo được entropy thật; secret do con người đặt vẫn
  có thể yếu. Luôn sinh bằng `openssl rand -hex 32`.
- **Log truy cập của uvicorn ở production in cả query string.** Ứng dụng không đặt
  secret vào URL (đã kiểm tra), nhưng đừng thêm token vào query string.
- **Test để lại dữ liệu** trong `product_catalog_test` (mỗi test dùng tên duy nhất).
  Có thể tạo lại database test khi cần.
- **Pin Python:** lock đã chạy được trên 3.11 và 3.14; các phiên bản Python khác
  chưa kiểm chứng.
- Bucket `product-images-test` được tạo trong MinIO dev và được giữ lại để tái dùng.
