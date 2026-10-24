# Phase 10 — Public Storefront

## Public route và khu vực quản lý

`StorefrontShell` bọc ba route công khai: `/`, `/shop` và `/shop/:productId`.
Khu vực riêng của admin dùng `AppShell` tại `/admin/products/*`,
`/admin/categories/*` và `/admin/users/*`; `AdminRoute` chặn USER/GUEST trước
khi render sidebar. Tách shell giúp header/footer của storefront không lẫn với
dashboard, trong khi dữ liệu Product vẫn public và mutation vẫn do RBAC backend
bảo vệ.

## Category CRUD từ frontend

`api/categories.ts` gọi API thật: GET danh sách là public, còn POST/PUT/DELETE
được Axios tự đính kèm cookie và header CSRF. `CategoriesPage` giữ danh sách
trong state, lọc tên ở client vì backend chưa có endpoint search/pagination cho
Category. `CategoryForm` dùng chung cho tạo và sửa: state của input được kiểm
soát, trim tên trước khi gửi, khóa nút khi đang submit và hiển thị lỗi `409` như
“Tên danh mục đã tồn tại”. Xóa luôn qua `ConfirmDialog`; backend trả `409` khi
danh mục còn Product, nên UI chỉ báo lỗi — không cascade xóa dữ liệu.

## Dùng API thật cho catalog

`StorefrontHomePage` và `StorefrontShopPage` tái sử dụng `useProducts()` thay vì
tạo mock data. Shop đọc `search`, `category_id` và `page` từ URL rồi gửi chúng
tới `GET /api/v1/products`; nhờ vậy URL có thể bookmark hoặc chia sẻ. Khi API
lỗi, UI hiển thị trạng thái thử lại, không giữ danh sách cũ như thể nó còn mới.

## Ảnh WebP private nhưng vẫn xem được công khai

Product trả `image_url` như `/api/v1/products/114/image`. `apiAssetUrl()` đổi
nó thành URL backend đúng theo `VITE_API_URL`; browser chỉ gọi FastAPI proxy,
không biết MinIO credential. `StoreProductCard` dùng `loading="lazy"`,
`aspect-ratio` và fallback khi chưa có ảnh, nên grid không bị nhảy layout khi
ảnh tải chậm hoặc Product chưa upload ảnh.

## Responsive và khả năng truy cập

`storefront.css` dùng CSS grid: desktop là hero và card nhiều cột, dưới 760px
đổi sang một cột cho phần nội dung chính và hai cột cho grid nhỏ, dưới 480px là
một cột. Header có skip link, các control có `:focus-visible`, ảnh có alt text,
và `prefers-reduced-motion` tắt animation không cần thiết. Kiểm tra nhanh bằng
DevTools ở 375px và 768px, sau đó dùng keyboard Tab để đi qua menu, ô tìm kiếm
và phân trang.

## Thiết kế tham khảo, không sao chép

Trang lấy cảm hứng ở mức cấu trúc từ storefront xanh thiên nhiên của Green Bio:
hero rõ ràng, điều hướng danh mục và khối sản phẩm nổi bật. Code dùng layout,
nội dung, logo icon và CSS riêng của Product Catalog, với màu thương hiệu
`#166534` và `#F8F9F7`; không sao chép tài sản hoặc nội dung của trang tham khảo.
