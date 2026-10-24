# Phase 08B — Refresh token, Redis session và CSRF

## Access token và Refresh token

`access_token` là JWT ngắn hạn (mặc định 15 phút), chứa `sub`, `sid`, `iat`
và `exp`; backend ký nó bằng `JWT_SECRET_KEY`. Cookie này là HttpOnly nên React
không thể đọc hay lưu vào localStorage. `refresh_token` sống 7 ngày và chỉ được
browser gửi tới `/api/v1/auth/refresh`. Khi access token hết hạn, Axios gọi
refresh rồi thử lại request cũ đúng một lần.

## Redis session

Sau login, `create_session()` lưu `user_id`, hash refresh token và CSRF token ở
`auth:session:<sid>` trong Redis. Không có refresh token dạng raw trong Redis.
`get_current_user()` không chỉ verify JWT mà còn tìm session theo `sid`; vì vậy
xóa session có hiệu lực ngay cả khi access JWT chưa hết hạn. TTL Redis chính là
thời hạn tối đa của session/refresh token.

## Refresh rotation

`rotate_refresh()` dùng `WATCH` → đọc session → `MULTI/EXEC` để atomically thay
`refresh_hash` bằng hash của token mới, nhưng giữ TTL cũ. Ví dụ R1 đổi thành R2;
chỉ R2 có thể tiếp tục đổi thành R3. Nhờ `WATCH`, hai request cùng R1 không thể
cùng ghi hai token hợp lệ. Test `test_concurrent_refresh_allows_at_most_one_success`
chạy hai HTTP request với Redis test thật để kiểm chứng điểm này.

## Token reuse và network retry

Session giữ `used_refresh_hashes` đến khi TTL hết. Nếu R1 đã bị thay thế mà
được gửi lại, backend coi đó là replay và xóa session; R2/R3 trong session đó
cũng bị từ chối. Token không khớp cả current lẫn used hashes chỉ trả 401, không
được phép logout session của người khác. Đổi lại, nếu server đã rotate nhưng
response bị mất mạng, browser retry R1 sẽ bị coi là reuse và cần login lại —
đây là chính sách bảo thủ đã được chọn, không phải lỗi retry vô hạn.

## CSRF

CSRF cookie không HttpOnly để Axios copy vào header `X-CSRF-Token`; access và
refresh cookies vẫn HttpOnly. Với mutation và refresh, backend so sánh header,
cookie và CSRF value trong Redis session bằng `compare_digest`, đồng thời chặn
Origin ngoài `CORS_ORIGINS`. Vì CSRF cookie có TTL bằng refresh session, refresh
vẫn làm việc sau khi access token đã hết hạn.

## Logout và revocation

`POST /api/v1/auth/logout` cần access token hợp lệ và CSRF hợp lệ. Nó xóa Redis
session trước rồi xóa ba cookies. Một user có thể login ở nhiều browser: mỗi
login có `sid` riêng nên logout thiết bị A không ảnh hưởng thiết bị B. Access
JWT bị sao chép cũng không qua được `get_current_user()` sau khi session bị xóa.

## Redis fail-closed

Auth không dùng fallback database: Redis mất kết nối hoặc không có client thì
login, refresh và protected route trả `503 Authentication session store
unavailable`. Đây khác cache Product: cache lỗi vẫn đọc PostgreSQL như Phase 04.
Fail-closed tránh cấp hoặc chấp nhận session không thể revoke/kiểm tra.
