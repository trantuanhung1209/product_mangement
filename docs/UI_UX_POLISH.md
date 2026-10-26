# Cải thiện trải nghiệm giao diện (UI/UX)

Tài liệu này ghi lại các thay đổi frontend về cuộn trang, lọc/phân trang, xóa bộ
lọc và các lỗi UX đã rà soát. Không đổi backend hay API.

## 1. Cuộn mượt toàn trang (Lenis)

- **Thư viện:** [`lenis`](https://github.com/darkroomengineering/lenis) 1.3.27,
  ghim version chính xác. Chọn vì nhỏ, không phụ thuộc, hoạt động trên scroll native
  (không thay thanh cuộn), có `data-lenis-prevent` để bỏ qua vùng cuộn riêng và tắt
  được hoàn toàn bằng code.
- `components/layout/SmoothScroll.tsx` khởi tạo Lenis một lần ở `App` với
  `autoRaf: true` (Lenis tự chạy vòng `requestAnimationFrame`, chi phí mỗi khung hình
  không phụ thuộc số phần tử trong trang).
- **`prefers-reduced-motion`:** nếu người dùng bật “giảm chuyển động” thì không khởi
  tạo Lenis; nếu họ đổi tùy chọn này khi trang đang mở, Lenis được bật/tắt theo, không
  tạo trùng instance và được hủy khi unmount.
- **Vùng cuộn riêng:** `ConfirmDialog` có `data-lenis-prevent` và khóa cuộn của `<html>`
  khi mở (trả lại khi đóng), nên cuộn bên trong modal không kéo trang nền. Bảng và các
  vùng `overflow: auto` khác được Lenis để nguyên.
- CSS của thư viện (`lenis/dist/lenis.css`) được nạp trong `main.tsx`.
- Chi phí (đo bằng cách build có và không có Lenis): bundle JS chính tăng 5,4 KB gzip
  (135,46 → 140,83 KB) ; CSS tăng tổng cộng khoảng 0,7 KB (gồm CSS của Lenis và các lớp mới ở
  mục 2).

## 2. Lọc, tìm kiếm, phân trang không giật

**Trước:** đổi bộ lọc hoặc trang thì danh sách biến mất và hiện skeleton.
**Nay:** danh sách cũ ở nguyên trên màn hình trong lúc tải (`keepPreviousData` của
TanStack Query), kèm dấu hiệu rõ ràng rằng nó đã cũ:

- danh sách bị làm mờ (`.is-updating`) và có `aria-busy="true"`;
- dòng trạng thái “Đang cập nhật…” (`role="status"`);
- nút trang trước/sau, ô chọn số dòng và nút “Tải thêm” bị khóa, nên không thể bấm
  tiếp dựa trên dữ liệu cũ. Điều này đặc biệt quan trọng với cursor: cursor cũ được ký
  cho bộ lọc cũ, gửi nó với bộ lọc mới sẽ bị server từ chối. Nút bị khóa ở giao diện;
  ngoài ra mỗi bộ lọc có query và danh sách trang riêng nên không có cursor cũ nào để gửi
  đi;
- khi kết quả mới về, kết quả cũ bị thay hoàn toàn (không trộn); nếu lần tải mới lỗi,
  dữ liệu cũ bị bỏ và hiện trạng thái lỗi kèm nút thử lại.

**Vì sao đổi so với Phase 14.** Phase 14 cố ý không dùng `placeholderData` để tránh
nhầm kết quả cũ là kết quả mới. Rủi ro đó nay được xử lý bằng cách đánh dấu và khóa
như trên thay vì giấu dữ liệu. Skeleton chỉ còn ở lần tải đầu tiên (hoặc khi kết quả
cũ rỗng).

**Debounce.** Đợt này từng giảm `useDebounce` từ 500 ms xuống 300 ms. Vì đề bài thực tập
(`docs/ThucHanh-Tuan2.md`) yêu cầu 500 ms nên giá trị mặc định đã được đưa về **500 ms** (có test
`useDebounce.test.ts`).

## 3. “Xóa bộ lọc” đúng nghĩa

Nguyên nhân gốc là một race, tìm ra bằng test tái hiện: giá trị đã debounce **chậm hơn**
ô nhập, nên sau khi xóa, effect commit lại giá trị cũ. Hai biểu hiện:

1. gõ khoảng giá rồi bấm “Xóa bộ lọc” ngay (trong 0,5 giây): giá **tự quay lại**;
2. bấm Back của trình duyệt: ô search quay về giá trị cũ rồi bị debounce cũ đẩy ngược
   lại URL (kẹt trong lịch sử).

Cách sửa: chỉ commit khi giá trị debounce đã **khớp** với ô nhập
(`ProductFilters` cho giá, hook mới `useSearchInput` cho search), và khi URL đổi thì
cập nhật ô nhập ngay trong lúc render để effect không bao giờ thấy URL mới đi cùng
text cũ. Cờ `searchWasCleared` rời rạc ở hai trang được bỏ.

Hành vi nút:
- reset search, danh mục, giá thấp/cao, sắp xếp (về `created_at` giảm dần) và về trang 1;
- URL và các control luôn khớp nhau;
- chỉ hiện khi có ít nhất một bộ lọc đang bật;
- ở storefront, sau khi xóa, trang quay lại chế độ cursor (danh sách đầu tiên).

Không có slider hay checkbox trong bộ lọc hiện tại; các control có là ô tìm kiếm, hai ô
giá và hai ô chọn (danh mục, sắp xếp). Kích thước trang (số dòng) ở admin là tùy chọn
hiển thị, không phải bộ lọc, nên không bị reset.

## 4. Kết quả rà soát UI/UX

| # | Vị trí | Vấn đề | Mức | Trạng thái |
| --- | --- | --- | --- | --- |
| 1 | `ProductFilters.tsx` | Giá gõ ngay trước “Xóa bộ lọc” tự quay lại | Cao | Đã sửa |
| 2 | `ProductsPage`, `StorefrontShopPage` | Back/Forward bị debounce cũ ghi đè URL | Cao | Đã sửa |
| 3 | Mọi trang | Tiêu đề tab luôn là “Product Catalog” | Trung bình | Đã sửa (`useDocumentTitle`) |
| 4 | `ProductDetailPage`, `StorefrontProductPage` | Lỗi mạng/5xx hiện “Không tìm thấy sản phẩm”, không có thử lại | Trung bình | Đã sửa (phân biệt 404/id sai với lỗi tạm thời) |
| 5 | `StorefrontShell` | Menu tài khoản không đóng khi click ra ngoài, nhấn Esc hay chuyển trang | Trung bình | Đã sửa |
| 6 | `ConfirmDialog` | Không chuyển focus vào hộp thoại, Tab ra được nền, nền cuộn được | Trung bình | Đã sửa |
| 7 | `styles.css`, `storefront.css` | Vòng focus xanh nhạt (tương phản 1,5–2,8:1 trên nền trắng) | Trung bình | Đã sửa (đổi `#2e7d46`, 5:1; chưa xác nhận bằng mắt) |
| 8 | `AdminUsersPage`, `AdminUserSessionsPage`, trang chủ | Không có trạng thái rỗng | Thấp | Đã sửa |
| 9 | `Toast` | Thông báo lỗi dùng `role="status"` (không báo gấp) | Thấp | Đã sửa (`role="alert"`) |
| 10 | `AppShell` | Layout admin thiếu skip link và `id` cho `<main>` | Thấp | Đã sửa |
| 11 | `ProductFormPage` | Lỗi tải gộp “đã bị xóa hoặc kết nối lỗi”, không có thử lại | Thấp | Đã sửa (404 hiện “Không tìm thấy”; lỗi khác có nút “Thử lại” tải lại cả sản phẩm và danh mục) |
| 12 | `ProductFilters`, `AdminUsersPage` | Ô tìm kiếm chỉ có placeholder, chưa có `aria-label` | Thấp | Đã sửa |
| 13 | Danh sách phân trang | Đổi trang không cuộn về đầu danh sách | Thấp | Đã sửa (`useScrollToListOnPageChange`, tôn trọng reduced-motion; không cuộn ở lần tải đầu hay khi “Tải thêm”) |
| 14 | `StoreProductCard`, `CartPage` | Hiển thị `error.message` của `Error`; hiện chỉ là thông điệp thân thiện do `CartContext` tạo | Thấp | Không sửa (đã kiểm tra, không lộ chi tiết kỹ thuật) |
| 15 | Toàn bộ | Bố cục ở 375 px | — | NOT RUN: chưa mở trình duyệt; CSS có media query 1050/760/620/520/480 px |

Đã kiểm tra và không thấy vấn đề: trạng thái loading/lỗi/thử lại ở danh sách, giỏ hàng
và trang chủ; nút đang gửi bị khóa (đăng nhập, form sản phẩm/danh mục, thêm giỏ, xác
nhận xóa); form giữ dữ liệu và hiện lỗi gần trường khi API lỗi; không có stack trace
hay mã lỗi thô trong giao diện.

## 5. Kiểm tra

- Test mới/cập nhật nằm cạnh code: `FilterReset.test.tsx`, `SmoothScroll.test.tsx`,
  `ConfirmDialog.test.tsx`, `StorefrontShell.test.tsx`, `Toast.test.tsx`,
  `StorefrontProductPage.test.tsx`, `StorefrontHomePage.test.tsx`, `ScrollOnPageChange.test.tsx`, `App.test.tsx`
  (tiêu đề từng trang, skip link, trang 404) và các test hook/trang đã đổi sang hành vi
  “giữ dữ liệu cũ”.
- Một số test cũ cố ý đổi: các test “không bao giờ hiện dòng của bộ lọc cũ” nay kiểm tra
  rằng dòng cũ **được giữ nhưng đánh dấu cũ và khóa thao tác**, rồi bị thay hoàn toàn.

## 6. Giới hạn

- Chưa chạy trên trình duyệt thật: cảm giác cuộn của Lenis, độ mờ của danh sách đang
  cập nhật, màu vòng focus và bố cục 375 px chưa được xem bằng mắt.
- Không có ESLint nên không có bước lint.
- Số phần tử được render: admin tối đa 100 dòng/trang; storefront cursor nạp 8 sản phẩm
  mỗi lần “Tải thêm” và các lần nạp cộng dồn trong phiên (không ảo hóa danh sách). Hiệu
  năng cuộn của Lenis không phụ thuộc số phần tử, nhưng danh sách rất dài vẫn tăng DOM.
