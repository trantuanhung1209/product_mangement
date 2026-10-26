# Security Secrets Audit

## Inventory

| Biến môi trường | Mục đích | Nơi dùng |
| --- | --- | --- |
| `JWT_SECRET_KEY` | Ký access/refresh JWT | `app/core/security.py` |
| `PRODUCT_CURSOR_HMAC_KEY` | HMAC cho cursor pagination của Product | `app/services/product.py` |
| `RATE_LIMIT_KEY_SECRET` | HMAC fingerprint identity trong Redis rate-limit key | `app/core/rate_limit.py` |

## Phát hiện và xử lý

- Cursor pagination ký bằng `JWT_SECRET_KEY` → tách sang `PRODUCT_CURSOR_HMAC_KEY`.
- Rate limiter fallback sang `JWT_SECRET_KEY` khi `RATE_LIMIT_KEY_SECRET` trống → bỏ fallback.
- Không có kiểm tra khi khởi động → `validate_security_configuration()` chạy trong lifespan
  của `app/main.py`: thiếu, ngắn hơn 32 ký tự, chứa placeholder (`change_me`, `replace_me`, `your_secret`, ...) hoặc trùng nhau giữa ba secret đều làm
  backend fail-fast, thông báo chỉ chứa tên biến, không chứa giá trị.
- `.env.example` chỉ chứa placeholder; `.gitignore` bao `.env.*` nhưng giữ `.env.example`.

## Lý do tách secret

Một secret dùng chung khiến lộ ở một tính năng ảnh hưởng tới tính năng khác (ví dụ
biết key cursor có thể giúp giả mạo JWT). Tách key giới hạn phạm vi ảnh hưởng và cho
phép xoay từng key độc lập.

## Vận hành

Tạo mỗi secret bằng `openssl rand -hex 32`. Đổi `PRODUCT_CURSOR_HMAC_KEY` chỉ làm các
cursor cũ không hợp lệ (client lấy lại trang đầu). Đổi `RATE_LIMIT_KEY_SECRET` reset
bộ đếm hiện tại. Đổi `JWT_SECRET_KEY` đăng xuất mọi session. Môi trường
nào nâng cấp lên bản này phải cấu hình đủ ba secret trước khi khởi động backend.
