# Phase 14 — TanStack Query

## 1. Server state là gì?

Frontend có hai loại state khác nhau:

- **UI state** thuộc về trình duyệt: modal đang mở, chữ đang gõ trong ô tìm kiếm,
  số lượng đang chọn. Dùng `useState`.
- **Server state** thuộc về backend: danh sách sản phẩm, chi tiết sản phẩm, danh
  mục. Frontend chỉ giữ một **bản sao tạm** và bản sao này có thể cũ bất cứ lúc
  nào (người khác sửa dữ liệu, mình vừa sửa ở trang khác).

Trước Phase 14, mỗi trang tự dựng bản sao đó bằng `useEffect` + `useState` +
`AbortController`. Cùng một logic loading/error/hủy request bị lặp lại ở nhiều
file, cùng một danh mục bị tải lại ở mọi trang, và sau khi xóa phải gọi `retry()`
thủ công.

## 2. TanStack Query giải quyết gì?

- **Cache**: dữ liệu đã tải được giữ theo key, trang khác dùng lại ngay.
- **Trạng thái nhất quán**: `isPending`, `isError`, `isFetching`.
- **Hủy request**: Query truyền `signal` vào `queryFn`; code Axios cũ vốn đã nhận
  `signal` nên không phải viết lại.
- **Đồng bộ sau thay đổi**: mutation báo cho cache biết dữ liệu nào đã cũ.
- **Retry có giới hạn** và dedupe request trùng.

Nó **không** thay local UI state, và không thay API client hay cơ chế auth.

## 3. Query key và query cache

Cache là một map từ **query key** sang dữ liệu. Key quyết định hai thứ: hai lần gọi
có dùng chung dữ liệu không, và invalidate nhắm vào đâu. Mọi key nằm trong
[`frontend/src/api/queryKeys.ts`](../frontend/src/api/queryKeys.ts):

```ts
productKeys.all            // ["products"]
productKeys.lists()        // ["products", "list"]
productKeys.list(query)    // ["products", "list", { page, search, category_id, ... }]
productKeys.details()      // ["products", "detail"]
productKeys.detail(id)     // ["products", "detail", 7]
categoryKeys.lists()       // ["categories", "list"]
```

Quy tắc:

1. Key chứa **mọi tham số làm đổi response** (page, page_size, search, category,
   giá, sort, order). Vì vậy `page=2` và `search=phone` không bao giờ dùng chung
   cache với trang đầu.
2. `listFilters()` chọn field tường minh, nên một property thừa không tạo cache
   entry mới. TanStack băm key theo nội dung, không theo thứ tự property, và bỏ
   qua giá trị `undefined`.
3. Key có cấu trúc cây: invalidate `productKeys.lists()` làm cũ mọi danh sách mà
   không đụng tới chi tiết hay danh mục.
4. Không đưa access token, refresh token hay secret vào key.

## 4. Query và mutation

| | Query | Mutation |
| --- | --- | --- |
| Mục đích | Đọc dữ liệu | Thay đổi dữ liệu (POST/PUT/DELETE) |
| Chạy | Tự động, theo key | Chỉ khi gọi `mutate`/`mutateAsync` |
| Cache | Có | Không; chỉ cập nhật cache qua callback |
| Retry | Chỉ lỗi tạm thời, tối đa 2 lần | **Không bao giờ** |

Mutation không retry vì gửi lại `POST /products` có thể tạo bản ghi thứ hai.

Cấu hình chung ở [`api/queryClient.ts`](../frontend/src/api/queryClient.ts):
`staleTime` 30 giây, `gcTime` 5 phút, và `shouldRetryQuery` — không retry lỗi
4xx (kể cả 401 đã được interceptor refresh thất bại) hoặc request bị hủy; lỗi
mạng, timeout và 5xx được thử tối đa 2 lần. Categories dùng `staleTime` 5 phút vì
hiếm khi đổi. Chỉ có **một** `QueryClient`, tạo ở `main.tsx`.

## 5. Invalidation và dữ liệu cũ (stale)

Dữ liệu `stale` vẫn hiển thị được, nhưng sẽ được tải lại khi có dịp (mount, focus).
`invalidateQueries` đánh dấu stale và tải lại ngay các query đang hiển thị.

| Thao tác | Hook | Cache bị tác động |
| --- | --- | --- |
| Tạo / sửa sản phẩm | `useSaveProduct` | `setQueryData` cho detail; invalidate `productKeys.lists()` (cả khi upload ảnh lỗi, vì sản phẩm có thể đã được tạo) |
| Sửa lỗi / upload lỗi | `useSaveProduct` | invalidate detail của sản phẩm đó |
| Xóa sản phẩm | `useDeleteProduct` | xóa detail; invalidate `productKeys.lists()` |
| Tạo / sửa / xóa danh mục | `useSaveCategory`, `useDeleteCategory` | invalidate `categoryKeys.all` |

Admin và storefront dùng chung `productKeys`, nên sửa ở admin cập nhật cả shop.
Không dùng optimistic update: chưa cần, và rollback đúng cho upload ảnh phức tạp.

**Lưu ý khi xóa ở trang chi tiết:** trang đó vẫn đang mount với một observer. Nếu
chỉ `removeQueries`, lần render kế tiếp sẽ tạo lại query và gọi API cho sản phẩm
vừa xóa (ra 404). Vì vậy `ProductDetailPage` truyền `enabled: false` cho
`useProduct` khi mutation đang chạy hoặc đã thành công. Test
`ProductDetailAndFormPages.test.tsx` giữ hành vi này.

**Form sửa:** `ProductForm` chép product vào state cục bộ một lần, nên màn hình sửa
dùng `useProduct(id, { freshForEdit: true })` và chỉ hiện form sau khi đã tải
lại từ server (`isFetchedAfterMount`), tránh sửa trên bản cache cũ.

## 6. Search, filter và phân trang

Phase 14 giữ **offset pagination** (`page`, `total_pages`) cho mọi màn hình. Sau đó
trang `/shop` được bổ sung chế độ cursor “Tải thêm” cho thứ tự mặc định (mới nhất)
bằng `useInfiniteQuery`, còn các thứ tự khác và trang admin vẫn dùng offset; xem
`PHASE_13_LEARNING.md` mục 12. URL query string vẫn là nguồn
sự thật, `useDebounce` giữ nguyên. Mỗi tổ hợp bộ lọc có key riêng.

Không dùng `placeholderData`: khi đổi bộ lọc hoặc trang, key mới chưa có dữ liệu
nên `loading = true` và UI hiện skeleton thay vì kết quả cũ trông như kết quả mới.
Quay lại trang đã xem thì hiện ngay từ cache rồi tải nền nếu đã stale.

## 7. Tích hợp API client và authentication

- Dùng nguyên `api` (Axios) trong `api/client.ts`; không tạo instance thứ hai.
- Interceptor refresh-token xử lý 401 như cũ: một request refresh dùng chung cho
  mọi request đồng thời, rồi phát lại request gốc. Query chỉ thấy kết quả cuối.
  Nếu refresh thất bại, query chuyển sang lỗi và **không** bị retry thêm.
- CSRF header vẫn do request interceptor thêm cho POST/PUT/PATCH/DELETE.
- `AuthProvider` gọi `queryClient.resetQueries()` mỗi khi **danh tính đăng nhập
  thay đổi** (login, logout, phiên hết hạn). Việc này nằm trong một `useEffect`
  chạy *sau* khi các component con đã đổi key, nên chỉ các query của danh tính
  mới được tải lại; reset ngay trong handler sẽ tải lại query của user cũ và có
  thể lưu dữ liệu của tài khoản mới dưới key của tài khoản cũ.
- **Logout luôn xóa phía client.** `logout()` vẫn gọi API revoke, nhưng dù API
  thành công hay lỗi thì user và cache đều bị xóa. Lỗi API logout bị nuốt, vì
  người dùng không còn gì để thử lại ở phía client. Hệ quả: nếu revoke phía
  server lỗi, phiên server còn sống đến khi hết hạn và cookie HttpOnly vẫn còn
  trong browser, nên tải lại trang có thể đăng nhập lại.
- **Refresh bị từ chối thì đăng xuất.** Interceptor trong `api/client.ts` giữ
  nguyên cơ chế refresh một lần dùng chung; khi refresh trả **401/403** nó gọi
  handler do `AuthProvider` đăng ký (`setSessionExpiredHandler`). Handler xóa
  user, và effect ở trên xóa toàn bộ cache. Route guard (`AdminRoute`,
  `AuthenticatedRoute`) tự chuyển trang bảo vệ về `/login`; trang công khai chỉ
  chuyển sang trạng thái ẩn danh. Lỗi mạng và 5xx **không** đăng xuất vì có thể
  chỉ là tạm thời. Một `ref` chặn handler chạy lại khi các query vừa được tải lại
  lại nhận 401.
- Interceptor nay chỉ trả lỗi 401 gốc khi *refresh* thất bại; nếu refresh thành
  công mà request phát lại lỗi, lỗi của request phát lại được trả về (trước đây
  bị thay bằng 401 gốc).

## 7b. Dữ liệu riêng của user

Giỏ hàng, danh sách phiên và dữ liệu admin cũng đi qua Query:

| Dữ liệu | Key | Mutation |
| --- | --- | --- |
| Giỏ hàng | `cartKeys.user(userId)` | thêm / sửa / xóa món / xóa giỏ, luôn refetch sau đó (kể cả khi lỗi, vì 409 nghĩa là tồn kho đã đổi) |
| Phiên của tôi | `sessionKeys.mine(userId)` | thu hồi một phiên / các thiết bị khác |
| Danh sách user (admin) | `adminKeys.userList(params)` | không có (API chỉ đọc) |
| Phiên của một user (admin) | `adminKeys.userSessions(id)` | thu hồi một phiên / tất cả |

`CartContext` giữ nguyên interface (`cart`, `loading`, `error`, `addItem`, ...);
chỉ phần gọi API và cache chuyển sang Query. Khóa của dữ liệu riêng chứa `userId`
nên tài khoản này không thể đọc entry của tài khoản khác ngay cả trước khi cache
được xóa. Danh sách phiên và admin dùng `staleTime: 0` vì là thông tin bảo mật.
Backend không có API khóa/mở khóa hay đổi vai trò, nên phần đó không có hook.

## 8. Cách chạy và kiểm tra

```bash
cd frontend
npm install
npm test            # Vitest, không cần backend/Redis/PostgreSQL
npm run typecheck
npm run build
```

Tests nằm cạnh code (`*.test.ts(x)`). Mỗi test tạo `QueryClient` riêng qua
`createTestQueryClient()` (cấu hình thật, bỏ retry delay) nên không phụ thuộc nhau.
Phạm vi: query keys, retry policy, `useProducts`/`useProduct`, mutation
invalidation (thành công và thất bại), cache sau login/logout/đổi tài khoản/phiên
hết hạn, luồng refresh với Axios thật + adapter giả, tạo sản phẩm không trùng,
giỏ hàng, và UI các trang Products/Detail/Form/Sessions/Admin.

## 9. Giới hạn và việc chưa làm

- Chưa chuyển sang Query: form đăng nhập (chỉ phần sau login nhờ reset cache) và
  `/auth/me` ban đầu trong `AuthProvider`.
- Cursor pagination chỉ dùng ở `/shop` với thứ tự mặc định; admin và trang chủ vẫn dùng offset.
- Form tạo sản phẩm giữ id sau lần tạo đầu tiên (trong vòng đời của trang form);
  nếu người dùng rời trang rồi quay lại khi upload ảnh đã lỗi, sản phẩm đã tạo
  vẫn nằm trong danh sách và cần sửa ở đó.
- Nếu API logout lỗi, phiên phía server không bị revoke (xem mục 7).
- Phiên hết hạn vì lỗi mạng/5xx khi refresh không bị đăng xuất tự động.
- Không có ESLint trong project nên chưa có bước lint.
- Test mock tầng API hoặc dùng adapter giả; chưa có test end-to-end với backend
  và trình duyệt thật.
- Các package mới thêm được ghim bằng `^`; các package trước đây là `"latest"`
  đã ghim đúng phiên bản trong lockfile.
