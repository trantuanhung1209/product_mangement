# Phase 08 — JWT Authentication & RBAC

## Authentication và Authorization

Authentication xác định bạn là ai: `POST /auth/login` kiểm tra email và mật
khẩu Argon2. Authorization quyết định bạn được làm gì: `require_admin_with_csrf`
chỉ cho ADMIN mutation Product/Category. GET products/categories không dùng
dependency này nên vẫn public.

## JWT gồm những phần nào?

JWT có header, payload và signature. Payload ở `core/security.py` có `sub`
(user id), `role`, `csrf`, `iat`, `exp`; signature HMAC-SHA256 dùng
`JWT_SECRET_KEY`. Payload không mã hóa, nên không đặt mật khẩu hay dữ liệu nhạy
cảm vào đó.

## Ký và verify access token

`create_access_token()` đặt thời hạn rồi `jwt.encode()`. `get_current_user()`
chỉ chấp nhận HS256, yêu cầu claim cần thiết, verify signature/`exp`, sau đó lấy
User thật từ database và kiểm tra `is_active`. Token hết hạn, sai chữ ký hoặc
user inactive đều trả 401.

## 401 và 403

401 là chưa xác thực hoặc token không hợp lệ; frontend điều hướng người dùng
đến `/login`. 403 là đã đăng nhập nhưng USER không có ADMIN role, hoặc CSRF
header/cookie không khớp. Phân biệt này giúp UI báo đúng lý do nhưng backend
vẫn là nơi thực thi quyền.

## RBAC với FastAPI Depends

Route mutation khai báo `Depends(require_admin_with_csrf)`. Dependency gọi
`get_current_user`, kiểm tra role ADMIN và kiểm tra CSRF trước khi service
commit database. Việc ẩn nút trên React chỉ là trải nghiệm; request tự tạo vẫn
bị backend chặn.

## Vì sao password không lưu plain text?

`pwdlib` dùng Argon2 để tạo `password_hash`; database chỉ có hash. Login dùng
verify hash, không thể đọc ngược mật khẩu từ bảng users. Script tạo admin dùng
`getpass` để mật khẩu không hiện terminal hay nằm trong source.

## JWT stateless và logout

Server không giữ session/token blacklist. Logout xóa cookie HttpOnly tại browser
nên người dùng không còn token để gửi, nhưng bản token bị sao chép vẫn sống đến
`exp`. Nếu cần revoke tức thời sau này, thêm session/version hoặc blacklist là
một thiết kế riêng.

## HttpOnly cookie và CSRF

Access token cookie là HttpOnly nên JavaScript không đọc được. Cookie `csrf_token`
không HttpOnly được frontend copy vào `X-CSRF-Token`; backend so sánh header,
cookie và claim JWT cho mutation. Đây là double-submit token, cần thiết vì
browser tự gửi cookie theo request.
