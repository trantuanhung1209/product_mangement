# Phase 04 — Redis Caching

## 1. Cache-aside là gì?

Cache-aside nghĩa là API tự đọc cache trước, chỉ đọc database khi cache không
có dữ liệu, sau đó tự ghi kết quả vào cache. Trong
`backend/app/api/v1/endpoints/products.py`, `GET /products` và
`GET /products/{id}` gọi `get_cached_model()` trước service PostgreSQL. Khi
MISS, service cũ vẫn là nguồn dữ liệu thật và `set_cached_model()` lưu JSON
trong 60 giây. Redis không thay thế database và không giữ transaction.

## 2. Cache HIT/MISS hoạt động thế nào?

Nếu Redis có JSON hợp lệ, endpoint dựng lại `ProductListResponse` hoặc
`ProductResponse` bằng Pydantic, đặt `X-Cache: HIT` và không query PostgreSQL.
Nếu key chưa có, endpoint query database, ghi cache, rồi trả `X-Cache: MISS`.
Ví dụ gọi cùng `GET /api/v1/products?search=keyboard` hai lần: lần đầu MISS,
lần sau HIT. Header này và log `Cache hit`/`Cache miss` giúp quan sát đơn giản
mà không làm thay đổi JSON response contract.

## 3. TTL khác invalidation thế nào?

TTL là thời gian sống tự hết hạn: `CACHE_TTL_SECONDS = 60` trong
`app/core/cache.py`. Invalidation là chủ động làm cache cũ không còn được dùng
ngay sau thay đổi dữ liệu. POST Product chỉ tăng version list; PUT, PATCH và
DELETE tăng version list lẫn detail. TTL là lưới an toàn cho dữ liệu cũ, còn
invalidation giúp client không phải chờ 60 giây sau mutation.

## 4. Vì sao cache key phải chứa query params?

Mỗi tổ hợp query có thể là một danh sách khác. `product_list_cache_key()` nhận
chuỗi từ `urlencode(query.model_dump(mode="json"))`, nên key chứa `page`,
`page_size`, `search`, `category_id`, `min_price`, `max_price`, `sort_by` và
`order` đã qua Pydantic validation/trim. Vì vậy `search=phone` không dùng dữ
liệu của `search=laptop`, còn `search=%20phone%20` và `search=phone` cùng key
do schema đã trim giá trị trước khi tạo key.

## 5. Vì sao invalidation phải sau DB commit?

`create_product()`, `update_product()` và `delete_product()` trong service chỉ
trả về khi `db.commit()` thành công. Endpoint chỉ gọi
`invalidate_product_*_cache()` sau lời gọi đó. Nếu validation hoặc transaction
thất bại và service ném exception, flow không đi tới invalidation; cache đang
có vẫn hợp lệ. Version namespace còn chặn race: GET cũ ghi muộn vào version
cũ, trong khi request sau mutation chỉ đọc version mới.

## 6. Redis lỗi thì request đi theo luồng nào?

Lifespan trong `app/main.py` tạo một Redis client dùng chung, với connect và
socket timeout từ `REDIS_*_TIMEOUT_SECONDS`, rồi đóng client khi app shutdown.
Các lỗi `RedisError` được log ngắn gọn và cache helper trả về `None`; endpoint
coi đó là MISS và đọc PostgreSQL bình thường. Vì thế Redis unavailable không
tạo HTTP 500 hoặc che giấu database error. Khi Redis trở lại, request tiếp theo
sẽ tự cache lại kết quả.

## Ghi chú về Category

Product response hiện chỉ có `category_id`, không nhúng tên hay description
của Category. Vì vậy sửa/xóa Category không làm thay đổi payload product đã
cache và không cần invalidation product cache ở phase này. Nếu response sau
này thêm dữ liệu Category, mutation Category phải tăng cache version tương tự.

## Cache cho endpoint cursor (bổ sung)

Endpoint `GET /products/cursor` của Phase 13 cũng đi qua cache này: cùng
cache-aside, TTL và `LIST_VERSION_KEY`, nên mọi invalidation của danh sách đã có
tự áp dụng cho các trang cursor. Key chứa thêm chuỗi cursor và tiền tố `cursor:`.
Chi tiết ở `PHASE_13_LEARNING.md` mục 13.
