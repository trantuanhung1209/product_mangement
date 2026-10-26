# Phase 16 — Docker và Nginx

## 1. Kiến trúc

```
trình duyệt ──► 127.0.0.1:8080 ──► Nginx (frontend, 172.28.0.10)
                                     ├─ /            file tĩnh Vite + fallback SPA
                                     ├─ /api/, /health ──► backend:8000 (FastAPI)
                                     └─ (mạng nội bộ) postgres, redis, minio
```

- Chỉ Nginx publish cổng ra máy host, bind `127.0.0.1`. PostgreSQL, Redis, MinIO và backend
  **không** publish; MinIO Console không mở.
- Ảnh đi qua `/api/v1/products/{id}/image` (backend đọc MinIO), nên MinIO không cần public.
- Cùng origin: trình duyệt chỉ nói chuyện với Nginx, nên cookie `HttpOnly`, header
  `X-CSRF-Token` và CORS hoạt động như dev mà không cần CORS thực sự (`CORS_ORIGINS` vẫn
  đặt `http://localhost:8080` cho đúng).
- Frontend build với `VITE_API_URL` rỗng (same-origin).

## 2. File

| File | Vai trò |
| --- | --- |
| `docker-compose.yml` | 5 service, network cố định `172.28.0.0/24`, volume riêng, project `product-catalog-stack` |
| `backend/Dockerfile`, `docker-entrypoint.sh` | Python 3.14-slim, cài từ `requirements.lock`, chạy non-root; entrypoint: `alembic upgrade head` → `scripts.ensure_bucket` → `uvicorn` |
| `backend/scripts/ensure_bucket.py` | Tạo bucket MinIO nếu chưa có (idempotent) |
| `frontend/Dockerfile`, `nginx.conf` | Build Node 22 → Nginx 1.29 |
| `.env.docker.example` | Mẫu biến môi trường cho Docker (placeholder). `.env.docker` thật bị git ignore |
| `backend/.dockerignore`, `frontend/.dockerignore` | Loại venv, node_modules, `.env*`, dist, cache, tests |

`infra/compose.yml` và `.env.example` cho chế độ dev **không đổi hành vi**.

## 3. Biến môi trường mới (`.env.docker`)

| Biến | Ý nghĩa |
| --- | --- |
| `POSTGRES_USER/PASSWORD/DB` | Khởi tạo PostgreSQL; `DATABASE_URL` phải dùng cùng mật khẩu, host `postgres` |
| `MINIO_ROOT_USER/PASSWORD` | Tài khoản gốc MinIO; `MINIO_ACCESS_KEY/SECRET_KEY` của API phải khớp, `MINIO_ENDPOINT=minio:9000` |
| `REDIS_URL` | `redis://redis:6379/0` |
| `TRUSTED_PROXY_IPS` | `["172.28.0.10"]` — địa chỉ cố định của Nginx trong compose |
| `CORS_ORIGINS` | `["http://localhost:8080"]` |
| `JWT_COOKIE_SECURE` | `false` vì chạy HTTP local; phải `true` sau HTTPS |
| `WEB_PORT` (tùy chọn) | Cổng host của Nginx, mặc định 8080 |
| `MINIO_IMAGE` (tùy chọn) | Mặc định `firstfinger/minio:latest-arm64` (cùng dev); đổi `-amd64` trên Intel/Linux |

## 4. Quyết định kỹ thuật

- **Rate limit đọc đúng IP client.** Nginx *ghi đè* `X-Forwarded-For` bằng `$remote_addr`
  (không append), nên client không giả được IP. Backend chỉ tin XFF khi IP trực tiếp nằm
  trong `TRUSTED_PROXY_IPS`, vì vậy Nginx có IP cố định.
- **Bucket tạo ở entrypoint** (trước khi nhận request), ngoài cơ chế tạo-lười có sẵn khi upload.
- **Sửa production code duy nhất:** `apiAssetUrl` trong `frontend/src/api/client.ts` đổi
  `??` thành `||`. Với `VITE_API_URL=""`, `??` không rơi về `window.location.origin` và
  `new URL(path, "")` ném lỗi — ảnh sản phẩm sẽ hỏng. Có test `apiAssetUrl.test.ts`
  (mutation-check: đổi lại `??` thì test fail).
- Header bảo mật của `/api` do backend đặt; Nginx chỉ đặt cho file tĩnh (tránh trùng lặp).
  CSP cho frontend vẫn chưa làm (như README đã ghi).

## 5. Kết quả kiểm tra

Xem báo cáo phase trong PR/commit. Bản tóm tắt: `docker compose config`, `up --build`,
health 200 qua Nginx, trang SPA, login + CSRF + cookie HttpOnly, tạo sản phẩm, upload và đọc
ảnh WebP, `down`/`up` giữ dữ liệu, pytest 118 pass, vitest 155 pass, typecheck, build.

## 6. Giới hạn / rủi ro

- Chưa có HTTPS: cookie `Secure` tắt, HSTS tắt. Cần TLS ở lớp ngoài trước khi dùng thật.
- Trên Docker Desktop, IP client thấy là gateway của network (`172.28.0.1`) vì NAT; trên
  Linux sẽ là IP thật. Không ảnh hưởng độ đúng của cơ chế.
- Redis không có mật khẩu (chỉ ở mạng nội bộ, không publish).
- Backup volume chưa có: dữ liệu nằm trong volume `product-catalog-stack_*`; dùng `pg_dump`
  và sao chép bucket MinIO nếu cần.
- Image MinIO `firstfinger/minio` là bản cộng đồng; `minio/minio` chính thức không còn pull được.
- Backend chạy một process uvicorn, không `--workers`.
- Chưa chạy trên trình duyệt thật; kiểm tra bằng `curl`.
