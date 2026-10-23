# Product Catalog

Monorepo học FastAPI + React cho Product Catalog. Hiện tại đã hoàn thành foundation, database và REST API v1.

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
- PostgreSQL đang chạy với database được cấu hình trong `DATABASE_URL`
- `curl` (có sẵn trên macOS)

## Chạy trên macOS

1. Tạo file environment tại thư mục gốc:

   ```bash
   cp .env.example .env
   ```

   Cập nhật `DATABASE_URL` trong `.env` bằng thông tin PostgreSQL local trước khi chạy migration.

2. Mở Terminal thứ nhất, chạy backend:

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

3. Mở Terminal thứ hai, chạy frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   Mở URL Vite in ra (mặc định `http://localhost:5173`). Trang Home tự gọi `GET /health`; nút **Kiểm tra lại kết nối** gọi lại API.

## Kiểm tra nhanh

```bash
curl http://localhost:8000/health
```

Kết quả mong đợi:

```json
{"status":"ok","service":"product-catalog-api"}
```

## Tài liệu học

- [Phase 00 — Foundation](docs/PHASE_00_FOUNDATION.md)
- [Phase 00B — Request lifecycle](docs/PHASE_00B_LEARNING.md)
- [Phase 01 — Database](docs/PHASE_01_LEARNING.md)
- [Phase 02 — REST API](docs/PHASE_02_LEARNING.md)
- [Phase 03 — Product query](docs/PHASE_03_LEARNING.md)
- [Phase 04 — Redis caching](docs/PHASE_04_LEARNING.md)
