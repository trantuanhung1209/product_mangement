# Phase 05 — Modern Product Catalog Frontend

## 1. React component render khi nào?

Component render lần đầu khi React gắn nó vào trang, rồi render lại khi state,
props hoặc URL state mà nó dùng thay đổi. Ví dụ `ProductsPage` render lại khi
`useSearchParams()` đổi sau thao tác filter, hoặc khi `useProducts()` nhận dữ
liệu API. Render chỉ tạo mô tả UI mới; React sau đó so sánh và cập nhật phần
DOM cần thiết. Vì vậy các request không đặt trực tiếp trong phần thân component.

## 2. useEffect dùng để làm gì?

`useEffect` dùng để kết nối React với thứ nằm bên ngoài render, như HTTP API,
timer hoặc URL. `useProducts` dùng effect để gọi `getProducts()` khi query đổi;
`useDebounce` dùng effect để tạo và dọn `setTimeout`. Effect categories trong
`ProductsPage` trả về `controller.abort()`, nên request được dọn lúc unmount.
Đặt request trong render sẽ gây request lặp vô hạn khi state thay đổi.

## 3. Custom Hook khác Component như thế nào?

Component trả JSX để vẽ giao diện, như `ProductTable`. Custom Hook trả logic và
state tái sử dụng, như `useProducts` trả `data`, `loading`, `error`, `retry`.
Hook không tự hiển thị gì; nó giúp `ProductsPage` chỉ tập trung ghép UI với
trạng thái. Đây là cách tách data-fetching khỏi bảng mà không cần thêm state
management library trong phase này.

## 4. Debounce 500ms hoạt động ra sao?

`useDebounce(searchInput)` chỉ cập nhật giá trị sau khi người dùng ngừng gõ
500ms. `ProductsPage` chỉ cập nhật URL `search` khi giá trị debounce đổi, nên
không có request trên từng phím bấm. Timer cũ được `clearTimeout` khi gõ tiếp.
Ví dụ gõ “bàn phím” liên tục chỉ dẫn đến một request cuối cùng thay vì tám
request trung gian.

## 5. Vì sao cần hủy request cũ?

Người dùng có thể đổi filter trước khi response trước đó về. `useProducts`
tạo `AbortController` cho mỗi query và abort controller cũ trong cleanup.
Nhờ đó response cũ không thể ghi đè danh sách mới, kể cả React StrictMode chạy
effect thêm một lần khi phát triển. Axios nhận `signal` trực tiếp qua
`getProducts(query, controller.signal)`.

## 6. URL query state và React state khác nhau thế nào?

URL là nguồn dữ liệu có thể refresh, chia sẻ và dùng Back/Forward; các field
`page`, `page_size`, `search`, filters và sort được đọc từ `useSearchParams`.
`searchInput` là React state tạm thời để người dùng gõ mượt trước khi debounce.
Hàm `parseQuery()` kiểm tra giá trị URL không hợp lệ và dùng default an toàn,
còn `updateParams()` reset về trang 1 khi filter thực sự đổi.

## 7. Mở Browser Network tab để debug API chậm

Mở DevTools → **Network**, bật Preserve log, rồi thay search/filter trong
trang. Chọn request `/api/v1/products` để xem Query String, status, thời gian
và response `items/total`. Nếu request bị hủy sẽ hiện cancelled, đây là hành
vi đúng khi query mới xuất hiện. Kiểm tra `X-Cache` trong Response Headers để
biết backend trả từ Redis (`HIT`) hay PostgreSQL (`MISS`).
