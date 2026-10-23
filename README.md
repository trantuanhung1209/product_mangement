# Product Catalog

Monorepo học FastAPI + React cho Product Catalog. Hiện tại chỉ hoàn thành **Phase 00 — Foundation**: một API health check và trang React kiểm tra kết nối thật tới API.

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
- `curl` (có sẵn trên macOS)

## Chạy trên macOS

1. Tạo file environment tại thư mục gốc:

   ```bash
   cp .env.example .env
   ```

2. Mở Terminal thứ nhất, chạy backend:

   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install --upgrade pip
   python -m pip install -e ".[dev]"
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

Xem [tài liệu Phase 00](docs/PHASE_00_FOUNDATION.md) để hiểu luồng và đối chiếu với NestJS.
