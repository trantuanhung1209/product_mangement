# Khái niệm Phase 00B

## Phiên bản đã kiểm tra

| Package | Version |
|---|---:|
| FastAPI | 0.161.1 |
| Starlette | 1.9.0 |
| Uvicorn | 0.54.0 |
| Pydantic | 2.14.1 |

FastAPI là lớp khai báo API: route `@router.post`, dependency và schema Pydantic. Starlette cung cấp ASGI application, `Request`, middleware và exception middleware. Uvicorn là HTTP/ASGI server; Pydantic kiểm tra `InventoryInput` trong `backend/app/schemas/lab.py`.

Đối chiếu NestJS/Spring Boot: FastAPI router gần Controller, Pydantic model gần DTO + validation pipe / `@Valid`, ASGI middleware gần Nest middleware hoặc Servlet filter. Khác quan trọng: ASGI là async callable `(scope, receive, send)`, không phải chuỗi đối tượng request/response đồng bộ.

Lab này chỉ có khi `ENABLE_LAB_ROUTES=true`; code default là `false` trong `Settings`. Vì vậy endpoint học tập không được đăng ký khi chạy production với config mặc định.

Kiểm tra version lại bằng:

```bash
backend/.venv/bin/python -c 'import fastapi,starlette,uvicorn,pydantic; print(fastapi.__version__, starlette.__version__, uvicorn.__version__, pydantic.__version__)'
```
