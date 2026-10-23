# Phase 02 — REST API Learning

## 1. FastAPI parse JSON và Pydantic ở đâu?

Khi request vào endpoint như `create_product(payload: ProductCreate, ...)`, FastAPI đọc JSON và tạo `ProductCreate` trước khi gọi hàm endpoint. Constraints trong `app/schemas/product.py` kiểm tra `Decimal` price, stock, URL và `field_validator` trim/từ chối name rỗng. Nếu parse/validation fail, endpoint không chạy và FastAPI trả 422 JSON với `detail` là danh sách lỗi. Đây tương đương NestJS `ValidationPipe` + DTO, nhưng type/schema là Pydantic v2.

## 2. Request schema khác response schema thế nào?

`ProductCreate`, `ProductUpdate`, `ProductPatch` chỉ chứa field client được phép gửi; không có `id`, `created_at`, `updated_at`. `ProductResponse` chứa các field đọc được và `ConfigDict(from_attributes=True)` để FastAPI serialize ORM `Product`. Vì vậy client không thể inject ID/timestamp qua request, còn Decimal response vẫn được JSON hóa an toàn. Category cũng theo cùng pattern trong `schemas/category.py`.

## 3. Router khác Service thế nào?

`api/v1/endpoints/products.py` chỉ nhận HTTP, inject `get_db`, chọn status/response model. `services/product.py` tìm product/category, thay đổi ORM object và kiểm soát commit/rollback. Router giống NestJS controller; service tương ứng provider/service NestJS. Tách này giúp integration test kiểm tra API contract mà business rule không bị lẫn vào route.

## 4. PUT khác PATCH thế nào?

`PUT /products/{id}` nhận `ProductUpdate`: tất cả field sửa được là required, kể cả optional database field phải gửi rõ `null` nếu muốn xóa. `PATCH` dùng `ProductPatch` và service gọi `model_dump(exclude_unset=True)`, nên chỉ field client gửi mới thay đổi. Ví dụ PATCH `{ "stock": 8 }` giữ nguyên tên/giá; PATCH `{ "image_url": null }` xóa riêng image URL.

## 5. HTTPException thành JSON response ra sao?

Service raise `HTTPException(404, detail="Product not found.")` hoặc 409 domain error. Starlette `ExceptionMiddleware` bắt HTTPException và FastAPI trả JSON `{"detail": "..."}`; không gửi SQL exception/stack trace. Request schema errors vẫn do FastAPI handler trả 422 JSON `detail` list. Vì endpoint không catch rồi đổi status, response semantics còn rõ ràng.

## 6. Vì sao transaction cần rollback khi lỗi?

Sau `IntegrityError`, SQLAlchemy Session đang ở transaction failure state và không dùng tiếp được cho đến khi rollback. Category/product services gọi `db.rollback()` trước khi raise 409; `get_db()` cũng rollback trong exception path và luôn close session. Commit chỉ xảy ra một lần trong mutation service thành công. Điều này tương đương `try/commit/catch/rollback/finally release` với TypeORM QueryRunner.
