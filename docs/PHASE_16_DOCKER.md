# Phase 16 — Docker và Nginx

## 1. Vì sao cần Docker?

Đến Phase 15, muốn chạy dự án phải cài tay: Python + venv, Node, rồi bật PostgreSQL,
Redis, MinIO bằng `infra/compose.yml`. Mỗi bước là một chỗ có thể lệch giữa máy này và
máy khác ("máy tôi chạy được"). Docker đóng gói **từng thành phần cùng môi trường chạy của
nó** thành một thứ chạy giống nhau ở mọi nơi.

Bốn khái niệm cần phân biệt:

| Khái niệm | Là gì | Ví dụ trong dự án |
| --- | --- | --- |
| **Image** | Bản đóng gói chỉ đọc: hệ điều hành tối giản + thư viện + code | `postgres:16-alpine`, image backend build từ `backend/Dockerfile` |
| **Container** | Một lần chạy của image (có thể xóa, tạo lại bất kỳ lúc nào) | `product-catalog-stack-backend-1` |
| **Volume** | Thư mục dữ liệu nằm **ngoài** container, sống lâu hơn container | `postgres-data`, `minio-data` |
| **Network** | Mạng ảo để các container nói chuyện với nhau | `product-catalog-stack_internal` |

Quy tắc quan trọng nhất: **container là đồ dùng một lần, dữ liệu thì không**. Xóa container
mất code đang chạy (build lại là có); xóa volume mất dữ liệu thật.

## 2. Hai chế độ chạy

| | Dev (từ trước Phase 16) | Full Docker (Phase 16) |
| --- | --- | --- |
| Compose | `infra/compose.yml`: chỉ PostgreSQL, Redis, MinIO | `docker-compose.yml` ở root: thêm backend, frontend + Nginx |
| Backend, frontend | chạy trên máy (`uvicorn --reload`, `npm run dev`) | chạy trong container |
| Biến môi trường | `.env` (host `localhost`) | `.env.docker` (host `postgres`, `redis`, `minio`) |
| Truy cập | frontend `:5173`, API `:8000` | tất cả qua Nginx `http://localhost:8080` |
| Dữ liệu | volume `product-catalog-*` | volume riêng của project `product-catalog-stack` |

Dev vẫn là chế độ để viết code (hot reload nhanh). Full Docker để chạy thử "giống
production" và kiểm tra những thứ chỉ xuất hiện khi có Nginx ở giữa (cookie, CSRF, IP client).
Hai chế độ không dùng chung dữ liệu và không tranh cổng: stack Docker chỉ mở `127.0.0.1:8080`.

## 3. Kiến trúc

```
trình duyệt ──► 127.0.0.1:8080 ──► Nginx (container "frontend", IP 172.28.0.10)
                                     ├─ /              file tĩnh của Vite (+ fallback về index.html)
                                     ├─ /api/, /health ──► backend:8000 (FastAPI)
                                     └─ (mạng nội bộ)  postgres:5432, redis:6379, minio:9000
```

Chỉ Nginx được publish ra máy host. PostgreSQL, Redis, MinIO và backend **không** có cổng
nào mở ra ngoài; chúng chỉ tồn tại trong mạng nội bộ của compose. Đây là cách giảm bề mặt
tấn công rẻ nhất: thứ gì không cần ai bên ngoài gọi thì đừng mở cổng.

## 4. Dockerfile của backend

File [`backend/Dockerfile`](../backend/Dockerfile), đọc từ trên xuống:

```dockerfile
FROM python:3.14-slim                      # image nền: Python có sẵn, bản "slim" nhỏ hơn
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.lock ./                  # (1) chỉ copy file khai báo dependency trước
RUN pip install -r requirements.lock       # (2) cài dependency

COPY alembic.ini ./                        # (3) rồi mới copy code
COPY migrations ./migrations
COPY app ./app
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

RUN useradd --system --uid 10001 --no-create-home appuser && chmod +x docker-entrypoint.sh
USER appuser                               # không chạy bằng root

HEALTHCHECK ... CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"
ENTRYPOINT ["./docker-entrypoint.sh"]
```

Những điểm đáng học:

- **Layer và cache.** Mỗi lệnh `COPY`/`RUN` tạo một layer; Docker dùng lại layer nếu đầu vào
  không đổi. Vì (1)–(2) đứng **trước** (3), sửa code Python không làm `pip install` chạy lại
  (chậm, tải mạng). Đảo thứ tự là mất cache mỗi lần sửa một dòng code.
- **`requirements.lock`, không phải `pyproject.toml`.** Lock ghi đúng phiên bản bộ test đã chạy
  (Phase 14B/15), nên image build hôm nay và sáu tháng sau cài cùng một bộ thư viện.
- **Non-root.** Nếu tiến trình bị khai thác, kẻ tấn công không có quyền root trong container.
- **`HEALTHCHECK`** cho Docker biết app thật sự trả lời, không chỉ "tiến trình còn sống". Compose
  dùng trạng thái này ở mục 7.
- **`.dockerignore`** (`backend/.dockerignore`) loại `.venv`, `.git`, `.env*`, `__pycache__`, `tests`
  khỏi "build context". Hai lý do: build nhanh hơn, và **`.env` không bao giờ lọt vào image**
  (image có thể bị chia sẻ; secret thì không).

### Entrypoint: migration và bucket trước khi nhận request

```sh
alembic -c alembic.ini upgrade head     # tạo/cập nhật bảng
python -m scripts.ensure_bucket         # tạo bucket MinIO nếu chưa có
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- `set -eu`: bước nào lỗi thì container dừng ngay, không chạy app trên database sai schema.
- `exec`: thay shell bằng uvicorn, để tín hiệu `SIGTERM` của `docker stop` đến thẳng uvicorn và
  nó tắt êm; không có `exec`, shell nhận tín hiệu và app bị giết cứng sau timeout.
- `--host 0.0.0.0`: trong container, `127.0.0.1` chỉ là "chính container đó". Muốn Nginx ở
  container khác gọi được, uvicorn phải lắng nghe trên mọi địa chỉ của container.
- `ensure_bucket` idempotent (chạy lại không sao). Backend vẫn có cơ chế tạo bucket "lười" khi
  upload; entrypoint chỉ làm sớm để lỗi MinIO lộ ra lúc khởi động chứ không phải lúc người dùng upload.
- Giới hạn: migration chạy mỗi lần container khởi động. Một replica thì ổn; nhiều replica khởi động
  cùng lúc sẽ tranh nhau chạy migration — khi đó cần một bước migrate riêng.

## 5. Dockerfile của frontend: multi-stage

```dockerfile
FROM node:22-alpine AS build            # giai đoạn 1: có Node để build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci                              # cài đúng theo lockfile
COPY . .
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build                       # ra thư mục dist/

FROM nginx:1.29-alpine                  # giai đoạn 2: image cuối chỉ có Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
```

Image cuối **không chứa Node, `node_modules` hay source**, chỉ có Nginx và vài file tĩnh. Nhỏ
hơn, ít thứ để bị tấn công hơn. `npm ci` (khác `npm install`) cài đúng lockfile và lỗi nếu lockfile
lệch `package.json`.

### Cấu hình lúc build, không phải lúc chạy

Vite **thay `import.meta.env.VITE_API_URL` bằng giá trị cụ thể ngay khi build**. Trình duyệt chỉ
nhận file JS đã "đóng cứng"; container Nginx không thể đổi nó khi chạy. Vì vậy `VITE_API_URL` là
`ARG` của bước build. Ta để **rỗng**, nghĩa là "gọi API cùng origin với trang": trình duyệt gửi
`/api/...` tới chính `localhost:8080`, nơi Nginx nhận và chuyển tiếp.

> **Bài học từ một lỗi thật.** `apiAssetUrl` dùng `api.defaults.baseURL ?? window.location.origin`.
> `??` chỉ thay cho `null`/`undefined`, còn chuỗi rỗng `""` thì không → `new URL(path, "")` ném
> lỗi và mọi ảnh sản phẩm hỏng. Đổi thành `||` (rỗng cũng rơi về origin của trang) là thay đổi
> duy nhất trong code production của phase này, có test `apiAssetUrl.test.ts`. Đã mutation-check:
> đổi lại `??` thì test fail.

## 6. Nginx: static, SPA và reverse proxy

File [`frontend/nginx.conf`](../frontend/nginx.conf) làm ba việc:

1. **Phục vụ file tĩnh.** `/assets/` là file Vite đặt tên theo hash nội dung, nên cho cache một
   năm (`immutable`); đổi code thì tên file đổi, trình duyệt tự tải bản mới.
2. **Fallback cho SPA.** `try_files $uri /index.html`: vào thẳng `/shop` hay `/register` không có
   file thật, Nginx trả `index.html` để React Router tự xử lý. `index.html` để `no-cache` để luôn
   trỏ tới bản JS mới nhất.
3. **Reverse proxy** `/api/` và `/health` sang `backend:8000`. `backend` là **tên service** — Docker
   có DNS nội bộ, nên container nói chuyện với nhau bằng tên, không cần biết IP.

Chi tiết nhỏ nhưng quan trọng:

- `client_max_body_size 6m`: mặc định Nginx chặn body > 1 MB, upload ảnh 5 MB sẽ nhận 413 trước
  khi tới backend.
- Header bảo mật của `/api` do backend đặt; Nginx chỉ đặt cho file tĩnh. Nếu đặt cả hai nơi, header
  bị lặp.
- Backend không có `/api/health` (chỉ `/health`), nên Nginx proxy `/health` thay vì đổi code backend.
- Đề bài yêu cầu Swagger, nên Nginx cũng proxy `/docs`, `/redoc` và `/openapi.json` sang backend (SPA không có
  route trùng tên). Trang Swagger tải CSS/JS từ CDN nên cần Internet khi mở. Khi triển khai thật nên tắt hoặc
  chặn các đường dẫn này.

## 7. docker-compose.yml

Compose mô tả cả hệ thống bằng một file. Các khái niệm chính:

**Health check và `depends_on`.** `depends_on` mặc định chỉ chờ container *được khởi động*, chưa
chắc PostgreSQL đã sẵn sàng nhận kết nối. Với điều kiện `service_healthy`, compose chờ healthcheck
báo OK:

```yaml
backend:
  depends_on:
    postgres: {condition: service_healthy}
    redis:    {condition: service_healthy}
    minio:    {condition: service_healthy}
frontend:
  depends_on:
    backend:  {condition: service_healthy}
```

Thứ tự khởi động thực tế: postgres/redis/minio → backend (migrate, tạo bucket, chạy) → Nginx.
Mỗi service có healthcheck riêng (`pg_isready`, `redis-cli ping`, `curl .../minio/health/live`, `/health`).

**Volume có tên.** `postgres-data`, `redis-data`, `minio-data`. Dữ liệu nằm trong volume nên
`docker compose down` (xóa container) không mất gì; `down -v` xóa cả volume — **không bao giờ chạy
trên môi trường có dữ liệu**. Project đặt `name: product-catalog-stack` để volume không trùng volume
của chế độ dev.

**Network và IP cố định.** Mạng `internal` có subnet `172.28.0.0/24`; Nginx có địa chỉ cố định
`172.28.0.10`. Lý do ở mục 9: backend phải biết chính xác IP của proxy nó tin.

**Cổng.** Chỉ `frontend` có `ports: ["127.0.0.1:8080:80"]`. Phần `127.0.0.1:` nghĩa là chỉ máy
này truy cập được; bỏ nó đi thì cả mạng LAN thấy được.

**`restart: unless-stopped`**: container tự dựng lại nếu tiến trình chết, trừ khi chính bạn dừng nó.

## 8. Biến môi trường và secret

Compose có **hai cơ chế khác nhau** dễ nhầm:

| | Dùng để | Ví dụ |
| --- | --- | --- |
| `env_file: .env.docker` (trong service) | Đưa biến **vào container** | `DATABASE_URL`, `JWT_SECRET_KEY` |
| `--env-file .env.docker` (dòng lệnh) | Điền `${...}` trong **chính file compose** | `${WEB_PORT:-8080}`, `${MINIO_IMAGE}` |

Không có `--env-file`, compose đọc `.env` ở root — chính là file của chế độ dev. Vì vậy mọi lệnh đều
ghi rõ `--env-file .env.docker`.

Điểm khác với `.env` dev: hostname là tên service (`postgres`, `redis`, `minio:9000`), không phải
`localhost` — trong container, `localhost` là chính nó.

| Biến | Ý nghĩa |
| --- | --- |
| `POSTGRES_*`, `MINIO_ROOT_*` | Khởi tạo hai container; `DATABASE_URL` và `MINIO_*` của API phải dùng cùng mật khẩu |
| `TRUSTED_PROXY_IPS=["172.28.0.10"]` | Địa chỉ Nginx (mục 9) |
| `CORS_ORIGINS=["http://localhost:8080"]` | Origin mà trình duyệt thấy |
| `JWT_COOKIE_SECURE=false` | Chạy HTTP local; phải `true` sau HTTPS |
| `WEB_PORT`, `MINIO_IMAGE` (tùy chọn) | Cổng Nginx; đổi image MinIO sang `-amd64` trên máy Intel/Linux |
| `APP_ENV=production` | Có từ Phase 17: trong Docker, thiếu `RESEND_API_KEY` thì đăng ký trả 503 thay vì chạy giả |

Về secret:

- `.env.docker` bị git ignore; chỉ `.env.docker.example` (placeholder) được commit.
- Secret đưa vào lúc **chạy**, không nằm trong image (nhờ `.dockerignore`).
- **`docker compose config` in ra giá trị thật của secret** (nó nhúng cả `env_file`). Khi cần kiểm
  tra cú pháp hãy chuyển output đi (`> /dev/null`), đừng dán vào chat hay log CI.
- Mật khẩu nên là hex (`openssl rand -hex 24`) vì nó nằm trong `DATABASE_URL`; ký tự như `@` hay `/`
  sẽ làm hỏng URL.

## 9. Cookie, CSRF và CORS khi có proxy

Trình duyệt chỉ nói chuyện với `localhost:8080`, nên trang và API **cùng origin**:

- **CORS** thực tế không còn tác dụng (không có request cross-origin); `CORS_ORIGINS` vẫn đặt đúng
  vì backend dùng danh sách này cho kiểm tra `Origin` ở các endpoint không có phiên.
- **Cookie `HttpOnly`** vẫn được trình duyệt lưu và gửi; Nginx chuyển nguyên `Set-Cookie`. Cookie
  refresh có `Path=/api/v1/auth/refresh` nên chỉ gửi tới đúng endpoint đó.
- **CSRF**: JS đọc cookie `csrf_token` (không HttpOnly) và gắn vào header `X-CSRF-Token`; request qua
  Nginx giữ nguyên header, nên cơ chế hoạt động như dev.
- **`Secure`**: cờ này chỉ gửi cookie qua HTTPS. Stack này là HTTP nên để `false`; khi có HTTPS phải
  bật `JWT_COOKIE_SECURE=true`.

### Trusted proxy: để rate limit đếm đúng người

Rate limit (Phase 12) đếm theo IP client. Khi có proxy, IP kết nối tới backend luôn là IP của Nginx,
nên nếu backend không biết điều đó thì **mọi người dùng chung một bộ đếm**. Giải pháp hai vế:

1. Nginx đặt `X-Forwarded-For` bằng `$remote_addr` (**ghi đè**, không nối thêm). Nếu nối thêm, kẻ
   tấn công tự gửi `X-Forwarded-For: 1.2.3.4` và đổi "danh tính" mỗi request để né giới hạn.
2. Backend chỉ tin header đó khi IP kết nối nằm trong `TRUSTED_PROXY_IPS`. Vì IP Nginx phải biết
   trước, compose gán `172.28.0.10` cố định.

Kiểm chứng thật: gửi 7 lần login sai, mỗi lần giả một `X-Forwarded-For` khác → request thứ 5 vẫn
nhận 429, vậy giả mạo không né được. Tiếp đó, khóa Redis của bộ đếm trùng với HMAC của IP client
(`172.28.0.1`), không trùng IP Nginx. Trên Docker Desktop (macOS) mọi request từ máy bạn hiện ra là
gateway `172.28.0.1` do NAT; trên Linux sẽ là IP thật.

## 10. Cách chạy và kiểm tra

```bash
cp .env.docker.example .env.docker           # thay mọi <...> bằng secret (openssl rand -hex ...)
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker ps     # đợi tất cả "healthy"
curl http://localhost:8080/health            # {"status":"ok",...}
# tạo admin: xem README (cần terminal tương tác để nhập mật khẩu)
docker compose --env-file .env.docker down   # dừng, GIỮ dữ liệu (không dùng -v)
```

Kết quả đã kiểm tra:

| Kiểm tra | Kết quả |
| --- | --- |
| `docker compose config` hợp lệ | PASS |
| 5 service lên `healthy`, backend tự migrate và tạo bucket | PASS |
| `/health` qua Nginx 200; `/shop` (fallback SPA) 200 | PASS |
| Login: cookie `HttpOnly`; mutation thiếu CSRF bị 403 | PASS |
| Tạo sản phẩm, upload ảnh (lưu WebP), xem ảnh qua `/api/v1/products/{id}/image` | PASS |
| Giả `X-Forwarded-For` không né được rate limit | PASS |
| `down` rồi `up` lại: sản phẩm, ảnh, tài khoản còn nguyên | PASS |
| `pytest`, `npm test`, `typecheck`, `build` ở chế độ dev vẫn qua | PASS |
| Chạy trên trình duyệt thật | NOT RUN (kiểm tra bằng `curl`) |

## 10b. Chạy các script quản trị trong container

Thư mục `backend/scripts/` đã được `COPY` vào image, nên các script chạy bằng `docker compose exec`
(chạy thêm một tiến trình **trong container đang chạy**, dùng đúng biến môi trường và mạng của nó, nên
`postgres`, `minio` phân giải được). Không cần cài Python hay mở cổng database ra máy host.

```bash
dc="docker compose --env-file .env.docker"
$dc exec backend python -m scripts.seed                         # dữ liệu mẫu
$dc exec backend python -m scripts.cleanup_orphan_images --dry-run
$dc exec -it backend python -m scripts.create_admin admin@example.com
```

| Script | Việc | Đã chạy thử trong Docker |
| --- | --- | --- |
| `seed` | 10 danh mục, 100 sản phẩm; chạy lại không thêm gì (idempotent) | Lần 1 thêm 10/100, lần 2 thêm 0/0 |
| `create_admin` | Tạo tài khoản ADMIN, hỏi mật khẩu hai lần | Tạo được; thấy cảnh báo khi không có terminal |
| `cleanup_orphan_images` | Dọn ảnh MinIO không còn sản phẩm tham chiếu; `--dry-run` chỉ đếm | `--dry-run` chạy, 0 object |

Cần lưu ý:

- **`-it` cho `create_admin`.** Script dùng `getpass` để không hiện mật khẩu khi gõ. Không có terminal
  (`-T`, hoặc chạy từ CI/pipe) nó vẫn chạy nhưng in `Password input may be echoed` và đọc mật khẩu từ
  stdin; chỉ nên làm vậy khi tự động hóa có chủ đích, và không đưa mật khẩu lên dòng lệnh.
- **Dữ liệu đi vào volume của stack.** Script ghi vào PostgreSQL/MinIO **của stack Docker**, không đụng
  database dev. `down` giữ lại dữ liệu này; chỉ `down -v` mới xóa.
- **Seed không có ảnh.** Sản phẩm mẫu không có ảnh; ảnh chỉ có khi upload qua API.
- **`create_admin` không áp quy tắc mật khẩu của Phase 17/18** (chỉ cần khác rỗng, hai lần khớp), vì
  nó gọi thẳng service. Hãy tự đặt mật khẩu đủ mạnh.
- **Migration không nằm ở đây:** nó chạy tự động ở entrypoint mỗi lần backend khởi động.
- Nên dùng `exec` (vào container đang chạy). `run` sẽ tạo container mới và, vì có `ENTRYPOINT`, lại chạy
  migration rồi mở uvicorn thay vì chạy script.

## 11. Gỡ lỗi thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xem |
| --- | --- | --- |
| Backend restart liên tục | Thiếu/ sai secret, `DATABASE_URL` sai host | `docker compose logs backend` |
| Backend báo "Security configuration…" | Secret < 32 ký tự, trùng nhau, hoặc còn placeholder | đọc tên biến trong thông báo (giá trị không bị in) |
| `up` treo ở "Waiting" | Một healthcheck chưa qua | `docker compose ps`, rồi `logs <service>` |
| Upload ảnh 413 | Body vượt `client_max_body_size` của Nginx | kiểm tra `nginx.conf` |
| Ảnh sản phẩm hỏng, console báo `Invalid URL` | `VITE_API_URL=""` với bản cũ dùng `??` | đã sửa bằng `\|\|` |
| Mọi người bị 429 cùng lúc | `TRUSTED_PROXY_IPS` không khớp IP Nginx → mọi request mang IP proxy | so IP trong compose với biến |
| `run backend python -m scripts.x` lại mở uvicorn | `ENTRYPOINT` luôn chạy trước; dùng `exec` vào container đang chạy | mục 10b |
| Sửa code mà container không đổi | Chưa build lại image | `up --build -d` |
| Mất sạch dữ liệu | Đã chạy `down -v` | volume bị xóa; khôi phục từ backup (hiện chưa có) |

## 12. Giới hạn và việc chưa làm

- **Chưa có HTTPS.** Cookie `Secure` và HSTS đang tắt; cần TLS ở lớp ngoài (load balancer hoặc proxy
  có chứng chỉ) trước khi dùng thật.
- **Chưa có backup volume.** Dữ liệu chỉ nằm trong volume Docker; cần `pg_dump` và sao chép bucket
  MinIO nếu muốn an toàn.
- **Redis không có mật khẩu** (chỉ ở mạng nội bộ, không publish).
- **Image MinIO là `firstfinger/minio`** (cộng đồng, cùng image với dev); `minio/minio` chính thức
  không còn pull được. Mặc định bản ARM, Intel/Linux đổi `MINIO_IMAGE`.
- **Một process uvicorn**, không `--workers`; migration chạy ở entrypoint nên chưa phù hợp nhiều replica.
- **CSP cho frontend** vẫn chưa làm (README đã ghi sẽ thiết kế riêng).
- **Chưa có CI** build image tự động.

## 13. Thử tự làm

1. Sửa một dòng trong `backend/app/main.py`, chạy `docker compose ... up --build -d` và quan sát
   log build: bước nào được dùng lại từ cache (`CACHED`), bước nào chạy lại? Sau đó thử sửa
   `requirements.lock` và so sánh.
2. Đổi `TRUSTED_PROXY_IPS` thành `[]` rồi gửi 6 request login từ hai `X-Forwarded-For` khác nhau.
   Rate limit đếm theo IP nào? Vì sao?
3. Chạy `docker compose ... down`, rồi `up -d` lại (không build): vì sao dữ liệu còn? Khi nào nó mất?
4. Dùng `docker compose ... exec backend python -c "import os;print(sorted(k for k in os.environ if 'KEY' in k))"`
   để xem backend nhận những biến nào (chỉ tên, không in giá trị).
