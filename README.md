# Product Catalog

Ứng dụng web quản lý danh mục sản phẩm (bài thực tập `docs/ThucHanh-Tuan2.md`): REST API
FastAPI, giao diện React, cache Redis, Docker. Có storefront cho khách (xem sản phẩm, giỏ hàng,
đăng ký/đăng nhập) và trang quản trị cho ADMIN (sản phẩm, danh mục, ảnh, người dùng, phiên).

**Chạy nhanh bằng Docker** (chi tiết ở "Hai chế độ chạy"):

```bash
cp .env.docker.example .env.docker     # điền secret bằng openssl rand -hex 32
docker compose --env-file .env.docker up --build -d
# mở http://localhost:8080  ·  Swagger UI: http://localhost:8080/docs  (chế độ dev: http://localhost:8000/docs)
```

> Đề bài viết "chỉ cần `docker compose up --build`". Dự án giữ thêm bước tạo `.env.docker` có chủ ý:
> secret (JWT, HMAC, mật khẩu database) không được nằm trong git, và backend từ chối khởi động nếu
> thiếu hoặc dùng giá trị mẫu.

## Cấu trúc

```text
product-catalog/
├── backend/       # FastAPI, cấu hình bằng Pydantic Settings
├── frontend/      # React + Vite + TypeScript
├── docs/          # Tài liệu học và báo cáo phase
└── .env.example   # Biến môi trường dùng chung
```

## Mức độ đáp ứng đề bài

| Yêu cầu (`docs/ThucHanh-Tuan2.md`) | Trạng thái |
| --- | --- |
| Models `Category`, `Product` + Alembic | Có (migration trong `backend/migrations`) |
| REST `/api/v1` cho products (GET list/detail, POST, PUT, PATCH, DELETE) và categories | Có (bảng API bên dưới) |
| Phân trang `page`, `page_size` (mặc định 10, tối đa 100), `items/total/page/page_size/total_pages` | Có |
| `search`, `category_id`, `min_price`, `max_price`, `sort_by`, `order` kết hợp phân trang | Có |
| Cache Redis cho list và detail, TTL 60s, invalidate khi ghi, header `X-Cache: HIT/MISS` | Có |
| Pydantic validate, mã trạng thái chuẩn, `.env`, CORS, Swagger `/docs` | Có |
| Script seed ≥ 100 sản phẩm | Có (`python -m scripts.seed`: 100 sản phẩm) |
| Frontend: tìm kiếm debounce 500ms, lọc, sắp xếp, phân trang, loading/empty/error | Có |
| Chi tiết, form thêm/sửa có validate, modal xác nhận xóa, toast, filter/page trên URL | Có |
| `useProducts`, `useDebounce`, tách `api/`, URL API qua biến môi trường | Có |
| Dockerfile backend, frontend multi-stage + Nginx, compose (backend, frontend, postgres, redis + minio), volume, healthcheck, `depends_on` | Có (thêm `.env.docker`, xem ghi chú ở đầu) |
| `.env.example`, `.dockerignore` | Có |
| Nâng cao: JWT + RBAC, upload ảnh, pytest, rate limit, cursor pagination, React Query | Có cả sáu |
| ERD, danh sách API, README | Có (bên dưới); ảnh chụp màn hình (28 ảnh; còn thiếu trạng thái error, form lỗi, đăng nhập, mobile: xem `docs/screenshots/README.md`) |

Khác biệt cấu trúc: các router API nằm ở `backend/app/api/v1/endpoints/` (thay vì `routers/`);
`app/routers/` chỉ chứa `/health`. Các thư mục `models/`, `schemas/`, `services/`, `core/` đúng như đề bài.

## Sơ đồ ERD

```mermaid
erDiagram
    users ||--o| carts : "có một"
    carts ||--o{ cart_items : "gồm"
    products ||--o{ cart_items : "được thêm vào"
    categories ||--o{ products : "chứa"

    users {
        int id PK
        string email UK
        string password_hash
        enum role "ADMIN | USER"
        bool is_active
        datetime created_at
    }
    categories {
        int id PK
        string name UK
        text description
        datetime created_at
    }
    products {
        int id PK
        string name
        text description
        numeric price
        int stock
        int category_id FK
        string image_url
        string image_object_key
        int image_width
        int image_height
        datetime created_at
        datetime updated_at
    }
    carts {
        int id PK
        int user_id FK
        datetime created_at
        datetime updated_at
    }
    cart_items {
        int id PK
        int cart_id FK
        int product_id FK
        int quantity
        datetime created_at
        datetime updated_at
    }
    image_cleanup_tasks {
        int id PK
        string object_key UK
        datetime created_at
    }
```

`cart_items` có ràng buộc duy nhất `(cart_id, product_id)`. `products.category_id` dùng
`ON DELETE RESTRICT` (không xóa được danh mục còn sản phẩm). `image_cleanup_tasks` là bảng việc
dọn ảnh MinIO, không có khóa ngoại. Phiên đăng nhập, OTP và rate limit nằm trong Redis, không phải
PostgreSQL.

## Danh sách API

Bảng sinh từ OpenAPI thật của backend (`/docs` có chi tiết tham số và schema). "Công khai" nghĩa là
không cần đăng nhập; các POST/PUT/PATCH/DELETE yêu cầu đăng nhập còn cần header `X-CSRF-Token`.

| Method | Đường dẫn | Quyền |
| --- | --- | --- |
| GET | `/health` | Công khai |
| GET | `/api/v1/admin/users` | ADMIN |
| GET | `/api/v1/admin/users/{user_id}/sessions` | ADMIN |
| DELETE | `/api/v1/admin/users/{user_id}/sessions` | ADMIN |
| DELETE | `/api/v1/admin/users/{user_id}/sessions/{session_id}` | ADMIN |
| POST | `/api/v1/auth/login` | Công khai |
| POST | `/api/v1/auth/logout` | Đăng nhập |
| GET | `/api/v1/auth/me` | Đăng nhập |
| POST | `/api/v1/auth/password/change` | Đăng nhập |
| POST | `/api/v1/auth/password/forgot` | Công khai |
| POST | `/api/v1/auth/password/reset` | Công khai |
| POST | `/api/v1/auth/refresh` | Công khai |
| POST | `/api/v1/auth/register/request-otp` | Công khai |
| POST | `/api/v1/auth/register/resend-otp` | Công khai |
| POST | `/api/v1/auth/register/verify-otp` | Công khai |
| POST | `/api/v1/auth/revoke-access` | Đăng nhập |
| GET | `/api/v1/auth/sessions` | Đăng nhập |
| DELETE | `/api/v1/auth/sessions/others` | Đăng nhập |
| DELETE | `/api/v1/auth/sessions/{session_id}` | Đăng nhập |
| GET | `/api/v1/cart` | Đăng nhập |
| DELETE | `/api/v1/cart` | Đăng nhập |
| POST | `/api/v1/cart/items` | Đăng nhập |
| PATCH | `/api/v1/cart/items/{product_id}` | Đăng nhập |
| DELETE | `/api/v1/cart/items/{product_id}` | Đăng nhập |
| GET | `/api/v1/categories` | Công khai |
| POST | `/api/v1/categories` | ADMIN |
| PUT | `/api/v1/categories/{category_id}` | ADMIN |
| DELETE | `/api/v1/categories/{category_id}` | ADMIN |
| GET | `/api/v1/products` | Công khai |
| POST | `/api/v1/products` | ADMIN |
| GET | `/api/v1/products/cursor` | Công khai |
| GET | `/api/v1/products/{product_id}` | Công khai |
| PUT | `/api/v1/products/{product_id}` | ADMIN |
| PATCH | `/api/v1/products/{product_id}` | ADMIN |
| DELETE | `/api/v1/products/{product_id}` | ADMIN |
| GET | `/api/v1/products/{product_id}/image` | Công khai |
| POST | `/api/v1/products/{product_id}/image` | ADMIN |
| DELETE | `/api/v1/products/{product_id}/image` | ADMIN |

Tham số danh sách sản phẩm (`GET /api/v1/products`): `page` (mặc định 1), `page_size` (mặc định 10,
tối đa 100), `search`, `category_id`, `min_price`, `max_price`, `sort_by` (mặc định `created_at`),
`order` (`asc`/`desc`). Response: `items`, `total`, `page`, `page_size`, `total_pages`, kèm header
`X-Cache: HIT` hoặc `MISS`.

## Ảnh chụp màn hình

Chụp ở chế độ Full Docker. Danh sách đầy đủ và các ảnh còn thiếu: [`docs/screenshots/README.md`](docs/screenshots/README.md).

**Storefront**

| | |
| --- | --- |
| ![Trang chủ](docs/screenshots/shop-home.png) | ![Tìm kiếm](docs/screenshots/shop-search.png) |
| Trang chủ | Tìm kiếm (giữ `search`, `page` trên URL) |
| ![Lọc giá](docs/screenshots/shop-filter-price.png) | ![Tìm kiếm và lọc giá](docs/screenshots/shop-search-and-price-filter.png) |
| Lọc theo khoảng giá | Kết hợp tìm kiếm và lọc giá |
| ![Chi tiết sản phẩm](docs/screenshots/shop-product-detail.png) | ![Chưa có ảnh](docs/screenshots/shop-product-detail-no-image.png) |
| Chi tiết sản phẩm | Sản phẩm chưa có ảnh |
| ![Giỏ hàng](docs/screenshots/shop-cart.png) | ![Đăng ký OTP](docs/screenshots/register-otp-step.png) |
| Giỏ hàng | Đăng ký: nhập OTP, đếm ngược, gửi lại bị khóa |
| ![Trạng thái empty](docs/screenshots/shop-empty-state.png) | ![Trạng thái loading](docs/screenshots/shop-loading-state.png) |
| Trạng thái empty | Trạng thái loading |
| ![Tải thêm](docs/screenshots/shop-load-more.png) | ![Sau nhiều lần tải thêm](docs/screenshots/shop-load-more-expanded.png) |
| Cursor pagination: "Tải thêm sản phẩm" | Danh sách sau nhiều lần tải thêm |
| ![Đăng ký bước 1](docs/screenshots/register-details.png) | ![Đăng ký bước 2](docs/screenshots/register-otp-filled.png) |
| Đăng ký: quy tắc mật khẩu, hiện/ẩn mật khẩu | Đăng ký: nhập OTP |
| ![Email OTP](docs/screenshots/otp-email.png) | ![Đổi mật khẩu](docs/screenshots/change-password.png) |
| Email OTP gửi qua Resend | Đổi mật khẩu |

**Quản trị (ADMIN)**

| | |
| --- | --- |
| ![Danh sách sản phẩm](docs/screenshots/admin-products-sort-pagination.png) | ![Xác nhận xóa](docs/screenshots/admin-products-delete-confirm.png) |
| Sắp xếp và phân trang | Modal xác nhận xóa |
| ![Form chỉnh sửa](docs/screenshots/admin-product-edit-form.png) | ![Chi tiết và toast](docs/screenshots/admin-product-detail-toast.png) |
| Form chỉnh sửa sản phẩm | Chi tiết sản phẩm và toast |
| ![Danh mục](docs/screenshots/admin-categories.png) | ![Người dùng](docs/screenshots/admin-users.png) |
| Quản lý danh mục | Quản lý người dùng |
| ![Phiên của người dùng](docs/screenshots/admin-user-sessions.png) | ![Phiên của tôi](docs/screenshots/account-sessions.png) |
| Phiên đăng nhập của một người dùng | Phiên đăng nhập của tôi |

**API, cache và Docker**

![Swagger UI](docs/screenshots/swagger-docs.png)

| | |
| --- | --- |
| ![X-Cache MISS](docs/screenshots/cache-miss-devtools.png) | ![X-Cache HIT](docs/screenshots/cache-hit-devtools.png) |
| `X-Cache: MISS` (lần đầu) | `X-Cache: HIT` (lần sau) |

![docker compose ps](docs/screenshots/docker-compose-ps.png)

## Hai chế độ chạy

| | Dev (mặc định) | Full Docker |
| --- | --- | --- |
| Compose | `infra/compose.yml` (chỉ PostgreSQL, Redis, MinIO) | `docker-compose.yml` ở root (thêm backend, frontend + Nginx) |
| Backend / frontend | chạy trên máy (`uvicorn`, `npm run dev`) | chạy trong container |
| Biến môi trường | `.env` (hostname `localhost`) | `.env.docker` (hostname `postgres`, `redis`, `minio`) |
| Địa chỉ | frontend `:5173`, API `:8000` | tất cả qua Nginx `http://localhost:8080` |
| Dữ liệu | volume `product-catalog-*` | volume riêng của project `product-catalog-stack` |

Hai chế độ không dùng chung dữ liệu và không xung đột cổng (stack Docker chỉ publish
`127.0.0.1:8080`). Chi tiết, kiểm tra và rủi ro: `docs/PHASE_16_DOCKER.md`.

### Full Docker

**1. Tạo `.env.docker` (một lần).**

```bash
cp .env.docker.example .env.docker
```

Mở `.env.docker` và thay mọi chỗ `<...>`:

- Mật khẩu: `openssl rand -hex 24`. `POSTGRES_PASSWORD` phải giống mật khẩu trong `DATABASE_URL`;
  `MINIO_ROOT_PASSWORD` phải giống `MINIO_SECRET_KEY`.
- Bốn secret ứng dụng: `openssl rand -hex 32`. Phải khác nhau và dài ít nhất 32 ký tự
  (`JWT_SECRET_KEY`, `PRODUCT_CURSOR_HMAC_KEY`, `RATE_LIMIT_KEY_SECRET`, `OTP_HMAC_KEY`).
  Backend từ chối khởi động nếu sai; log chỉ nêu tên biến, không in giá trị.
- Máy Intel hoặc Linux: bỏ dấu `#` ở `MINIO_IMAGE` và đổi thành `-amd64` (Apple Silicon dùng mặc định).
- `.env.docker` đã nằm trong `.gitignore`, đừng commit.

**2. Khởi động.**

```bash
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker ps          # đợi cả 5 service "healthy"
curl http://localhost:8080/health
```

Lần đầu build mất vài phút. Backend tự chạy `alembic upgrade head` và tạo bucket MinIO trước khi nhận
request. Mở ứng dụng ở http://localhost:8080 và Swagger ở http://localhost:8080/docs. Chỉ cổng 8080 được mở
ra máy bạn; database, Redis, MinIO và backend chỉ nằm trong mạng nội bộ của compose.

**3. Dữ liệu mẫu và tài khoản admin** (chạy trong container bằng `exec`; chi tiết ở
`docs/PHASE_16_DOCKER.md` mục 10b):

```bash
dc() { docker compose --env-file .env.docker "$@"; }
dc exec backend python -m scripts.seed                                # 10 danh mục, 100 sản phẩm
dc exec -it backend python -m scripts.create_admin admin@example.com  # -it để mật khẩu không bị hiện
dc exec backend python -m scripts.cleanup_orphan_images --dry-run
```

Rồi đăng nhập tại http://localhost:8080/login (khu quản trị: `/admin/products`).
`create_admin` không kiểm tra độ mạnh mật khẩu, nên hãy tự đặt mật khẩu mạnh.

**4. Đăng ký và quên mật khẩu bằng OTP** cần `RESEND_API_KEY`. Để trống thì `/register` và
`/forgot-password` báo "Không thể gửi email lúc này" (phần còn lại vẫn chạy). Điền key vào `.env.docker`
rồi chạy `dc up -d` (không cần `--build`).

**5. Vận hành hằng ngày.**

```bash
dc logs -f backend        # xem log (Ctrl+C để thoát)
dc down                   # dừng, xóa container, GIỮ dữ liệu
dc up -d                  # chạy lại, dữ liệu còn nguyên
dc up --build -d          # sau khi sửa code, build lại image
```

**Không dùng `down -v`**: nó xóa volume PostgreSQL/MinIO của stack và mất toàn bộ dữ liệu.

| Triệu chứng | Cách xử lý |
| --- | --- |
| `env file .env.docker not found` | Chưa tạo `.env.docker` (bước 1) |
| Backend khởi động lại liên tục | `dc logs backend`; thường do secret ngắn, trùng nhau hoặc còn chữ `<...>` |
| `up` treo ở "Waiting" | `dc ps` xem service chưa healthy, rồi `dc logs <service>` |
| Cổng 8080 đã bị dùng | Thêm `WEB_PORT=8081` vào `.env.docker` và đổi `CORS_ORIGINS` thành `["http://localhost:8081"]` |
| Sửa code nhưng không thấy đổi | Chạy `dc up --build -d` |

### Đăng ký bằng OTP

`/register` tạo tài khoản USER sau khi xác minh email bằng mã 6 số gửi qua Resend. Cần
`OTP_HMAC_KEY` (secret thứ tư), `RESEND_API_KEY` và domain đã verified; ở dev để trống key và đặt
`APP_ENV=development` thì backend vẫn chạy nhưng không gửi thư (và không hiển thị mã). Quên mật khẩu (`/forgot-password`) và đổi mật khẩu (`/account/password`) dùng cùng cơ chế OTP/phiên. Chi tiết: `docs/PHASE_17_REGISTRATION.md`, `docs/PHASE_18_PASSWORD.md`.

## Yêu cầu

- macOS với Python 3.11+ và Node.js 20+
- Docker Desktop đang chạy (để chạy PostgreSQL, Redis và MinIO local)
- `curl` (có sẵn trên macOS)

## Chạy trên macOS

### 1. Chạy PostgreSQL, Redis và MinIO

Compose chỉ chạy infrastructure local; backend và frontend vẫn chạy trực tiếp trên macOS.
Tạo file secret cục bộ, đồng thời đảm bảo giá trị PostgreSQL/MinIO khớp với `.env` ở root:

```bash
cp infra/.env.example infra/.env
# Sửa password trong infra/.env trước khi dùng ngoài môi trường học tập.
docker volume create product-catalog-postgres-data
docker compose -f infra/compose.yml up -d
docker compose -f infra/compose.yml ps
```

S3 API MinIO là `127.0.0.1:9010`; MinIO Console là `http://127.0.0.1:9011`.
Không chạy `docker compose down -v`: named volumes giữ database và object ảnh giữa các lần restart.

### 2. Cấu hình environment

Tạo `.env` tại thư mục gốc:

```bash
cp .env.example .env
```

Với hai container ở trên, `.env` cần có các giá trị sau:

```env
CORS_ORIGINS=["http://localhost:5173"]
VITE_API_URL=http://localhost:8000

DATABASE_URL=postgresql+psycopg://product_catalog:product_catalog_dev@localhost:5432/product_catalog
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=10

REDIS_URL=redis://localhost:6379/0
REDIS_CONNECT_TIMEOUT_SECONDS=1
REDIS_SOCKET_TIMEOUT_SECONDS=1

MINIO_ENDPOINT=127.0.0.1:9010
MINIO_ACCESS_KEY=product_catalog_minio
MINIO_SECRET_KEY=product_catalog_minio_dev
MINIO_BUCKET=product-images
MINIO_SECURE=false

JWT_SECRET_KEY=generate_a_random_32_byte_secret
PRODUCT_CURSOR_HMAC_KEY=generate_a_different_random_32_byte_secret
RATE_LIMIT_KEY_SECRET=generate_a_third_random_32_byte_secret
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=15
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
JWT_COOKIE_SECURE=false
```

Không commit `.env`. Nếu Vite chạy tại port `5174`, đổi `CORS_ORIGINS` thành `http://localhost:5174` rồi restart backend.

### 3. Chạy migration và backend

Mở Terminal thứ nhất:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
alembic -c alembic.ini upgrade head
uvicorn app.main:app --reload
```

API ở `http://localhost:8000`, Swagger ở `http://localhost:8000/docs`.

Dependency backend được ghim chính xác trong `backend/pyproject.toml`;
`backend/requirements.lock` ghi toàn bộ phiên bản (kể cả gián tiếp) đã chạy qua
bộ test. Để cài đúng các phiên bản đó dùng `python -m pip install -r requirements.lock`
rồi `python -m pip install --no-deps -e .`. Khi nâng cấp, sửa `pyproject.toml`,
chạy lại `pytest` rồi tạo lại file lock từ `pip list --format=freeze`.

### Đăng nhập quản trị

Tạo từng secret local bằng `openssl rand -hex 32`, gán vào `JWT_SECRET_KEY`,
`PRODUCT_CURSOR_HMAC_KEY` và `RATE_LIMIT_KEY_SECRET` trong `.env` (ba giá trị
phải khác nhau, mỗi giá trị ≥32 ký tự; thiếu hoặc trùng thì backend không
khởi động), rồi restart backend. Xem `docs/SECURITY_SECRETS_AUDIT.md`. Tạo Admin không cần hardcode mật khẩu:

```bash
cd backend
source .venv/bin/activate
python -m scripts.create_admin admin@example.com
```

Lệnh sẽ yêu cầu nhập mật khẩu hai lần. Đăng nhập tại `/login`; access token và
refresh token được lưu trong HttpOnly cookie, không lưu ở localStorage. Khi
deploy HTTPS, đặt `JWT_COOKIE_SECURE=true`.

### Login, refresh, logout và CSRF

- `POST /api/v1/auth/login`: cấp access JWT 15 phút, refresh token 7 ngày và
  CSRF cookie cho một Redis session.
- `GET /api/v1/auth/me`: cần access cookie và session Redis còn hiệu lực.
- `POST /api/v1/auth/refresh`: cần refresh cookie cùng header
  `X-CSRF-Token`; mỗi lần gọi thay refresh token cũ bằng token mới.
- `POST /api/v1/auth/logout`: cần access cookie cùng CSRF header; revoke đúng
  session hiện tại trong Redis và xóa cookies.
- `POST /api/v1/auth/revoke-access`: cần access cookie cùng CSRF header; chỉ
  blacklist access token hiện tại đến khi token hết hạn. Refresh token và Redis
  session vẫn còn hiệu lực, nên request protected tiếp theo có thể silent refresh.

Access JWT chứa `sub`, `sid`, `jti`, `iat` và `exp`. `jti` là UUID riêng cho
mỗi access token; Redis chỉ lưu `auth:blacklist:access:{jti}` với TTL bằng thời
gian còn lại của token, không lưu raw JWT. Token cũ không có `jti` bị từ chối;
nếu refresh cookie/session còn hiệu lực frontend sẽ cấp token mới, nếu không thì
người dùng cần login lại. Blacklist không thay thế logout: logout revoke toàn bộ
session, còn blacklist chỉ chặn đúng access token đang dùng.

Frontend tự gửi CSRF header cho `POST`, `PUT`, `PATCH`, `DELETE` và tự refresh
một lần khi request protected nhận 401. Redis là bắt buộc với auth: nếu Redis
không truy cập được, auth trả 503 thay vì bỏ qua session validation. Product
cache vẫn fallback PostgreSQL khi Redis lỗi.

### Rate limiting và security headers

Redis giới hạn các route dễ bị abuse: login (5/phút theo IP và account), refresh
(20/phút/IP), logout/revoke access (10/phút/session), Cart và Product/Category
admin mutation (30/phút/user), upload ảnh (10/phút/user), public product search
(60/phút/IP). Khi vượt giới hạn API trả `429` với `Retry-After`.

Login và protected mutations fail-closed với `503` khi Redis limiter không sẵn
sàng; public search giữ fallback database/cache. `RATE_LIMIT_KEY_SECRET` là
secret random bắt buộc, riêng biệt với `JWT_SECRET_KEY`, dùng để
HMAC identity trong Redis keys. Không lưu raw email, JWT hay refresh token vào key.

Mặc định API **không tin** `X-Forwarded-For`. Khi deploy sau reverse proxy, chỉ
đặt `TRUSTED_PROXY_IPS` là JSON array chứa IP của proxy được tin cậy, ví dụ
`["172.18.0.2"]`; không dùng `*`. Chỉ đặt `SECURITY_HSTS_ENABLED=true` sau khi
HTTPS đã được terminate cho API. API thêm `nosniff`, `X-Frame-Options: DENY` và
`Referrer-Policy`; CSP frontend sẽ được thiết kế/test riêng để không làm Vite,
fonts hoặc ảnh storefront hỏng.

### Quản lý phiên đăng nhập

- `GET /api/v1/auth/sessions`: các phiên của user hiện tại.
- `DELETE /api/v1/auth/sessions/{session_id}`: thu hồi một phiên thuộc user.
- `DELETE /api/v1/auth/sessions/others`: giữ phiên hiện tại, đăng xuất thiết bị khác.
- `GET /api/v1/admin/users` và `/api/v1/admin/users/{id}/sessions`: ADMIN xem
  users/phiên; các `DELETE` admin cần CSRF để thu hồi phiên.

Mở `/account/sessions` để quản lý thiết bị của chính bạn. ADMIN có thêm
`/admin/users`. Redis lưu index `auth:user-sessions:{user_id}`, nên không dùng
Redis `KEYS` để liệt kê session.

### Ảnh sản phẩm

Thiết lập `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` và
`MINIO_BUCKET` trong `.env`, rồi chạy migration mới nhất. ADMIN có thể chọn JPEG,
PNG hoặc WebP tối đa 5 MB trong form sản phẩm; backend chuẩn hóa thành WebP trong
bucket private. Public client chỉ đọc ảnh qua `/api/v1/products/{id}/image`.
Khi replace/delete ảnh, backend ghi task cleanup trong PostgreSQL cùng transaction
Product, rồi mới thử xóa object. Nếu MinIO đang lỗi, chạy lại thủ công:

```bash
cd backend
python -m scripts.cleanup_orphan_images --dry-run
python -m scripts.cleanup_orphan_images
```

`--dry-run` không xóa gì. Command chỉ xét object key đã được ghi thành task, và
kiểm tra lại Product trước khi xóa; nó không quét hay xóa mù toàn bộ bucket.

### 4. Tạo dữ liệu mẫu

Database mới sẽ chưa có sản phẩm. Sau khi migration xong, mở Terminal khác và chạy:

```bash
cd backend
source .venv/bin/activate
python -m scripts.seed
```

Script thêm 10 danh mục và 100 sản phẩm tiếng Việt, với giá/tồn kho đa dạng để
thử search, filter, sort và pagination. Nó idempotent: chạy lại không tạo
duplicate và không update/xóa dữ liệu bạn đã sửa. Script dùng `DATABASE_URL`
hiện tại, nên không chạy nó với production database.

### 5. Chạy frontend

Mở Terminal thứ hai:

```bash
cd frontend
npm install
npm run dev
```

Mở URL Vite in ra (mặc định `http://localhost:5173`), sau đó vào `/products` để
xem, thêm, sửa và xóa sản phẩm.

## Chạy tests

Backend integration tests dùng PostgreSQL và Redis **riêng**, không dùng
database local đang phát triển. Tạo database test một lần (không xóa database
hay volume đang có):

```bash
docker exec -it product-catalog-postgres createdb -U product_catalog product_catalog_test
```

Chỉ chạy lệnh trên nếu database `product_catalog_test` chưa tồn tại. Sau đó:

```bash
cd backend
source .venv/bin/activate
export TEST_DATABASE_URL='postgresql+psycopg://product_catalog:product_catalog_dev@localhost:5432/product_catalog_test'
export TEST_REDIS_URL='redis://localhost:6379/15'
pytest

# Chạy riêng rate-limit integration/concurrency tests
pytest tests/test_rate_limit.py -q
```

Test MinIO luôn dùng bucket `product-images-test` (đổi bằng `TEST_MINIO_BUCKET`),
không ghi vào bucket dev. Chi tiết, ma trận kiểm thử và các rủi ro còn lại:
`docs/PHASE_15_TESTING.md`.
`TEST_REDIS_URL` dùng Redis database số 15; cache tests chỉ flush database này,
không đụng Redis development database số 0. Frontend dùng Vitest (API được mock,
không cần backend); chạy cùng typecheck và build:

```bash
cd frontend
npm test
npm run typecheck
npm run build
```

## Chạy toàn bộ local

1. Khởi động infrastructure bằng `docker compose -f infra/compose.yml up -d` ở bước 1.
2. Chạy `alembic -c alembic.ini upgrade head`, rồi `uvicorn app.main:app --reload`.
3. Chạy `python -m scripts.seed` nếu cần dữ liệu mẫu.
4. Chạy `npm run dev` trong `frontend`; storefront ở `/`, `/shop`, `/shop/:id`
   và giỏ hàng ở `/cart`.

## Giỏ hàng

Giỏ hàng yêu cầu đăng nhập, dùng cookie HttpOnly hiện có và CSRF header do Axios
tự thêm. Backend là source of truth; refresh browser hoặc login lại cùng tài
khoản sẽ đọc lại cart từ PostgreSQL.

- `GET /api/v1/cart`: cart hiện tại, gồm tổng số lượng và tạm tính.
- `POST /api/v1/cart/items`: thêm `{ "product_id": 1, "quantity": 1 }`.
- `PATCH /api/v1/cart/items/{product_id}`: đổi `{ "quantity": 2 }`.
- `DELETE /api/v1/cart/items/{product_id}`: xóa một sản phẩm.
- `DELETE /api/v1/cart`: xóa toàn bộ sản phẩm trong cart.

Các mutation yêu cầu authenticated session và `X-CSRF-Token`; không gửi price
từ frontend. Migration Cart là `20261024_05`, chạy bằng `alembic upgrade head`.

## Cursor pagination cho Product API

`GET /api/v1/products` vẫn dùng offset pagination cho Admin Dashboard và Shop
hiện tại. Consumer cần cuộn dữ liệu lớn có thể dùng endpoint mới:

```text
GET /api/v1/products/cursor?limit=20&search=python&category_id=1&min_price=100000
```

Endpoint cố định thứ tự `created_at DESC, id DESC`, dùng keyset pagination và
trả `{ "items", "next_cursor", "has_more" }`. Gửi nguyên `next_cursor` làm
`cursor` cho lần kế tiếp, đồng thời giữ nguyên các filter. Cursor là opaque,
đã được ký và gắn với filter; cursor sai, bị sửa hoặc dùng với filter khác sẽ
trả `400`. Migration `20261025_06` thêm index `(created_at, id)` phục vụ query
này.

## Kiểm tra nhanh

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/v1/products
```

Kết quả mong đợi:

```json
{"status":"ok","service":"product-catalog-api"}
```

Nếu API Products trả `total: 0`, hãy tạo dữ liệu theo bước 4. Nếu backend không chạy, kiểm tra `docker ps` và chạy lại migration trước.

## Tài liệu học

- [Phase 00 — Foundation](docs/PHASE_00_FOUNDATION.md)
- [Phase 00B — Request lifecycle](docs/PHASE_00B_LEARNING.md)
- [Phase 01 — Database](docs/PHASE_01_LEARNING.md)
- [Phase 02 — REST API](docs/PHASE_02_LEARNING.md)
- [Phase 03 — Product query](docs/PHASE_03_LEARNING.md)
- [Phase 04 — Redis caching](docs/PHASE_04_LEARNING.md)
- [Phase 05 — Frontend](docs/PHASE_05_LEARNING.md)
- [Phase 06 — Product CRUD frontend](docs/PHASE_06_LEARNING.md)
- [Phase 07 — Seed data & testing](docs/PHASE_07_LEARNING.md)
- [Phase 08 — JWT authentication & RBAC](docs/PHASE_08_LEARNING.md)
- [Phase 08B — Refresh token & Redis session](docs/PHASE_08B_LEARNING.md)
- [Phase 08C — Session management](docs/PHASE_08C_LEARNING.md)
- [Phase 09 — Image processing](docs/PHASE_09_LEARNING.md)
- [Phase 11 — Shopping Cart](docs/PHASE_11_LEARNING.md)
- [Phase 12 — Rate limiting & security hardening](docs/PHASE_12_LEARNING.md)
- [Phase 13 — Cursor pagination](docs/PHASE_13_LEARNING.md)
