# Phase 03 — Pagination, Search, Filter & Sort

## 1. FastAPI parse và validate query params

`list_products()` nhận `query: Annotated[ProductQuery, Query()]` trong
`backend/app/api/v1/endpoints/products.py`. FastAPI lấy các giá trị trên URL,
chuyển chúng thành kiểu đã khai báo (ví dụ `min_price` thành `Decimal`) rồi
để Pydantic kiểm tra `ge=0`, `page_size <= 100` và các giá trị `Literal`.
`ProductQuery` còn kiểm tra `min_price <= max_price` sau khi từng field hợp lệ.
Nếu không hợp lệ, FastAPI tự trả 422 trước khi gọi service. Đây tương tự DTO
với `ValidationPipe` của NestJS, nhưng kiểu và validation nằm trong Pydantic.
Thử nhanh: `GET /api/v1/products?page=0` hoặc
`?min_price=20&max_price=10` phải trả 422.

## 2. WHERE → COUNT → ORDER BY → LIMIT/OFFSET

`services/product.py` xây một danh sách `filters`, dùng nó cho cả truy vấn
`COUNT(*)` và truy vấn lấy trang dữ liệu. Vì vậy `total` là số bản ghi *sau*
filter nhưng *trước* phân trang. PostgreSQL thực hiện việc này, thay vì tải hết
products về Python. Dạng SQL tương ứng là:

```sql
SELECT ... FROM products
WHERE name ILIKE '%phone%' AND price >= 20
ORDER BY created_at DESC, id DESC
LIMIT 10 OFFSET 20;
```

`OFFSET` của trang `page` là `(page - 1) * page_size`; trang vượt phạm vi chỉ
không có hàng trả về, còn metadata vẫn giữ đúng. Kiểm tra bằng
`?search=phone&page=3&page_size=10` khi chỉ có 11 kết quả.

## 3. Vì sao cần stable sorting

Nhiều products có thể cùng `stock`, `price` hoặc `created_at`. Nếu chỉ sắp xếp
theo cột đó, database không cam kết thứ tự giữa các hàng bằng nhau; một item có
thể đổi trang ở hai request liên tiếp. Service luôn thêm `id` cùng chiều làm
tie-breaker, ví dụ `ORDER BY stock ASC, id ASC`. Với sort mặc định là
`created_at DESC, id DESC`. Test `test_sorting_is_stable_with_id_tie_breaker`
kiểm tra chính hành vi này.

## 4. Index giúp gì và khi nào không giúp

Index giúp PostgreSQL tìm ít hàng hơn hoặc đọc được thứ tự cần thiết mà không
quét/sắp xếp cả bảng. Tuy nhiên index làm chậm ghi và tốn dung lượng, nên không
tạo chỉ vì một query “có vẻ” cần. Trên database test Phase 03 chỉ có
`products_pkey`; với khoảng 1.020 hàng, query lọc category/price và sắp xếp
mất khoảng 0,276 ms dù dùng sequential scan, nên chưa có bằng chứng để thêm
index. Nếu dữ liệu thật lớn hơn và `EXPLAIN ANALYZE` cho thấy query này chậm,
hãy đo lại workload trước khi cân nhắc index theo filter/sort thực tế.

## 5. Dùng EXPLAIN ANALYZE tìm truy vấn chậm

Chạy truy vấn thật với tiền tố `EXPLAIN ANALYZE`, ví dụ:

```sql
EXPLAIN ANALYZE
SELECT * FROM products
WHERE category_id = 16 AND price >= 50
ORDER BY created_at DESC, id DESC
LIMIT 10;
```

Đọc `Seq Scan`/`Index Scan`, số `Rows Removed by Filter`, bước `Sort`, và
`Execution Time`. Kết quả test có `Seq Scan` trên 1.020 hàng, lọc còn 500 hàng,
`top-N heapsort` và `Execution Time: 0.276 ms`. Điều đó mô tả chi phí hiện tại,
không phải lý do tự động thêm index. Khi so sánh sau này, dùng cùng dữ liệu và
cùng query để kết luận đáng tin cậy.
