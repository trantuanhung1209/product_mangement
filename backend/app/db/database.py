import logging
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


logger = logging.getLogger("app.database")
settings = get_settings()
if settings.database_url is None:
    raise RuntimeError("DATABASE_URL must be configured before using the database.")

engine = create_engine(
    settings.database_url,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    logger.info("Database session opened")
    try:
        yield session
    except Exception:
        session.rollback()
        logger.info("Database session rolled back")
        raise
    finally:
        session.close()
        logger.info("Database session closed")
