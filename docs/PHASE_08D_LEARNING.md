# Phase 08D — JWT Access Token Blacklist

## 1. JWT `jti` là gì?

`jti` (JWT ID) là mã định danh duy nhất của một access token. Trong
`app/core/security.py`, `_access_token()` tạo `uuid4()` và đưa nó cùng `sub`,
`sid`, `iat`, `exp` vào JWT. Vì login và refresh đều gọi hàm này, access token
mới luôn có jti khác token cũ. Không dùng raw JWT làm identifier để tránh ghi
token nhạy cảm vào Redis. Token legacy không có `jti` bị `401`, nên không có
đường vòng qua blacklist; frontend có thể silent refresh nếu refresh session còn
hợp lệ, còn không thì cần login lại.

## 2. Access Token Blacklist hoạt động ra sao?

`POST /api/v1/auth/revoke-access` không nhận jti từ request body. Endpoint đọc
access cookie hiện tại, yêu cầu `require_csrf`, rồi gọi `blacklist_access_token()`.
Mỗi protected dependency gọi `_verified_access_claims()` trước khi đọc Redis
session. Nếu key blacklist tồn tại, request nhận `401` ngay cả khi session vẫn
còn. Đây là thu hồi một access token, không phải logout.

## 3. Vì sao lưu blacklist trong Redis?

Blacklist chỉ cần sống tối đa bằng thời gian access token còn sống (15 phút mặc
định), nên Redis nhanh và tự hết hạn phù hợp hơn PostgreSQL. Key có namespace
`auth:blacklist:access:{jti}` để không đụng `auth:session:*` hay product cache.
Giá trị chỉ là `"1"`; Redis không giữ JWT, cookie hay mật khẩu.

## 4. TTL được tính thế nào?

Sau khi PyJWT xác minh chữ ký và `exp`, backend tính `exp - thời_gian_server`.
`redis.set(key, "1", ex=ttl)` ghi value và TTL trong cùng operation. Nếu TTL
không còn dương thì token đã hoặc sắp hết hạn và trả `401`. Khi JWT hết hạn,
Redis tự xóa key blacklist nên không cần quét keyspace bằng `KEYS`.

## 5. Blacklist khác Session Revocation thế nào?

Blacklist chỉ chặn A1: refresh token vẫn cấp A2 với `jti` mới, cùng Redis session.
Session revocation (logout hoặc quản lý phiên) xóa `auth:session:{sid}`, nên A1,
A2 và refresh token của phiên đó đều không dùng được. Vì vậy logout không cần
blacklist tất cả token — xóa session đã đủ an toàn và đơn giản hơn.

## 6. Blacklist có ảnh hưởng Refresh Token không?

Không. Refresh endpoint dùng refresh cookie, session Redis và CSRF, không dùng
access token bị blacklist. Sau khi A1 bị revoke, Axios nhận `401` ở API thường,
gọi `/auth/refresh` một lần, nhận A2 rồi retry request cũ đúng một lần. Endpoint
`/auth/revoke-access` nằm trong nhóm `/auth/`, nên interceptor không refresh lặp
vô hạn khi chính endpoint này trả `401` do response mạng bị mất.

## 7. JWT stateless và stateful trong project này

Chữ ký JWT cho phép backend kiểm tra `sub/sid/jti/exp` mà không lưu raw token,
nhưng blacklist và session làm một phần authentication có state trong Redis.
Đổi lại, hệ thống có thể revoke ngay access token hoặc cả session. Đây là tradeoff
hợp lý cho catalog admin; Redis phải sẵn sàng để protected route không bypass
kiểm tra.

## 8. Redis failure phải xử lý thế nào?

Nếu Redis lỗi khi đọc blacklist hoặc session, `_verified_access_claims()` trả
`503 Authentication session store unavailable.` Nó không coi Redis lỗi là token
hợp lệ. Product public GET vẫn giữ behavior cũ; chỉ authentication fail-closed.
Test `test_rbac_and_redis_fail_closed` và blacklist tests dùng Redis database 15
riêng để kiểm tra trường hợp này.
