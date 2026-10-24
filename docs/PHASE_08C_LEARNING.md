# Phase 08C — Quản lý phiên đăng nhập

## Multi-device session là gì?

Mỗi lần login, `create_session()` sinh một `sid` khác nhau. Vì vậy cùng một user
có thể đăng nhập ở nhiều browser mà không dùng chung phiên. `GET /auth/sessions`
chỉ lấy user từ access JWT, không nhận `user_id` từ client, nên không thể xem
phiên của người khác bằng cách đổi tham số URL.

## Redis Session Index

Session vẫn nằm ở `auth:session:{sid}`, còn set `auth:user-sessions:{user_id}`
là index chứa các sid của user đó. Nhờ `SMEMBERS`, backend tìm phiên của một user
mà không dùng `KEYS` hay quét toàn bộ Redis. Khi list, sid không còn key session
sẽ bị `SREM`; đó là stale-index cleanup sau Redis TTL.

## Session ID và Refresh Token

`sid` là định danh server-side, xuất hiện trong access JWT và Redis index.
Refresh token là bí mật HttpOnly có dạng `sid.secret`; Redis chỉ lưu hash của
`secret`. API session chỉ trả metadata như thời điểm login, hết hạn và User-Agent,
không bao giờ trả token, refresh hash hay CSRF secret.

## Revoke session

`revoke_user_session()` WATCH key session trước khi MULTI/EXEC xóa session và
SREM index. Sau revoke, access JWT dù còn hạn cũng bị `get_current_user()` chặn
vì không còn Redis session; refresh token cùng sid cũng không dùng được. Logout
và revoke current session xóa cookie tại browser.

## JWT còn hạn vẫn có thể bị từ chối vì sao?

JWT xác nhận chữ ký và thời hạn, nhưng app còn kiểm tra session trong Redis.
Đó là trade-off có chủ đích: auth không hoàn toàn stateless nhưng đổi lại revoke
có hiệu lực ngay. Redis unavailable trả 503 fail-closed, không âm thầm bỏ qua
session validation.

## IDOR và cách phòng tránh

IDOR xảy ra khi user thay ID trên URL để truy cập dữ liệu người khác. Route user
revoke dùng `current_user.id` từ JWT và `revoke_user_session()` kiểm tra owner
trong Redis; session không thuộc user trả 404. Admin API dùng `require_admin`
và CSRF riêng, không dựa vào việc frontend ẩn nút.

## TTL và stale index

Redis tự xóa `auth:session:{sid}` khi hết TTL. Index có thể còn sid cũ trong một
khoảng thời gian, nên list kiểm tra từng sid rồi dọn stale entry. TTL index được
gia hạn khi login; không cần cron job hay Redis scan để danh sách chỉ hiện phiên
còn hoạt động.

## Lưu ý bảo mật cho Admin

Admin chỉ xem metadata cần thiết và có thể revoke đúng một session hoặc toàn bộ
session của user. User-Agent chỉ là mô tả browser do client gửi, không phải bằng
chứng danh tính. Các mutation admin yêu cầu access JWT ADMIN, CSRF header và
Origin hợp lệ.
