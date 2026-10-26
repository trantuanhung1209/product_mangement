# Phase 12 — Rate Limiting & Security Hardening

Phase này thêm Redis rate limiting cho các route dễ bị abuse.

Mục tiêu là bảo vệ ở tầng ứng dụng, không phải hệ thống chống DDoS.

## 1. Rate Limiting là gì? Khác Authentication thế nào?

Authentication trả lời “request này là của ai?”.

Trong project, app/core/security.py xác minh JWT, session Redis và User.

Rate limiting trả lời “identity này gửi quá nhiều request trong khoảng ngắn chưa?”.

Một ADMIN hợp lệ vẫn có thể nhận 429 nếu gửi mutation quá nhanh.

Ngược lại, một request chưa có access token vẫn là 401 dù chưa vượt limit.

Rate limiting không thay password hash, CSRF, CORS, RBAC hay JWT.

Mỗi cơ chế bảo vệ một rủi ro riêng.

## 2. Vì sao dùng Redis thay vì Python dictionary?

Dictionary chỉ sống trong một process Uvicorn.

Nhiều workers sẽ có nhiều counter độc lập.

Khi đó client có thể vượt limit bằng cách rơi vào worker khác.

Redis là state dùng chung giữa worker/process và có TTL.

Limiter dùng get_redis() ở app/core/cache.py.

Do đó nó tái sử dụng Redis connection pool hiện có.

Không có Redis client mới cho từng request.

## 3. Fixed Window hoạt động như thế nào?

Một window 60 giây được đánh số bằng epoch_seconds // 60.

Cùng scope và identity trong cùng window dùng chung một key.

Ví dụ key có dạng:

security:ratelimit:public-search:<hmac-identity>:<window>

Request tăng counter, sau đó so count với limit.

Request limit + 1 nhận 429.

Key hết hạn ở cuối window.

Fixed window đơn giản và chi phí thấp, phù hợp Product Catalog.

Điểm cần hiểu: có burst ở ranh giới hai window.

Client có thể gửi gần limit cuối phút và lại gửi gần limit đầu phút sau.

Traffic lớn hơn trong tương lai có thể cần sliding window hoặc token bucket.

## 4. INCR, EXPIRE, TTL và Lua atomicity là gì?

INCR tăng counter.

EXPIRE đặt thời gian tự xóa key.

TTL trả số giây key còn sống.

Tách INCR rồi EXPIRE bằng hai command không an toàn.

Process có thể chết sau INCR trước khi đặt TTL.

Khi đó counter không tự hết hạn.

_INCREMENT_WITH_TTL trong app/core/rate_limit.py dùng Lua để INCR, EXPIRE và TTL
trong cùng một Redis operation.

Redis thực thi Lua script tuần tự.

Hai request đồng thời không thể cùng đọc một counter cũ rồi cùng ghi lại.

TTL Redis được trả về làm Retry-After.

Vì vậy Retry-After khớp với counter thật, không phải timestamp tự tính lại.

## 5. Race condition trong rate limiter xảy ra thế nào?

Giả sử limit là 5 và counter đang là 4.

Request A và B đều đọc 4.

Cả hai đều cho phép request thứ 5 và cùng ghi 5.

Hệ thống đã cho 6 request nhưng không biết.

Lua atomic increment/check loại bỏ race này.

Test test_public_limit_is_atomic_and_spoofed_forwarded_for_is_ignored tạo năm
TestClient đồng thời với limit 3.

Kết quả được kiểm tra là đúng ba 200 và hai 429 trên Redis thật.

Không mock counter Redis trong test concurrency này.

## 6. Vì sao trả HTTP 429?

429 Too Many Requests nghĩa request hợp lệ về cấu trúc nhưng bị giới hạn tạm thời.

401 dành cho chưa xác thực.

403 dành cho sai role, CSRF hoặc Origin.

503 nghĩa limiter không thể kiểm tra theo policy fail-closed.

Response giữ convention FastAPI của project:

{"detail": "Too many requests. Please try again later."}

Response không đưa Redis key, IP hoặc email ra client.

## 7. Retry-After dùng để làm gì?

Khi limit bị vượt, enforce_limit() trả Retry-After.

Giá trị này là TTL còn lại của key Redis.

Browser hoặc frontend có thể chờ đúng khoảng này thay vì retry liên tục.

Test login xác nhận header tồn tại và có số giây dương.

Retry-After không phải quyền retry vô hạn.

Axios interceptor vẫn chỉ silent refresh một lần theo implementation hiện có.

## 8. Per-IP, Per-User và Per-Account khác nhau thế nào?

| Identity | Dùng ở đâu | Lý do |
| --- | --- | --- |
| IP | Login, refresh, public search | Chặn burst chưa xác thực |
| Email account | Login | Không khóa toàn bộ NAT chỉ vì một account |
| User ID | Cart và admin mutation | User A không tiêu quota User B |
| Session ID | Logout/revoke access | Giới hạn thao tác đúng session |

Email được trim/lowercase trước khi dùng identity login.

Identity luôn đi qua HMAC-SHA256 trước khi thành Redis key.

Secret là RATE_LIMIT_KEY_SECRET, bắt buộc và riêng biệt với JWT_SECRET_KEY (không còn fallback).

Redis không giữ raw email, raw JWT, refresh token hay raw session ID trong key.

## 9. Vì sao không được tin mọi X-Forwarded-For?

Client trực tiếp có thể tự gửi X-Forwarded-For giả.

Nếu app tin nó, attacker chỉ cần đổi header mỗi request để bypass per-IP limit.

client_ip() dùng request.client.host làm IP mặc định.

Chỉ khi peer IP nằm trong TRUSTED_PROXY_IPS app mới đọc X-Forwarded-For.

Default là mảng rỗng, nên local/direct request an toàn hơn.

Khi có Nginx, chỉ thêm IP thật của proxy.

Không dùng wildcard hoặc trust-all proxies.

Test xác nhận XFF giả bị bỏ qua.

Test cũng xác nhận XFF chỉ phân biệt IP sau khi testclient được cấu hình trusted.

## 10. Fail-open và fail-closed là gì?

Fail-closed nghĩa Redis limiter lỗi thì từ chối request bằng 503.

Project chọn fail-closed cho login, refresh, logout/revoke, Cart và admin mutation.

Đây là lựa chọn an toàn vì các route này thay đổi auth state hoặc dữ liệu.

Fail-open nghĩa bỏ qua limiter tạm thời nhưng vẫn xử lý request.

Project chọn fail-open cho public product search.

Product cache vẫn có fallback PostgreSQL như Phase 04.

503 không phải 429.

429 nghĩa quota đã vượt; 503 nghĩa security dependency hiện unavailable.

## 11. CSRF, CORS, JWT và Rate Limiting khác nhau ra sao?

JWT + Redis session xác minh identity và cho phép revoke session.

RBAC trong require_admin() kiểm tra role.

CSRF trong require_csrf() chặn website khác lợi dụng cookie browser.

CORS điều khiển browser có được đọc cross-origin response hay không.

CORS không thay authorization.

Rate limiting giảm brute force, burst và abuse.

Ví dụ upload có CSRF sai vẫn là 403.

Upload hợp lệ hơn 10 lần/phút là 429.

Redis auth unavailable là 503, không bypass session validation.

## 12. Security Headers có mục đích gì?

SecurityHeadersMiddleware nằm ở app/core/middleware.py.

Nó thêm X-Content-Type-Options: nosniff.

Header này ngăn browser tự đoán MIME không đúng.

Nó thêm X-Frame-Options: DENY để API không bị nhúng frame.

Nó thêm Referrer-Policy: strict-origin-when-cross-origin để giảm rò URL.

HSTS chỉ thêm khi SECURITY_HSTS_ENABLED=true.

Không bật HSTS mặc định trên localhost HTTP vì browser sẽ ép HTTPS và làm dev hỏng.

CSP frontend chưa được thêm.

Vite, font và ảnh storefront cần browser QA trước khi áp CSP chặt.

Hoãn CSP ở đây là quyết định tránh policy giả làm hỏng UI.

## 13. Kiểm thử rate limiting bằng Redis thật thế nào?

Tests dùng TEST_REDIS_URL=redis://localhost:6379/15.

Chỉ Redis DB 15 được flush, development cache DB 0 không bị đụng.

Chạy riêng:

    cd backend
    export TEST_DATABASE_URL='postgresql+psycopg://.../product_catalog_test'
    export TEST_REDIS_URL='redis://localhost:6379/15'
    pytest tests/test_rate_limit.py -q

backend/tests/test_rate_limit.py kiểm tra 429, Retry-After, HMAC key, TTL.

Nó kiểm tra concurrent request, XFF spoof, trusted proxy và per-user isolation.

Nó kiểm tra Redis unavailable cho fail-closed login và fail-open public search.

Full suite tiếp tục bảo vệ refresh rotation, blacklist, CSRF, Cart, cache và image.

## 14. Tradeoffs của implementation hiện tại là gì?

Fixed window có burst ở ranh giới window.

Limiter chỉ đặt ở abuse-prone endpoint, không thay CDN/Nginx rate limit.

TRUSTED_PROXY_IPS phải khớp topology deploy thật.

Default an toàn là không trust proxy.

HSTS là opt-in khi API đã HTTPS.

CSP frontend hoãn đến khi browser verification đầy đủ.

Redis client synchronous giống session/cache hiện có.

Mỗi protected operation thêm một Lua call nhưng tái sử dụng client pool.

## Rate limits hiện tại

| Scope | Limit mặc định |
| --- | --- |
| Login theo IP và account | 5/phút |
| Refresh theo IP | 20/phút |
| Logout/revoke access theo session | 10/phút |
| Cart + Product/Category mutation theo user | 30/phút |
| Upload image theo user | 10/phút |
| Public product search theo IP | 60/phút |
