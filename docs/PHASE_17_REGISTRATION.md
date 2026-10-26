# Phase 17 — Đăng ký tài khoản bằng OTP qua email

## 1. Luồng

```
/register ──► POST /api/v1/auth/register/request-otp {email, password}     → 202 (luôn cùng nội dung)
              Redis: registration:pending:<HMAC(email)> = {password_hash, otp_hash, attempts}, TTL 300s
              Email OTP qua Resend (hoặc email "đã đăng ký" nếu email đã có user)
          ──► POST /auth/register/resend-otp  {email}                     → 202 (cooldown 60s)
          ──► POST /auth/register/verify-otp  {email, otp}                → 201 + cookie đăng nhập
              Đúng: tạo User(role=USER) rồi xóa pending; tự đăng nhập.
```

Không có user nào được tạo cho tới khi OTP đúng. Mật khẩu chỉ tồn tại dưới dạng hash Argon2
(trong Redis tối đa 5 phút, sau đó trong bảng `users`).

## 2. Quy tắc

- **Mật khẩu:** 8–128 ký tự, ≥1 chữ hoa (kể cả chữ có dấu), ≥1 chữ số `0-9`, ≥1 ký tự đặc biệt
  (bất kỳ ký tự không phải chữ/số, kể cả khoảng trắng). Backend là nguồn sự thật
  (`schemas/registration.py`); frontend (`utils/passwordRules.ts`) cùng bảng test để không lệch.
- **OTP:** 6 chữ số từ `secrets.randbelow`. Redis chỉ lưu `HMAC-SHA256(OTP_HMAC_KEY, email_id:otp)`.
  Hết hạn 300s. Tối đa 5 lần sai cho mỗi OTP, lần sai thứ 5 xóa OTP. Một OTP chỉ dùng được một lần.
- **Cooldown:** 60s cho mỗi email, dùng chung cho `request-otp` và `resend-otp`
  (`SET NX EX`). Vi phạm trả 429 + `Retry-After`. Cooldown được áp dụng dù email có tồn tại hay không.
- **Rate limit** (cơ chế Phase 12): `RATE_LIMIT_REGISTRATION_PER_MINUTE` (mặc định 5), riêng cho
  từng endpoint, theo IP và theo email đã HMAC. Fail-closed khi Redis lỗi (503).
- **Email trong Redis** chỉ ở dạng HMAC, không có plaintext.

## 3. Chống lộ danh sách email

- `request-otp` trả cùng phản hồi cho email mới và email đã có. Với email đã có: không tạo pending,
  gửi email thông báo "email đã được đăng ký" (không có OTP).
- Argon2 được tính ở cả hai nhánh nên thời gian phản hồi không phân biệt hai trường hợp.
- `resend-otp` không có pending thì không gửi gì và vẫn trả 202.
- Email được gửi **sau khi trả response** (`BackgroundTasks`), nên mọi nhánh (email mới, email đã có,
  resend có hoặc không có pending) trả lời trong thời gian như nhau, không phụ thuộc độ trễ của Resend.
  Nếu gửi lỗi, pending và cooldown bị xóa để người dùng yêu cầu lại ngay; người dùng không thấy lỗi ngay
  mà chỉ không nhận được thư. Riêng thiếu cấu hình Resend là lỗi triển khai, giống nhau với mọi email, nên
  vẫn trả 503 ngay.
- Race: verify kiểm tra lại email khi tạo user (unique constraint); trùng thì trả lỗi chung.
  Verify dùng một Lua script nguyên tử nên hai request đồng thời cùng OTP chỉ tạo một user.

## 4. CSRF

Người đăng ký chưa có phiên nên không áp dụng được double-submit CSRF. Thay vào đó cả ba endpoint
từ chối `Origin` lạ (`require_allowed_origin`, cùng danh sách với CORS), chỉ nhận JSON, và không
đặt cookie nào trước khi OTP đúng. Cookie đăng nhập đặt sau verify giống `login`.

## 5. Cấu hình

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `OTP_HMAC_KEY` | bắt buộc | **Secret thứ tư**, ≥32 ký tự, khác ba secret còn lại, kiểm tra như chúng (`openssl rand -hex 32`) |
| `RESEND_API_KEY` | trống | Secret của Resend. Chỉ đặt trong `.env`/`.env.docker`, không commit |
| `RESEND_FROM_EMAIL` | `noreply@uside.id.vn` | Địa chỉ gửi (domain phải verified trên Resend) |
| `OTP_TTL_SECONDS` | 300 | Thời hạn OTP |
| `OTP_MAX_ATTEMPTS` | 5 | Số lần nhập sai tối đa |
| `OTP_RESEND_COOLDOWN_SECONDS` | 60 | Cooldown gửi lại |
| `RATE_LIMIT_REGISTRATION_PER_MINUTE` | 5 | Giới hạn mỗi endpoint |
| `APP_ENV` | `production` | `development` bật adapter console khi thiếu `RESEND_API_KEY` |

Đồng hồ đếm ngược ở frontend lấy `expires_in_seconds` và `resend_in_seconds` từ phản hồi của
`request-otp`/`resend-otp`, nên đổi hai biến `OTP_*` không cần sửa frontend.

**Thiếu `RESEND_API_KEY`:** backend vẫn khởi động và ghi cảnh báo. `APP_ENV=development` dùng
`ConsoleEmailSender`: in OTP ra stdout của terminal (cố ý không qua `logging`). Mọi môi trường khác
trả 503 cho đăng ký, không bao giờ in OTP. Docker đặt `APP_ENV=production`.

## 6. Xác minh domain `uside.id.vn` trên Resend (việc thủ công)

1. Resend → Domains → Add Domain `uside.id.vn` (nên dùng subdomain gửi thư nếu domain gốc đã có mail).
2. Thêm vào DNS các bản ghi Resend hiển thị: SPF (TXT, và MX cho bounce), DKIM (TXT `resend._domainkey`).
   Mỗi tên miền chỉ một bản ghi SPF: nếu đã có thì gộp `include:`.
3. Bấm Verify tới khi `Verified`.
4. Nên thêm DMARC: TXT `_dmarc.uside.id.vn` = `v=DMARC1; p=none; rua=mailto:<hộp thư>`, siết dần sau.
5. Tạo API key quyền *Sending access* giới hạn theo domain, đặt vào `RESEND_API_KEY`.

Kiểm tra bản ghi DNS (chỉ đọc, thay `<selector>` bằng tên Resend hiển thị, thường `resend`):

```bash
dig +short TXT uside.id.vn | grep spf1            # đúng một bản ghi SPF, có include của Resend
dig +short TXT resend._domainkey.uside.id.vn       # khóa DKIM
dig +short TXT _dmarc.uside.id.vn                  # DMARC
```

Để giảm khả năng vào spam: domain mới nên "làm nóng" bằng lượng thư nhỏ; giữ nội dung ngắn, có bản text
(đã có); gửi từ địa chỉ cùng domain đã verified (đã có); theo dõi bounce/complaint trên Resend.
Việc gửi email thật **chưa được chạy** trong phase này; test mock bộ gửi và chặn mọi lời gọi Resend
(`tests/conftest.py`), kể cả khi `.env` của lập trình viên có `RESEND_API_KEY` thật.

## 7. Test

- Backend `tests/test_registration.py` (42 test): từng quy tắc mật khẩu, OTP đúng/sai/hết hạn/quá 5 lần/dùng lại,
  email đã tồn tại cho phản hồi giống nhau, từ chối `role`/`is_active`/field lạ, cooldown, rate limit
  429 + `Retry-After`, Origin lạ, lỗi gửi mail, Redis lỗi, race 8 verify đồng thời, `caplog` không có
  OTP/mật khẩu, chọn adapter. Đã mutation-check: bỏ khóa sau 5 lần, bỏ xóa OTP khi dùng, `extra="ignore"`,
  role ADMIN, bỏ kiểm tra Origin, bỏ nhánh email đã tồn tại đều làm test fail.
- `test_rbac.py` phân loại 3 route mới là public.
- Frontend: `passwordRules`, `PasswordInput` (đổi type), `RegisterPage` (đếm ngược, nút gửi lại khóa đúng 60s,
  429, 422, quên mật khẩu sau bước 1, link login ↔ register).

## 8. HTTPS và cookie `Secure`

Code đã hỗ trợ: đặt `JWT_COOKIE_SECURE=true` (và `SECURITY_HSTS_ENABLED=true`) khi có HTTPS. Khi
`APP_ENV` khác `development` mà `JWT_COOKIE_SECURE=false`, backend ghi cảnh báo lúc khởi động.
Stack Docker hiện chỉ phục vụ HTTP trên `127.0.0.1:8080` nên cảnh báo này xuất hiện ở đó là đúng.
TLS phải do lớp ngoài (load balancer hoặc reverse proxy có chứng chỉ) đảm nhiệm; chưa cấu hình trong repo.

## 9. Giới hạn

- Domain/Resend chưa được verify và chưa gửi thử; thư có thể vào spam khi domain mới.
- Chưa có HTTPS trong repo (xem mục 8). Chưa có quên mật khẩu / đổi mật khẩu.
- Lỗi gửi thư không báo ngay cho người dùng (xem mục 3); họ chờ rồi bấm "Gửi lại mã".
- Đồng hồ đếm ngược ở frontend chỉ là gợi ý; server mới là nơi quyết định.
