# Product Catalog — Project Context

> Tài liệu tóm tắt dự án, dựa trên nội dung repo tại branch `main` (commit `677acde`).
> Thông tin không xác định từ repo được ghi rõ là "chưa xác định".

## 1. Mục đích

- **Làm gì:** REST API và giao diện web quản lý danh mục sản phẩm, gồm storefront cho khách và trang quản trị cho admin.
- **Vấn đề giải quyết:** quản lý sản phẩm, danh mục, ảnh, giỏ hàng và người dùng/phiên đăng nhập.
- **Bản chất:** monorepo học tập FastAPI + React (theo README). Chưa phải hệ thống production.
- **Đối tượng sử dụng:**
  - Khách: xem, tìm kiếm sản phẩm; quản lý giỏ hàng.
  - ADMIN: quản lý sản phẩm, danh mục, ảnh sản phẩm, người dùng và phiên đăng nhập.

## 2. Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Backend | Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, Pydantic Settings, PyJWT, pwdlib (Argon2), Pillow, python-multipart, uvicorn |
| Database | PostgreSQL 16 (dữ liệu chính) |
| Cache / session | Redis 7 (session, blacklist access token, rate limit, cache product) |
| Object storage | MinIO (ảnh sản phẩm, bucket private) |
| Frontend | React, Vite, TypeScript, React Router, Axios, lucide-react |
| Môi trường | macOS; Docker Desktop cho PostgreSQL/Redis/MinIO; backend và frontend chạy trực tiếp trên máy |
| Deploy | Chưa xác định. Có stack Full Docker để chạy local (`docker-compose.yml`: backend, frontend + Nginx, PostgreSQL, Redis, MinIO), chưa có HTTPS |

## 3. Cấu trúc thư mục

```text
product_mangement/
├── README.md                      # Hướng dẫn chạy local, auth, rate limit, ảnh, test
├── PROJECT_CONTEXT.md             # File này
├── .env.example                   # Biến môi trường mẫu (placeholder)
├── .gitignore                     # Ignore .env.*, giữ .env.example
├── docker-compose.yml             # Full Docker: 5 service, Nginx cổng 127.0.0.1:8080
├── .env.docker.example            # Biến môi trường cho Full Docker (placeholder)
├── infra/
│   └── compose.yml                # Chế độ dev: chỉ PostgreSQL, Redis, MinIO
├── backend/
│   ├── pyproject.toml             # Dependencies, pytest config
│   ├── alembic.ini, migrations/   # Migration database
│   ├── app/
│   │   ├── main.py                # Entry point: create_app(), lifespan, middleware
│   │   ├── api/router.py          # Gắn prefix /api
│   │   ├── api/v1/router.py       # Gắn các router endpoint
│   │   ├── api/v1/endpoints/      # auth, admin, products, categories, cart
│   │   ├── services/              # Logic nghiệp vụ: auth, product, cart, category, image
│   │   ├── core/                  # config, security (JWT), rate_limit, cache, middleware
│   │   ├── models/                # SQLAlchemy: user, product, category, cart, image_cleanup
│   │   ├── schemas/               # Pydantic request/response
│   │   ├── db/                    # Base, database session
│   │   └── routers/health.py      # /health
│   ├── scripts/
│   │   ├── seed.py                # Dữ liệu mẫu (10 danh mục, 100 sản phẩm), idempotent
│   │   ├── create_admin.py        # Tạo tài khoản admin
│   │   └── cleanup_orphan_images.py  # Dọn ảnh MinIO còn sót (có --dry-run)
│   └── tests/                     # 14 file test, một số cần PostgreSQL/Redis
├── frontend/
│   ├── package.json, vite.config.ts, tsconfig*.json
│   └── src/
│       ├── api/                   # Axios client, auth, products, categories, cart
│       ├── auth/, cart/           # AuthContext, CartContext
│       ├── pages/                 # Storefront, products admin, categories, sessions, users
│       ├── components/            # layout, products, categories, storefront, feedback
│       └── hooks/                 # useProducts, useDebounce
└── docs/                          # Tài liệu theo phase (PHASE_00 → PHASE_13), SECURITY_SECRETS_AUDIT.md
```

## 4. Luồng hoạt động chính

**Entry point:** `backend/app/main.py` → `create_app()` → `/health` và `/api` → `/api/v1` → các endpoint.

**Request thông thường:**
endpoint → service → SQLAlchemy → PostgreSQL.
Product list, detail và các trang cursor có cache Redis, fallback PostgreSQL khi Redis lỗi.

**Xác thực và phiên:**
- `POST /api/v1/auth/login` cấp access JWT (15 phút) và refresh token (7 ngày) trong HttpOnly cookie, cùng một session Redis.
- Access JWT chứa `sub`, `sid`, `jti`, `iat`, `exp`. Logout đánh dấu `jti` vào blacklist Redis (không lưu raw JWT).
- `POST /api/v1/auth/refresh` yêu cầu refresh cookie và header `X-CSRF-Token`; mỗi lần xoay token mới.
- Mutation yêu cầu CSRF header. Frontend tự refresh một lần khi nhận 401.
- Auth là fail-closed: Redis không truy cập được thì trả 503.

**Rate limit:** Redis, fixed window. Login, refresh, logout, mutation admin, upload ảnh và public search có giới hạn riêng; vượt giới hạn trả 429 kèm `Retry-After`. Identity được HMAC bằng `RATE_LIMIT_KEY_SECRET` trước khi thành key Redis.

**Ảnh sản phẩm:**
upload (JPEG/PNG/WebP, tối đa 5 MB) → chuẩn hóa thành WebP → lưu MinIO bucket private.
Replace/delete ghi task cleanup trong PostgreSQL cùng transaction với Product, rồi mới xóa object. Client đọc ảnh qua `/api/v1/products/{id}/image`.

**Phân trang sản phẩm:** có hai API. Offset (`/products`) cho admin, trang chủ và `/shop` khi chọn sắp xếp khác; cursor (`/products/cursor`, ký HMAC bằng `PRODUCT_CURSOR_HMAC_KEY`, limit 1–100) cho `/shop` ở thứ tự mặc định với nút “Tải thêm”. Chi tiết: `docs/PHASE_13_LEARNING.md` mục 12.

## 5. Cấu hình và cách chạy

Có hai chế độ: dev (bên dưới) và Full Docker (`docker compose --env-file .env.docker up --build -d`, truy cập `http://localhost:8080`; xem README và `docs/PHASE_16_DOCKER.md`).

### Infra

```bash
cp infra/.env.example infra/.env        # Sửa password trước khi dùng ngoài local
docker volume create product-catalog-postgres-data
docker compose -f infra/compose.yml up -d
```

Cổng: PostgreSQL `5432`, Redis `6379`, MinIO S3 `127.0.0.1:9010`, MinIO Console `127.0.0.1:9011`.
Không chạy `docker compose down -v` vì sẽ mất dữ liệu trong volume.

### Biến môi trường (`.env` ở root)

Tạo từ `.env.example`. Các nhóm chính:

- **Database:** `DATABASE_URL`, `DATABASE_POOL_SIZE`, `DATABASE_MAX_OVERFLOW`
- **Redis:** `REDIS_URL`, `REDIS_CONNECT_TIMEOUT_SECONDS`, `REDIS_SOCKET_TIMEOUT_SECONDS`
- **MinIO:** `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_SECURE`
- **Secret bắt buộc (ba giá trị):**
  - `JWT_SECRET_KEY`: ký JWT.
  - `PRODUCT_CURSOR_HMAC_KEY`: ký cursor phân trang.
  - `RATE_LIMIT_KEY_SECRET`: HMAC identity trong key rate limit.
  - Mỗi giá trị phải ≥ 32 ký tự, khác nhau, không chứa placeholder (`change_me`, `replace_me`, `your_secret`, `generate_a`, `example`). Nếu không đạt, backend không khởi động. Sinh bằng `openssl rand -hex 32`.
- **Auth và bảo mật khác:** `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `JWT_REFRESH_TOKEN_EXPIRE_DAYS`, `JWT_COOKIE_SECURE`, `RATE_LIMIT_*_PER_MINUTE`, `TRUSTED_PROXY_IPS`, `SECURITY_HSTS_ENABLED`
- **Ứng dụng:** `CORS_ORIGINS`, `VITE_API_URL`

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
python -m pip install -e ".[dev]"
alembic -c alembic.ini upgrade head
uvicorn app.main:app --reload          # http://localhost:8000, Swagger /docs
```

Lệnh bổ sung:
- `python -m scripts.seed`: dữ liệu mẫu.
- `python -m scripts.create_admin <email>`: tạo admin, hỏi mật khẩu hai lần.
- `python -m scripts.cleanup_orphan_images [--dry-run]`: dọn ảnh còn sót.

### Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run build
```

### Test

- Chạy nhanh: `pytest` trong `backend/`. Không có `TEST_DATABASE_URL` và `TEST_REDIS_URL` thì nhiều test bị skip.
- Đầy đủ: cần PostgreSQL và Redis riêng cho test. Dùng database `product_catalog_test` và Redis db `15`. Test cache chỉ flush db 15. Test auth chạy migration và xóa dữ liệu, nên không trỏ vào database dev.
- Frontend: `npm test` (Vitest), `npm run typecheck`, `npm run build`.

## 6. Trạng thái hiện tại

**Đã hoàn thành (theo `docs/`):** phase 0 đến phase 13, gồm:
- Auth, session, CSRF, blacklist access token.
- Rate limit Redis và security headers.
- Quản lý ảnh sản phẩm qua MinIO.
- Giỏ hàng và storefront.
- Cursor pagination có chữ ký.
- Security audit: tách ba secret, fail-fast khi cấu hình sai (PR #18, đã merge).

**TODO / FIXME trong code:** không tìm thấy.

**Rủi ro và việc còn mở:**

1. **Dependency đã ghim (Phase 14B/15):** frontend dùng version chính xác; backend ghim trong `pyproject.toml` và có `backend/requirements.lock`. Nâng cấp phải chạy lại toàn bộ test.
2. **Frontend:** 76 test Vitest (API được mock) gồm product, category, giỏ hàng, sessions, admin users và cache theo đăng nhập. Chưa có E2E với backend/trình duyệt thật và chưa có ESLint.
3. **Test backend phụ thuộc hạ tầng:** cần PostgreSQL, Redis và MinIO test (xem `docs/PHASE_15_TESTING.md`); thiếu thì test bị skip và không có xác nhận đầy đủ. Lần chạy đủ gần nhất: 111 passed, 0 skipped.
4. **Chưa có cấu hình deploy thật:** Phase 16 thêm Dockerfile và Nginx để chạy local (`docs/PHASE_16_DOCKER.md`) nhưng chưa có HTTPS, backup volume, mật khẩu Redis. README nói CSP frontend sẽ được thiết kế và test riêng.
5. **Hiệu năng cursor pagination chưa đo:** `docs/PHASE_13_LEARNING.md` ghi cần chạy `EXPLAIN (ANALYZE, BUFFERS)` khi có dữ liệu đủ lớn trước khi thêm index.
6. **Kiểm tra secret chỉ là heuristic:** độ dài, tính khác nhau, placeholder, ít ký tự khác nhau và khối lặp. Không đo được entropy thật; sinh secret bằng `openssl rand -hex 32`.
7. **Lịch sử commit:** commit `6788cf7` ghi `Co-Authored-By: Claude Sonnet 5.5`. Chưa sửa vì cần rewrite lịch sử.

## 7. Tài liệu liên quan

- `README.md`: hướng dẫn chạy đầy đủ.
- `docs/SECURITY_SECRETS_AUDIT.md`: inventory secret, phát hiện và cách xoay key.
- `docs/PHASE_XX_*.md`: ghi chú học tập và báo cáo theo từng phase.
