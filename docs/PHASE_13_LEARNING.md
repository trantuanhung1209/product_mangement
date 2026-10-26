# Phase 13 — Cursor Pagination

## 1. Mục tiêu của endpoint mới

`GET /api/v1/products` vẫn dùng `page` và `page_size`; đó là contract của Admin
Dashboard và Shop hiện tại. Phase này chỉ thêm `GET /api/v1/products/cursor` để
consumer có thể đi tiếp trong một danh sách lớn mà không cần `OFFSET`. Vì hai
endpoint tách biệt, frontend cũ không phải đổi và API offset không đổi response.

Ví dụ gọi trang đầu:

```http
GET /api/v1/products/cursor?limit=20&search=python&min_price=100000
```

Response không trả `total`, vì `COUNT(*)` thường là phần tốn kém không cần thiết
cho UI kiểu “tải thêm”. Nó trả `items`, `has_more` và `next_cursor`.

## 2. Offset khác keyset ở đâu?

Offset page 100 thường có dạng sau:

```sql
SELECT ... FROM products
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 1980;
```

PostgreSQL vẫn phải đi qua các row bị bỏ qua. Cursor giữ vị trí cuối của page
trước rồi hỏi các row đứng sau vị trí đó:

```sql
SELECT ... FROM products
WHERE (created_at, id) < (:created_at, :id)
ORDER BY created_at DESC, id DESC
LIMIT 21;
```

Đó là *keyset pagination*. Service `list_products_by_cursor()` dùng
`tuple_(Product.created_at, Product.id) < tuple_(...)`, không gọi `.offset()`.

## 3. Vì sao phải sort ổn định?

`created_at` không đủ duy nhất: nhiều sản phẩm có thể được tạo trong cùng một
timestamp. Nếu cursor chỉ lưu `created_at`, các row cùng timestamp có thể bị
bỏ qua hoặc lặp. Project cố định thứ tự `created_at DESC, id DESC`; `id` là
tie-breaker duy nhất và cũng nằm trong cursor.

Test `test_cursor_pages_are_stable_for_equal_timestamps` tạo năm Product có
cùng `created_at`, lấy từng page `limit=2`, rồi kiểm tra tất cả ID xuất hiện
đúng một lần theo thứ tự mong đợi.

## 4. `limit + 1` và `has_more`

Với `limit=20`, query thật lấy nhiều nhất 21 row. Có row thứ 21 nghĩa là còn
page sau, nên `has_more=true`; response chỉ gửi 20 row đầu. Cursor tiếp theo
được tạo từ row cuối cùng đã gửi, không phải row thứ 21. Nếu chỉ có tối đa 20
row, `has_more=false` và `next_cursor=null`.

Giới hạn trong `ProductCursorQuery` là 1–100, mặc định 20. Pydantic/FastAPI trả
`422` cho `limit=0` hoặc `limit=101` trước khi service được gọi.

## 5. Cursor chứa gì và vì sao cần ký?

`encode_product_cursor()` tạo JSON nhỏ gồm version (`v`), `created_at`, `id` và
fingerprint của filter, sau đó Base64 URL-safe payload và HMAC-SHA256 bằng
`PRODUCT_CURSOR_HMAC_KEY` (secret riêng, không dùng chung với JWT). Nó không chứa thông tin nhạy cảm, nhưng chữ ký ngăn
client tự đổi ID/timestamp để nhảy qua danh sách hay giả cursor.

Cursor là opaque: client chỉ giữ và gửi lại chuỗi `next_cursor`, không parse hay
tự tạo nó. `decode_product_cursor()` kiểm tra định dạng, HMAC, version, kiểu ID,
timestamp có timezone và fingerprint. Mọi lỗi cursor hợp lệ về mặt HTTP đều trả
`400 Invalid cursor` (hoặc `400 Unsupported cursor version`), không lộ chi tiết
crypto.

## 6. Filter fingerprint bảo vệ ngữ cảnh

Cursor của `search=python&category_id=2` không hợp lệ khi dùng cho
`search=fastapi` hoặc category khác. `_filter_fingerprint()` canonicalize bốn
filter đang hỗ trợ: `search`, `category_id`, `min_price`, `max_price`, rồi hash
JSON có key order ổn định. Decimal `20` và `20.00` được chuẩn hóa cùng giá trị,
nên hai query tương đương vẫn dùng được cùng cursor.

Filter SQL dùng chung hàm `product_filters()` với endpoint offset. Vì vậy search
`ILIKE`, category và khoảng giá có cùng ý nghĩa ở hai API; không copy-paste các
điều kiện `WHERE` dễ bị lệch theo thời gian.

## 7. Concurrent insert/delete giữa các page

Cursor pagination không phải snapshot transaction. Một product mới hơn row
cursor sau khi page đầu được tải sẽ không chen vào các page tiếp theo; một row
bị xóa giữa hai lần gọi đơn giản không còn xuất hiện. Đổi lại, traversal trên
snapshot tĩnh không lặp/bỏ row vì sort key.

`test_cursor_handles_product_changes_without_duplicate` kiểm tra hai hành vi
này: xóa row kế tiếp và chèn row mới không làm lặp row của page đầu hay đưa row
mới vào page tiếp theo. Nếu cần snapshot thật, phải thiết kế snapshot/version
riêng — không nằm trong scope catalog hiện tại.

## 8. Index PostgreSQL và EXPLAIN ANALYZE

Migration `20261025_06_add_product_cursor_index.py` thêm index
`ix_products_created_at_id (created_at, id)`. Nó có bằng chứng trực tiếp: keyset
query order theo chính hai cột và predicate tuple cùng thứ tự. PostgreSQL có thể
scan ngược index ASC để phục vụ `DESC`.

Trên `product_catalog_test`, sau migration, query cursor thực tế cho kết quả:

```text
Index Only Scan Backward using ix_products_created_at_id on products
Index Cond: (ROW(created_at, id) < ROW(...))
Execution Time: 0.070 ms
```

`EXPLAIN ANALYZE` phải được đọc theo dữ liệu đại diện: dataset rất nhỏ có thể
chọn sequential scan vẫn hoàn toàn hợp lý. Không thêm index riêng cho mọi tổ
hợp search/category/price khi chưa có truy vấn chậm và bằng chứng đo được.

## 9. Cursor pagination không đồng nghĩa infinite scroll

Cursor pagination là API contract: client xin một đoạn dữ liệu rồi dùng cursor
để xin đoạn kế tiếp. Infinite scroll là cách UI tự gọi API khi người dùng gần
cuối danh sách. Một UI có thể dùng cursor với nút “Tải thêm”, hoặc dùng offset
với phân trang số trang; hai khái niệm không bắt buộc đi cùng nhau.

Ở Phase 13 frontend chưa đổi gì: Shop vẫn dùng response offset (`total`, `page`,
`total_pages`) và endpoint cursor chỉ là khả năng API riêng. Phần tích hợp vào giao
diện được làm sau đó, xem mục 12.

## 10. Khi nào chọn offset, khi nào chọn cursor?

Chọn offset khi UI cần biết tổng số record, nhảy thẳng đến page 20 hoặc dữ liệu
nhỏ: Admin Dashboard đang cần các đặc tính đó. Chọn cursor khi chủ yếu đi tới
trước, dữ liệu lớn hoặc trang sâu: không cần `COUNT(*)` cho mỗi page và index
có thể bắt đầu từ key của cursor.

Cursor hiện chỉ hỗ trợ một sort cố định để bảo đảm keyset semantics. Nếu cần
sort theo price/name sau này, mỗi thứ tự cần cursor payload, tie-breaker và index
được thiết kế/test riêng; không nên tái dùng cursor `created_at` một cách âm
thầm.

## 11. Những lỗi thường gặp và cách kiểm tra

- Dùng `OFFSET` trong endpoint cursor: tìm `.offset(` trong service; endpoint
  mới không có nó.
- Sort chỉ theo `created_at`: tạo records cùng timestamp rồi duyệt hết pages;
  test Phase 13 đã bao phủ trường hợp này.
- Tạo cursor từ item thứ `limit + 1`: sẽ làm mất item đó ở page sau. Cursor phải
  lấy từ item cuối đã trả về.
- Cho cursor khác filter tiếp tục chạy: thử dùng `next_cursor` với search khác;
  API phải trả 400.
- Bỏ index theo suy đoán: chạy `EXPLAIN (ANALYZE, BUFFERS)` trước và sau khi có
  dữ liệu đủ gần production.

Chạy targeted tests bằng PostgreSQL/Redis test riêng:

```bash
cd backend
source .venv/bin/activate
export TEST_DATABASE_URL='postgresql+psycopg://.../product_catalog_test'
export TEST_REDIS_URL='redis://localhost:6379/15'
pytest tests/test_product_cursor.py -q
```

Sau đó chạy `pytest` đầy đủ để xác nhận việc trích `product_filters()` không làm
thay đổi pagination offset cũ.

## 12. Dùng cursor trong giao diện (bổ sung sau Phase 15)

Mục tiêu là **thêm** cursor mà không làm mất tính năng đã có. Vì cursor chỉ có
một thứ tự (mới nhất trước), không có tổng số và chỉ đi tiếp, giao diện dùng
chế độ lai ở trang storefront `/shop`:

| Điều kiện | API | Giao diện |
| --- | --- | --- |
| Sắp xếp mặc định (`created_at` giảm dần) | `GET /products/cursor` | nút “Tải thêm sản phẩm”, đếm số đã hiển thị |
| Chọn sắp xếp khác (tên, giá, tồn kho, cũ nhất) | `GET /products` (offset) | số trang, tổng số, “Trang trước/sau” như cũ |

Admin (`/admin/products`) và trang chủ **không đổi**: admin cần tổng số, nhảy
trang, chọn số dòng và các kiểu sắp xếp mà cursor không có.

Cách hoạt động:

- `useProductsCursor` (`frontend/src/hooks/`) dùng `useInfiniteQuery`. Cursor là
  `pageParam` chứ không nằm trong query key; key chỉ chứa bộ lọc
  (`productKeys.cursorList`), đặt dưới `productKeys.lists()` nên mọi mutation làm
  cũ danh sách cũng làm cũ danh sách cursor.
- Đổi bất kỳ bộ lọc nào (từ khóa, danh mục, khoảng giá) đổi key, nên danh sách bắt
  đầu lại từ trang đầu. Điều này cũng cần thiết vì server gắn chữ ký cursor với
  bộ lọc (mục 6): dùng cursor với bộ lọc khác bị trả 400. Trong lúc trang đầu mới
  đang tải, các sản phẩm của bộ lọc cũ vẫn hiện nhưng bị làm mờ và đánh dấu “Đang cập
  nhật…”; hook trả `updating = true`, nút “Tải thêm” bị khóa, và cursor cũ không thể
  được gửi kèm bộ lọc mới vì mỗi bộ lọc có query (và danh sách trang) riêng (xem
  `UI_UX_POLISH.md`).
- Khi có thay đổi dữ liệu (tạo, sửa, xóa sản phẩm), TanStack Query tải lại từng
  trang đã nạp bằng đúng cursor của trang đó. Nhờ keyset (mục 7), sản phẩm bị xóa
  không làm lệch hay lặp các trang còn lại.
- Lỗi khi tải trang đầu thay cả danh sách bằng thông báo lỗi và nút thử lại. Lỗi
  khi “Tải thêm” giữ nguyên các sản phẩm đã hiển thị, báo lỗi ngay dưới danh sách
  và nút “Thử lại” xin lại **cùng cursor**.
- Nút bị khóa khi đang tải để không gửi trùng yêu cầu.
- Endpoint cursor dùng lại cache Redis của Phase 4 (xem mục 13): “Tải thêm” lần thứ
  hai cho cùng bộ lọc và cùng cursor là cache HIT. Giới hạn rate limit tìm kiếm công
  khai vẫn áp dụng khi có `search`, kể cả khi trả từ cache.

Kiểm tra: `frontend/src/hooks/useProductsCursor.test.tsx`,
`frontend/src/pages/StorefrontShopPage.test.tsx` và test key trong
`frontend/src/api/queryKeys.test.ts`. Backend giữ nguyên các test cursor của
Phase 13 và `test_cursor_tamper.py` (Phase 15).

## 13. Redis cache cho endpoint cursor

Ban đầu endpoint cursor (Phase 13) không đi qua cache nên bỏ sót cơ chế của
Phase 4. Nay nó dùng cùng mô hình cache-aside, TTL 60 giây và header `X-Cache:
HIT/MISS`:

- **Key** gồm version danh sách, tiền tố `cursor:` và toàn bộ tham số đã chuẩn hóa
  (`limit`, `search`, `category_id`, giá, và **chuỗi cursor**). Mỗi trang là một
  entry riêng; tiền tố giữ key cursor tách khỏi key của endpoint offset (hai
  response có hình dạng khác nhau: cursor không có `total`).
- **Invalidation** dùng chung `LIST_VERSION_KEY` với danh sách offset. Mọi thao tác
  đã tăng version (tạo, sửa, xóa sản phẩm, upload/xóa ảnh) tự làm cũ cả các trang
  cursor, nên không phải thêm đường invalidation nào. Mutation lỗi không đổi cache.
- **Bảo mật cursor không bị cache vượt qua.** Chỉ response thành công mới được lưu,
  nên chỉ cursor hợp lệ mới có entry. Cursor giả hoặc cursor cấp cho bộ lọc khác
  tạo ra key khác chưa từng được lưu, nên vẫn đi vào service và bị từ chối 400. Giới
  hạn: nếu xoay `PRODUCT_CURSOR_HMAC_KEY` khi Redis vẫn giữ entry, cursor cũ có thể
  còn được trả từ cache tối đa 60 giây.
- **Redis lỗi:** rơi về PostgreSQL, `X-Cache: MISS`, giống endpoint offset.

Kiểm tra: `backend/tests/test_cursor_cache.py` (HIT/MISS theo filter và cursor,
không đụng key offset, invalidation sau tạo/PATCH/PUT/xóa, mutation lỗi giữ cache,
cursor sai không được cache, fallback khi Redis lỗi, rate limit vẫn áp dụng).
