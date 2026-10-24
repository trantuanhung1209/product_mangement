# Product Catalog

Monorepo học FastAPI + React cho Product Catalog. Hiện tại có REST API, truy vấn sản phẩm, Redis cache và giao diện danh sách sản phẩm.

## Cấu trúc

```text
product-catalog/
├── backend/       # FastAPI, cấu hình bằng Pydantic Settings
├── frontend/      # React + Vite + TypeScript
├── docs/          # Tài liệu học và báo cáo phase
└── .env.example   # Biến môi trường dùng chung
```

## Yêu cầu

- macOS với Python 3.11+ và Node.js 20+
- Docker Desktop đang chạy (để chạy PostgreSQL và Redis local)
- `curl` (có sẵn trên macOS)

## Chạy trên macOS

### 1. Tạo PostgreSQL và Redis local

Chỉ chạy các lệnh `docker run` này một lần. PostgreSQL dùng named volume nên dữ liệu được giữ lại khi container dừng.

```bash
docker run -d \
  --name product-catalog-postgres \
  -e POSTGRES_USER=product_catalog \
  -e POSTGRES_PASSWORD=product_catalog_dev \
  -e POSTGRES_DB=product_catalog \
  -p 5432:5432 \
  -v product-catalog-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine

docker run -d \
  --name product-catalog-redis \
  -p 6379:6379 \
  redis:7-alpine
```

Ở những lần sau, chỉ cần khởi động lại:

```bash
docker start product-catalog-postgres product-catalog-redis
```

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

JWT_SECRET_KEY=generate_a_random_32_byte_secret
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
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

### Đăng nhập quản trị

Tạo secret local một lần bằng `openssl rand -hex 32`, gán vào `JWT_SECRET_KEY`
trong `.env`, rồi restart backend. Tạo Admin không cần hardcode mật khẩu:

```bash
cd backend
source .venv/bin/activate
python -m scripts.create_admin admin@example.com
```

Lệnh sẽ yêu cầu nhập mật khẩu hai lần. Đăng nhập tại `/login`; access token được
lưu trong HttpOnly cookie, không lưu ở localStorage. Khi deploy HTTPS, đặt
`JWT_COOKIE_SECURE=true`.

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
```

`TEST_REDIS_URL` dùng Redis database số 15; cache tests chỉ flush database này,
không đụng Redis development database số 0. Frontend hiện không có test runner;
kiểm tra tối thiểu là:

```bash
cd frontend
npm run typecheck
npm run build
```

## Chạy toàn bộ local

1. Khởi động PostgreSQL/Redis bằng `docker start` ở bước 1.
2. Chạy `alembic -c alembic.ini upgrade head`, rồi `uvicorn app.main:app --reload`.
3. Chạy `python -m scripts.seed` nếu cần dữ liệu mẫu.
4. Chạy `npm run dev` trong `frontend`.

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
