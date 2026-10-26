import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from redis import Redis
from redis.exceptions import RedisError

from app.api.router import router as api_router
from app.core.config import get_settings, validate_security_configuration
from app.core.middleware import RequestLoggingMiddleware, SecurityHeadersMiddleware
from app.routers.health import router as health_router


logger = logging.getLogger("app.cache")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    validate_security_configuration(settings)
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


async def validation_error_handler(_: Request, error: RequestValidationError) -> JSONResponse:
    # FastAPI echoes the submitted value in "input"; it can be a password or token, so drop it.
    issues = [{key: value for key, value in issue.items() if key != "input"} for issue in error.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(issues)})


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Product Catalog API", lifespan=lifespan)
    app.add_exception_handler(RequestValidationError, validation_error_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.include_router(health_router)
    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
