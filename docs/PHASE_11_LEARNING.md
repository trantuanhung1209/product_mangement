# Phase 11 — Shopping Cart

## Backend Cart và React Cart State

Backend là nguồn dữ liệu đúng duy nhất: `GET /api/v1/cart` trả cart của session
hiện tại, còn POST/PATCH/DELETE trả hoặc thay đổi dữ liệu trong PostgreSQL. React
không tự tính lại số lượng từ localStorage; `CartContext` chỉ giữ snapshot để
badge, Product Card và trang `/cart` dùng chung. Điều này giống NestJS service
giữ business state ở server, còn React chỉ render response API.

## Axios Cart API

`frontend/src/api/cart.ts` gọi đúng năm endpoint Cart. Axios client chung tự gửi
cookie HttpOnly và header `X-CSRF-Token` cho mutation. Nếu access token hết hạn,
interceptor hiện có gọi `/api/v1/auth/refresh` một lần rồi retry request cũ;
Cart API không phải tự xử lý JWT hay đọc token từ localStorage.

## React Context

`CartProvider` là context riêng, đặt bên trong `AuthProvider`, thay vì thêm Cart
vào Auth Context. `StorefrontShell` đọc `total_quantity` để vẽ badge, còn
`StoreProductCard`, `StorefrontProductPage` và `CartPage` gọi các mutation.
Tách theo concern giúp Auth không trở thành một object state quá lớn.

## Đồng bộ state

POST/PATCH của backend trả `CartResponse`, vì vậy Context thay snapshot bằng
`response.data` sau mutation. DELETE item gọi lại `GET /cart` vì endpoint 204
không có response body. Khi Auth đổi user hoặc logout, effect reset về cart rỗng
trước khi request mới hoàn thành, tránh hiển thị giỏ User A cho User B.

## Race condition và hủy request

Effect tải cart dùng `AbortController` và `requestVersion`. Khi component đổi
user/unmount, request cũ bị abort; nếu response cũ vẫn về, version không khớp
nên không ghi state. Server vẫn là nơi xử lý concurrent add và stock bằng
transaction/row lock — Context không dùng lock JavaScript để thay thế database.

## Loading, Error và Empty

`CartPage` có loading state, empty state, lỗi có nút thử lại, và cảnh báo khi
stock hiện tại thấp hơn quantity đang có trong cart. Nút mutation bị disable khi
đang gửi để tránh double submit. Error có `role="alert"`; icon-only remove có
`aria-label`, nên UI không chỉ dựa vào màu sắc hoặc icon.

## Cart persistence

Cart thuộc `user_id` trong PostgreSQL, do đó refresh browser hoặc login lại cùng
tài khoản vẫn thấy cart. Badge tải lại sau khi `AuthProvider` khôi phục session.
Không dùng localStorage vì dữ liệu đó dễ stale, có thể lộ giữa tài khoản cùng
browser, và không biết stock/price mới từ server.

## Chuẩn bị cho Phase 12

Cart hiện hiển thị `unit_price`, `line_total`, `subtotal` do server tính bằng
Decimal. Checkout sau này phải tạo Order trong một transaction mới và kiểm tra
lại giá/tồn kho trên server; không dùng subtotal hay price do client gửi lên.
