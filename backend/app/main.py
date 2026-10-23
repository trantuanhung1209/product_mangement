import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router as api_router
from app.core.config import get_settings
from app.core.middleware import LifecycleMiddleware, TimingMiddleware
from app.routers.health import router as health_router
from app.routers.lab import router as lab_router


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.enable_lab_routes:
        logging.basicConfig(level=logging.INFO)
    app = FastAPI(title="Product Catalog API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(LifecycleMiddleware)
    app.add_middleware(TimingMiddleware)
    app.include_router(health_router)
    app.include_router(api_router, prefix="/api")
    if settings.enable_lab_routes:
        app.include_router(lab_router)
    return app


app = create_app()
