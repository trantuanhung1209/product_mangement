# Đề bài thực tập: Product Catalog (FastAPI + ReactJS)

## Mục tiêu

Xây dựng ứng dụng web quản lý sản phẩm, áp dụng: RESTful API, phân trang, cache Redis, Docker.

## Công nghệ bắt buộc

- **Backend:** Python 3.11+, FastAPI, SQLAlchemy, Pydantic, Alembic
- **Database / Cache:** PostgreSQL, Redis
- **Frontend:** ReactJS (Vite), React Router, Axios/Fetch
- **Đóng gói:** Docker, Docker Compose

## Yêu cầu Backend

### Models

- `Category`: id, name (unique), description, created_at
- `Product`: id, name, description, price, stock, category_id, image_url, created_at, updated_at

### API chuẩn REST (prefix `/api/v1`)

- **Products:** GET list, GET detail, POST, PUT, PATCH, DELETE
- **Categories:** GET list, POST, PUT, DELETE

### Phân trang

- `page` (mặc định 1), `page_size` (mặc định 10, tối đa 100)
- Response gồm: `items`, `total`, `page`, `page_size`, `total_pages`

### Tìm kiếm / lọc / sắp xếp

Kết hợp được với phân trang:

- `search`, `category_id`, `min_price`, `max_price`, `sort_by`, `order`

### Cache Redis

- Cache `GET /products` (key chứa đủ query params) và `GET /products/{id}`, TTL 60s
- Invalidate khi tạo / sửa / xóa
- Thể hiện rõ cache hit / miss (header hoặc log)

### Yêu cầu khác

- Validate bằng Pydantic (price > 0, stock >= 0, name không rỗng)
- Status code đúng chuẩn, lỗi trả JSON thống nhất
- Cấu hình qua `.env`, bật CORS, có Swagger `/docs`
- Cấu trúc thư mục: `routers/`, `models/`, `schemas/`, `services/`, `core/`
- Script seed ≥ 100 sản phẩm

## Yêu cầu Frontend

- **Trang danh sách** (bảng hoặc grid):
  - Tìm kiếm có debounce 500ms
  - Lọc theo danh mục và khoảng giá
  - Sắp xếp
  - Component phân trang (Trước/Sau, số trang, chọn page size)
  - Có trạng thái loading / empty / error
- **Trang chi tiết và form thêm/sửa** (validate phía client), modal xác nhận xóa, toast thông báo
- Giữ filter và page trên URL (query string)
- Dùng functional component + hooks, tách `api/` service và custom hook (`useProducts`, `useDebounce`)
- URL API cấu hình qua biến môi trường

## Yêu cầu Docker

- Dockerfile cho backend và frontend (frontend multi-stage build, serve bằng Nginx)
- `docker-compose.yml` gồm 4 service: `backend`, `frontend`, `postgres`, `redis`; có volume cho Postgres, `healthcheck`, `depends_on`
- Chỉ cần `docker compose up --build` là chạy toàn bộ hệ thống
- Có `.env.example` và `.dockerignore`

## Nâng cao (không bắt buộc)
- JWT auth (admin mới được thêm/sửa/xóa)
- Upload ảnh
- pytest
- Rate limiting
- Cursor-based pagination
- React Query / SWR

## Bàn giao

1. Source code trên GitHub (commit nhỏ, rõ ràng, dùng feature branch + Pull Request)
2. `README.md`: giới thiệu, cách chạy, danh sách API, sơ đồ ERD, ảnh chụp màn hình
