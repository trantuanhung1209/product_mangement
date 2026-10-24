from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "product-catalog-api"
    cors_origins: list[str] = ["http://localhost:5173"]
    database_url: str | None = None
    database_pool_size: int = 5
    database_max_overflow: int = 10
    redis_url: str | None = None
    redis_connect_timeout_seconds: float = 1.0
    redis_socket_timeout_seconds: float = 1.0
    minio_endpoint: str | None = None
    minio_access_key: str | None = None
    minio_secret_key: str | None = None
    minio_bucket: str = "product-images"
    minio_secure: bool = False
    jwt_secret_key: str | None = None
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 7
    jwt_cookie_secure: bool = False

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
