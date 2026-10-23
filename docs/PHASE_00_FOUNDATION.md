# Phase 00 — Project Foundation

Tài liệu này bám trực tiếp vào code Phase 00, không chỉ là định nghĩa. Mục tiêu là chạy được một React app gọi FastAPI trước khi thêm bất kỳ Product/CRUD/database nào.

## 1. FastAPI là gì?

FastAPI là framework Python để tạo HTTP API. Bạn khai báo route bằng decorator và type hint Python; FastAPI dùng các thông tin đó để validate dữ liệu và tạo OpenAPI/Swagger.

Trong `backend/app/routers/health.py`, `@router.get("/health")` nghĩa là hàm phía dưới xử lý HTTP `GET /health`. `response_model=HealthResponse` nói rõ response có hai trường `status` và `service`. Khi chạy app, FastAPI tự sinh Swagger tại `/docs`.

So với NestJS, `@Get('health')` trên controller là ý tưởng tương đương. Khác biệt chính là FastAPI tận dụng type hint của Python và Pydantic, thay vì decorator/class TypeScript như NestJS.

Lỗi phổ biến: chạy `uvicorn main:app` từ sai thư mục nên import `app` thất bại. Hãy đứng trong `backend/` và dùng `uvicorn app.main:app --reload`. Kiểm tra bằng `curl http://localhost:8000/health` và mở `http://localhost:8000/docs`.

## 2. FastAPI khác NestJS ở đâu?

Hai framework cùng phục vụ web API nhưng cách tổ chức khác nhau:

| Chủ đề | FastAPI trong project này | NestJS quen thuộc |
|---|---|---|
| Route | `APIRouter` + `@router.get` | `@Controller` + `@Get` |
| DTO/schema | Pydantic `BaseModel` | class DTO + `class-validator` |
| Config | `pydantic-settings` | `@nestjs/config` |
| Server dev | Uvicorn | Node/Nest CLI |
| DI | có `Depends` khi cần | constructor injection mặc định |

Phase 00 chưa cần service hay dependency injection. Đừng tạo `HealthService` chỉ để trả về hai giá trị: hàm route hiện tại là đủ. Khi Phase sau có business logic, `Depends` có thể đóng vai trò gần với provider injection trong NestJS.

Lỗi phổ biến: mang nguyên cấu trúc module/service/controller của NestJS vào FastAPI khi chưa cần. Kiểm tra bằng cách mỗi file hiện có một trách nhiệm rõ ràng: config, schema hoặc route.

## 3. Python virtual environment là gì?

Virtual environment (`backend/.venv`) là một Python độc lập cho project. Các gói FastAPI cài trong đó không làm bẩn Python toàn máy và không xung đột phiên bản với project khác.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
```

Sau khi activate, `python` và `pip` sẽ dùng `.venv`. Đây tương đương gần nhất với `node_modules` + lockfile ở Node, dù cơ chế Python khác. `.venv/` được bỏ qua trong `.gitignore`; chỉ `pyproject.toml` là nguồn khai báo dependency.

Lỗi phổ biến: quên `source .venv/bin/activate` rồi cài package global. Kiểm tra `which python`; kết quả phải chứa `backend/.venv/bin/python`.

## 4. `pyproject.toml` làm gì?

`backend/pyproject.toml` là manifest chuẩn của Python. Nó khai báo Python tối thiểu (`>=3.11`), package chạy (`fastapi`, `pydantic-settings`, `uvicorn`) và nhóm dev (`pytest`, `httpx`). Lệnh `python -m pip install -e ".[dev]"` đọc đúng file này để cài nhất quán.

Vai trò của nó gần với `package.json`: metadata, dependency và script/config tool. Khác là Python có nhiều installer; ở project này dùng `pip` để không thêm công cụ quản lý dependency chưa cần thiết.

Lỗi phổ biến: cài một package bằng pip nhưng không thêm nó vào `pyproject.toml`, khiến máy khác không chạy được. Kiểm tra bằng cách tạo lại venv rồi chạy lệnh cài từ README.

## 5. Uvicorn hoạt động thế nào?

Uvicorn là ASGI server: nó nhận request HTTP, chuyển thành ASGI call cho `app` FastAPI trong `app.main`, rồi gửi response về browser/curl. Lệnh sau có nghĩa: import object `app` từ `app/main.py`; `--reload` tự khởi động lại server khi source đổi.

```bash
uvicorn app.main:app --reload
```

NestJS thường khởi tạo HTTP server qua Node runtime; Uvicorn là process server riêng chạy FastAPI. `--reload` chỉ phù hợp development, không dùng để vận hành production.

Lỗi phổ biến: port 8000 đã được dùng. Kiểm tra bằng `lsof -i :8000`, sau đó dừng process cũ hoặc chạy `--port 8001` và cập nhật `VITE_API_URL`.

## 6. Pydantic Settings giải quyết vấn đề gì?

`backend/app/core/config.py` tạo class `Settings(BaseSettings)`. Khi app khởi động, nó đọc `CORS_ORIGINS` từ file `.env` ở root. Không cần viết `os.getenv` rải rác và có type `list[str]` rõ ràng. Vì `.env` được dùng chung với Vite, `extra="ignore"` bỏ qua `VITE_API_URL` — biến đó thuộc frontend, không phải backend config.

```python
class Settings(BaseSettings):
    cors_origins: list[str] = ["http://localhost:5173"]
```

File `.env.example` là mẫu được commit; `.env` thật bị gitignore. Với field danh sách, Pydantic đọc JSON nên giá trị phải là `CORS_ORIGINS=["http://localhost:5173"]`.

Điều này gần với `ConfigService` của `@nestjs/config`, nhưng validation/parse được gắn trực tiếp với type của settings. Lỗi phổ biến: viết `CORS_ORIGINS=http://localhost:5173` (không phải JSON list). Kiểm tra bằng khởi động server; config không hợp lệ sẽ báo lỗi sớm.

## 7. Router FastAPI tương đương gì trong NestJS?

`APIRouter` trong `backend/app/routers/health.py` gom các endpoint liên quan. `app.include_router(health_router)` trong `main.py` đăng ký nó với application. Đây tương đương một controller được đưa vào `controllers` của Nest module.

Để thêm route sau này, tạo router theo feature rồi include nó một lần trong `main.py`. Không khai báo route trực tiếp trong `main.py` khi feature lớn lên.

Lỗi phổ biến: tạo router nhưng quên `include_router`, nên `/docs` không có endpoint. Kiểm tra `/docs` phải thấy tag `health` và `GET /health`.

## 8. Axios gọi FastAPI như thế nào?

`frontend/src/api.ts` tạo một Axios instance có `baseURL` đọc từ `VITE_API_URL`. `HomePage.tsx` gọi thật `await api.get("/health")`, không dùng mock. Khi thành công state là `success`; lỗi mạng/CORS/server đặt state là `error`.

```ts
await api.get("/health");
```

Nếu `VITE_API_URL=http://localhost:8000`, Axios tạo request `GET http://localhost:8000/health`. Đây giống `HttpService`/Axios trong NestJS client, nhưng đang chạy trong browser React.

Lỗi phổ biến: đổi `.env` khi Vite đang chạy nhưng không restart Vite. Kiểm tra Network tab của browser: request phải đi tới `http://localhost:8000/health` và nhận 200.

## 9. CORS là gì, tại sao frontend cần?

Browser coi `http://localhost:5173` và `http://localhost:8000` là hai origin khác nhau (khác port). CORS là cơ chế để API nói với browser rằng origin frontend được phép đọc response. Nó không phải authentication.

Trong `app/main.py`, `CORSMiddleware` dùng `settings.cors_origins`; source config là `.env`, không hardcode riêng trong middleware. Backend trả header `Access-Control-Allow-Origin` cho `http://localhost:5173`.

Lỗi phổ biến: thấy `curl` thành công rồi nghĩ browser cũng thành công. `curl` không áp dụng CORS. Kiểm tra preflight bằng:

```bash
curl -i -X OPTIONS http://localhost:8000/health \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET'
```

Response cần có `access-control-allow-origin: http://localhost:5173`.

## 10. Luồng HTTP từ React đến FastAPI

```text
HomePage mount / click button
        │
        ▼
api.get('/health') ── Axios baseURL from VITE_API_URL
        │
        ▼
Browser checks CORS ──► Uvicorn ──► FastAPI middleware
                                     │
                                     ▼
                              health router
                                     │
                                     ▼
                         HealthResponse JSON → browser
                                     │
                                     ▼
                    HomePage: success or error state
```

Khi mở Home, `useEffect` gọi `checkConnection`. Khi bấm nút, cùng hàm chạy lại; tránh hai luồng logic khác nhau. `loading` disable nút để ngăn request lặp trong lúc request trước chưa kết thúc.

Lỗi phổ biến: backend chưa chạy, URL sai, hoặc origin chưa nằm trong `CORS_ORIGINS`. Cách kiểm tra theo thứ tự: (1) `curl /health`, (2) preflight CORS ở trên, (3) mở frontend và kiểm tra Network/Console.
