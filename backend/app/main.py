import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis import Redis
from redis.exceptions import RedisError

from app.api.router import router as api_router
from app.core.config import get_settings
from app.core.middleware import RequestLoggingMiddleware
from app.routers.health import router as health_router


logger = logging.getLogger("app.cache")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    redis: Redis | None = None
    if settings.redis_url is not None:
        redis = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=settings.redis_connect_timeout_seconds,
            socket_timeout=settings.redis_socket_timeout_seconds,
        )
        try:
            redis.ping()
        except RedisError as error:
            logger.warning("Redis unavailable at startup (%s)", type(error).__name__)
    app.state.redis = redis
    try:
        yield
    finally:
        if redis is not None:
            redis.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Product Catalog API", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestLoggingMiddleware)
    app.include_router(health_router)
    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
