# Phase 18 — Quên mật khẩu và đổi mật khẩu

Dùng lại cơ chế OTP của Phase 17 (Redis, HMAC, Resend). Không có migration.

## 1. Endpoint

| Endpoint | Xác thực | Kết quả |
| --- | --- | --- |
| `POST /api/v1/auth/password/forgot {email}` | không (kiểm tra Origin) | 202, cùng nội dung dù email có tồn tại hay không |
| `POST /api/v1/auth/password/reset {email, otp, new_password}` | không (kiểm tra Origin) | 204; không đăng nhập, không gửi thư xác nhận |
| `POST /api/v1/auth/password/change {current_password, new_password}` | đăng nhập + CSRF | 204; mọi phiên bị thu hồi, cookie bị xóa |

Frontend: `/forgot-password` (2 bước), `/account/password` (menu tài khoản và thanh bên admin), link
"Quên mật khẩu?" ở trang login. Thành công cả hai luồng chuyển về `/login` kèm thông báo.

## 2. Quên mật khẩu

- `forgot`: cooldown 60 giây theo email (áp dụng cả email không tồn tại). Chỉ tài khoản **tồn tại và
  đang hoạt động** mới nhận mã; email lạ không nhận gì. Thư gửi sau response nên thời gian phản hồi như nhau.
- Redis: `password-reset:pending:<HMAC(email)>` = `{otp_hash, attempts}`, TTL 300s, tối đa 5 lần sai.
  Namespace và nhãn HMAC gắn với mục đích, nên mã đăng ký không dùng được để đặt lại mật khẩu và ngược lại.
- `reset` làm theo thứ tự cố định:
  1. kiểm tra OTP (đếm sai) nhưng **chưa xóa** khi đúng;
  2. khóa dòng user (`SELECT … FOR UPDATE`) và kiểm tra mật khẩu mới khác mật khẩu cũ;
  3. xóa OTP nguyên tử (Lua "xóa nếu hash còn khớp"): chỉ một request đồng thời thắng;
  4. ghi hash mới, thu hồi toàn bộ phiên, commit.
- Vì sao kiểm tra "trùng mật khẩu cũ" sau OTP: nếu làm trước, ai chưa có mã cũng dùng được thông báo lỗi để
  dò "đây có phải mật khẩu hiện tại không". Làm sau OTP thì lỗi trùng không làm mất mã.
- Redis lỗi khi thu hồi phiên thì request lỗi 503 và transaction rollback: mật khẩu không đổi.

## 3. Đổi mật khẩu

- Cần phiên + CSRF thật, và rate limit riêng theo user và theo IP, vì endpoint này verify mật khẩu cũ
  (một phiên bị đánh cắp có thể dùng nó để đoán mật khẩu).
- Sai mật khẩu hiện tại trả **400**, không phải 401: axios interceptor coi 401 là phiên hết hạn và sẽ tự refresh/đăng xuất.
- Sau khi đổi: blacklist access token hiện tại, thu hồi mọi phiên (kể cả phiên này), xóa cookie.
  Frontend gọi `clearSession` (không gọi API logout), `AuthContext` reset toàn bộ cache, rồi chuyển về `/login`.

## 4. Thu hồi phiên

`revoke_all_user_sessions` xóa từng phiên trong Redis. Access token mang `sid` và `get_current_user` kiểm tra
phiên ở mỗi request, nên xóa phiên là vô hiệu hóa cả access token ngay lập tức; refresh token cũng chết theo.
Blacklist `jti` ở luồng đổi mật khẩu là lớp bảo hiểm thêm (reset không có token để blacklist).

## 5. Quy tắc mật khẩu: một nguồn

- Backend: `schemas/password_rules.py` (`require_strong_password`) dùng cho đăng ký, reset và đổi mật khẩu.
- Frontend: `utils/passwordRules.ts`.
- `frontend/src/utils/passwordCases.json` là một bảng test dùng chung: test backend
  (`test_password_rules.py`) và test frontend (`passwordRules.test.ts`) cùng đọc file này nên hai bên không lệch được.

## 6. Cấu hình

Thêm `RATE_LIMIT_PASSWORD_PER_MINUTE` (mặc định 5) cho `forgot`/`reset`/`change`. Các biến `OTP_*`,
`RESEND_*`, `OTP_HMAC_KEY` đã có từ Phase 17. Adapter console không còn hiển thị mã: ở dev thiếu key
Resend thì thư không được gửi (chỉ có một dòng log chỉ báo).

## 7. Test

- Backend `test_password.py` + `test_password_rules.py` (40 test): từng quy tắc mật khẩu, OTP đúng/sai/hết hạn/quá 5 lần/dùng lại,
  phản hồi giống nhau cho email lạ, tài khoản bị khóa không nhận mã, mã khác mục đích không dùng lẫn được,
  trùng mật khẩu cũ không đốt mã, không có oracle khi sai mã, cooldown và rate limit (429 + `Retry-After`),
  Origin lạ, field lạ, Redis lỗi, race 8 reset đồng thời, reset/đổi mật khẩu thu hồi phiên và access token,
  đổi mật khẩu cần CSRF, không có OTP/mật khẩu trong log và response.
- Frontend `PasswordPages.test.tsx`: luồng 2 bước, validation phía client, gửi lại khóa 60 giây, 429, hết hạn,
  hiện/ẩn mật khẩu, chuyển về `/login` kèm thông báo, cache bị xóa sau đổi mật khẩu.
- Mutation-check: bỏ xóa OTP, bỏ thu hồi phiên (reset và đổi), bỏ kiểm tra `is_active`, đổi 400 thành 401,
  bỏ gắn mục đích vào hash, bỏ CSRF, bỏ `clearSession`, bỏ kiểm tra mật khẩu trùng đều làm test fail.

## 8. Giới hạn

- **TOCTOU:** một lần đăng nhập đang chạy bằng mật khẩu cũ có thể tạo phiên ngay sau khi các phiên bị thu hồi.
  `FOR UPDATE` chỉ tuần tự hóa các lần đổi/đặt lại với nhau. Đóng hẳn cần cột `password_changed_at` và từ chối phiên
  tạo trước mốc đó (cần migration); đã quyết định chưa làm.
- Blacklist `jti` ở luồng đổi mật khẩu không có test riêng vì xóa phiên đã vô hiệu hóa token.
- Thư có thể vào spam khi domain mới; chưa có HTTPS (cookie `Secure` tắt); lỗi gửi thư không báo ngay cho người dùng.
- Không gửi thư thông báo sau khi đổi mật khẩu (theo yêu cầu).
