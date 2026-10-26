# Ảnh chụp màn hình

Chụp ở chế độ Full Docker (`http://localhost:8080`) sau khi chạy `scripts.seed`. Tên file mô tả nội dung;
README gốc nhúng các ảnh này.

| File | Trang | Nội dung |
| --- | --- | --- |
| `swagger-docs.png` | `/docs` | Swagger UI của API |
| `shop-home.png` | `/` | Trang chủ storefront, toast "Đã thêm vào giỏ hàng" |
| `shop-search.png` | `/shop?search=a` | Tìm kiếm có debounce, URL giữ `search` và `page` |
| `shop-filter-price.png` | `/shop?min_price=…&max_price=…` | Lọc theo khoảng giá |
| `shop-search-and-price-filter.png` | `/shop?…&search=a` | Kết hợp tìm kiếm và lọc giá |
| `shop-product-detail-no-image.png` | `/shop/101` | Chi tiết sản phẩm chưa có ảnh (trạng thái "Chưa có hình ảnh") |
| `shop-product-detail.png` | `/shop/101` | Chi tiết sản phẩm có ảnh |
| `shop-cart.png` | `/cart` | Giỏ hàng, tóm tắt đơn hàng |
| `register-otp-step.png` | `/register` bước 2 | Nhập mã OTP, đồng hồ đếm ngược, nút gửi lại bị khóa |
| `admin-products-sort-pagination.png` | `/admin/products?sort_by=name&order=asc&page=4` | Bảng sản phẩm: sắp xếp, phân trang, chọn số dòng, tồn kho |
| `admin-products-delete-confirm.png` | `/admin/products` | Modal xác nhận xóa |
| `admin-product-edit-form.png` | `/admin/products/:id/edit` | Form chỉnh sửa sản phẩm |
| `admin-product-detail-toast.png` | `/admin/products/:id` | Chi tiết trong admin và toast "Đã cập nhật sản phẩm" |
| `admin-categories.png` | `/admin/categories` | Quản lý danh mục |
| `admin-users.png` | `/admin/users` | Danh sách người dùng và vai trò |
| `admin-user-sessions.png` | `/admin/users/:id/sessions` | Phiên đăng nhập của một người dùng, thu hồi |
| `account-sessions.png` | `/account/sessions` | Phiên đăng nhập của tôi |
| `shop-empty-state.png` | `/shop?search=zzzz` | Trạng thái **empty**: "Chưa tìm thấy sản phẩm" |
| `shop-loading-state.png` | `/shop` | Trạng thái **loading**: skeleton "Đang tải sản phẩm" |
| `shop-load-more.png` | `/shop` | Nút "Tải thêm sản phẩm" (cursor pagination) |
| `shop-load-more-expanded.png` | `/shop` | Danh sách sau nhiều lần "Tải thêm" (thu nhỏ trang) |
| `cache-miss-devtools.png` | DevTools, request `/api/v1/products/cursor` | Header `X-Cache: MISS` (lần đầu) |
| `cache-hit-devtools.png` | DevTools, cùng request | Header `X-Cache: HIT` (lần sau) |
| `register-details.png` | `/register` bước 1 | Quy tắc mật khẩu và nút hiện/ẩn mật khẩu |
| `register-otp-filled.png` | `/register` bước 2 | Đã nhập OTP, đồng hồ đếm ngược, nút gửi lại bị khóa |
| `otp-email.png` | Hộp thư | Email OTP gửi từ `noreply@uside.id.vn` qua Resend |
| `change-password.png` | `/account/password` | Form đổi mật khẩu |
| `docker-compose-ps.png` | Terminal | `docker compose up` và `ps`: các service healthy |

## Còn thiếu (nếu muốn đủ bộ)

| Gợi ý tên file | Trang | Vì sao nên có |
| --- | --- | --- |
| `shop-error-state.png` | `/shop` khi backend dừng (`docker compose ... stop backend`) | Đề bài yêu cầu trạng thái **error** (loading và empty đã có) |
| `admin-product-form-errors.png` | `/admin/products/new` | Validate phía client: lỗi hiện gần trường |
| `admin-products-list.png` | `/admin/products` | Danh sách mặc định (hiện chỉ có ảnh sắp xếp/phân trang và modal xóa) |
| `login.png` | `/login` | Link "Quên mật khẩu?" và "Đăng ký" |
| `forgot-password.png` | `/forgot-password` | Luồng quên mật khẩu |
| `shop-mobile.png` | `/shop` ở 375 px | Bố cục mobile |
| `docker-compose-ps.png` (chụp lại) | Terminal | Ảnh hiện tại **thiếu dòng `redis`** (bị cắt ở đáy); chụp lại đủ 5 service |

## Xử lý ảnh

- Ảnh chụp toàn cửa sổ đã được **cắt bỏ thanh menu, tab và bookmark của trình duyệt** (chỉ còn nội dung trang),
  thu nhỏ còn 1800 px rộng và nén PNG: từ khoảng 27 MB xuống khoảng 6 MB cho 28 ảnh.
- `cache-miss-devtools.png` và `cache-hit-devtools.png` chỉ giữ **Response headers**. Ảnh DevTools gốc có cả
  `Cookie: access_token=…; csrf_token=…` ở Request headers: không bao giờ commit ảnh như vậy.
- Email thử vẫn hiện trong `register-otp-step`, `register-otp-filled`, `admin-users` và `change-password`
  (góc dưới trái); đó là email của người chụp, cân nhắc dùng email thử nếu repo công khai.
- `docker-compose-ps.png` thiếu dòng `redis` ở đáy (bị cắt khi chụp).
