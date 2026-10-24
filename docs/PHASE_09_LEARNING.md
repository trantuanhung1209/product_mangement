# Phase 09 — Xử lý ảnh sản phẩm

`JPEG` phù hợp ảnh chụp, `PNG` giữ transparency, còn `WebP` thường nhỏ hơn ở chất
lượng nhìn tương đương. `process_image()` dùng Pillow để giải mã ảnh thật thay vì
tin extension/MIME client gửi, kiểm tra kích thước byte và pixel, sửa EXIF
orientation, resize tối đa 1600px rồi xuất WebP quality 82. Quality 82 là cân
bằng thông dụng giữa dung lượng và chi tiết; không lưu file gốc hoặc EXIF/GPS.

Magic bytes chỉ là dấu hiệu ban đầu; cách chắc chắn hơn là Pillow mở/giải mã file.
Giới hạn pixel cũng chặn ảnh nén độc hại (decompression bomb). PNG/WebP có alpha
được giữ bằng mode `RGBA`; JPEG chuyển sang RGB.

PostgreSQL chỉ lưu object key, width và height; binary WebP nằm trong MinIO private
bucket. Route public `/products/{id}/image` đọc object rồi trả `image/webp`, nên
frontend không giữ MinIO credentials. Khi thay ảnh: object mới upload trước,
commit DB sau; commit lỗi sẽ xóa object mới. Object cũ xóa lỗi không làm Product
trỏ đến ảnh mới bị mất; task cleanup được lưu trong PostgreSQL để retry thủ công.

## Flow upload ảnh mới

```text
Admin chọn file trên Product Form
  → React preview bằng Object URL và gửi multipart/form-data
  → FastAPI kiểm tra JWT session, role ADMIN, CSRF và Origin
  → process_image() mở/giải mã ảnh bằng Pillow
  → sửa EXIF orientation, resize nếu rộng hơn 1600px, xuất WebP quality 82
  → upload object UUID .webp vào MinIO private bucket
  → PostgreSQL lưu image_object_key, width, height và URL proxy
  → frontend nhận Product mới, hiển thị qua /api/v1/products/{id}/image
```

Frontend chỉ kiểm tra sớm loại file và 5 MB để phản hồi nhanh. Backend vẫn là lớp
quyết định: không tin extension, `Content-Type` hay filename do browser gửi.

## Flow thay ảnh

```text
1. Xử lý và upload ảnh mới vào object key mới.
2. Commit metadata mới trong PostgreSQL.
3. Chỉ sau commit mới xóa object ảnh cũ.
```

Thứ tự này rất quan trọng. Nếu upload thành công nhưng commit database thất bại,
route rollback rồi xóa object mới để tránh orphan. Nếu xóa ảnh cũ thất bại sau
commit, Product vẫn trỏ tới ảnh mới hợp lệ; ảnh cũ là orphan cần được dọn lại,
không được làm request upload thất bại hay quay metadata về ảnh cũ.

## Orphan cleanup bền vững

Trước khi commit replace, delete ảnh hoặc xóa Product, backend tạo một record
`image_cleanup_tasks` trong **cùng transaction**. Vì vậy không có khoảng trống
giữa lúc Product không còn tham chiếu object và lúc task cần retry bị mất. Sau
commit, `run_image_cleanup()` kiểm tra lại `products.image_object_key`; nếu object
đã được tham chiếu thì bỏ task, còn không thì xóa object và task. MinIO lỗi chỉ
giữ task lại, không biến mutation đã commit thành lỗi với frontend.

```bash
cd backend
python -m scripts.cleanup_orphan_images --dry-run
python -m scripts.cleanup_orphan_images
```

Command không quét bucket. Nó idempotent: object đã mất được xem là đã dọn; retry
nhiều lần không làm mất ảnh đang được Product tham chiếu. UUID key mới cho mỗi
lần upload và lock Product khi mutation giảm race replace/cleanup; nếu sau này có
dịch vụ khác được phép gắn lại object key cũ, cần bổ sung distributed lock/outbox.

## Flow xóa ảnh

Admin gọi `DELETE /api/v1/products/{id}/image`. Backend xóa metadata khỏi Product
và commit trước, rồi mới yêu cầu MinIO xóa object cũ. Nhờ vậy frontend sẽ hiển thị
fallback “Chưa có hình ảnh” thay vì URL đến object đã mất. User thường không gọi
được endpoint này vì Product mutation bắt buộc ADMIN + CSRF.

## Xem ảnh public nhưng bucket private

Browser gọi `GET /api/v1/products/{id}/image`, không gọi MinIO trực tiếp. Route
tìm Product trước, đọc đúng `image_object_key` từ PostgreSQL và trả body với
`Content-Type: image/webp`. Vì client không có object key tùy ý hay MinIO
credential, bucket vẫn private trong khi Product Detail/Table vẫn hiển thị ảnh.

## MinIO local và Docker Compose

Compose map S3 API sang `127.0.0.1:9010`; backend local dùng
`MINIO_ENDPOINT=127.0.0.1:9010`, không dùng Console port `9011`. Object storage
dùng named volume để giữ ảnh khi restart. MinIO tạo bucket khi upload đầu tiên;
bucket không có policy public, nên public access chỉ qua FastAPI proxy.

## Kiểm chứng local

Chạy `docker compose -f infra/compose.yml up -d`, kiểm tra `docker compose -f
infra/compose.yml ps` phải báo healthy. Integration test dùng PostgreSQL test
database và Redis database 15 theo README, nhưng upload thật vào MinIO tại 9010:

```bash
cd backend
export TEST_DATABASE_URL='postgresql+psycopg://product_catalog:product_catalog_dev@localhost:5432/product_catalog_test'
export TEST_REDIS_URL='redis://localhost:6379/15'
pytest
```

Test kiểm tra ADMIN upload JPEG/PNG/WebP, public proxy, replace/delete, cùng
Anonymous/USER/CSRF/Origin. Browser E2E vẫn nên kiểm tra thủ công vì pytest không
render giao diện React.
