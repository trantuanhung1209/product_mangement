import logging
import os
from collections.abc import Generator
from datetime import UTC
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.exc import IntegrityError, TimeoutError
from sqlalchemy.orm import Session, sessionmaker

from app.models import Category, Product


logger = logging.getLogger("app.database.experiments")
logger.setLevel(logging.INFO)
BACKEND_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if url is None:
        pytest.skip("TEST_DATABASE_URL is required for database integration tests.")
    return url


@pytest.fixture(scope="session")
def migrated_engine(database_url: str):
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url, pool_size=2, max_overflow=0, pool_pre_ping=True)
    yield engine
    engine.dispose()


@pytest.fixture
def session(migrated_engine) -> Generator[Session, None, None]:
    database_session = Session(migrated_engine)
    try:
        yield database_session
    finally:
        database_session.rollback()
        database_session.close()


def unique_name(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex}"


@pytest.mark.database
def test_alembic_creates_catalog_tables(migrated_engine) -> None:
    table_names = set(inspect(migrated_engine).get_table_names())

    assert {"alembic_version", "categories", "products"}.issubset(table_names)


@pytest.mark.database
def test_category_name_is_unique(session: Session) -> None:
    name = unique_name("category")
    session.add(Category(name=name))
    session.commit()
    session.add(Category(name=name))

    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


@pytest.mark.database
def test_product_foreign_key_and_decimal_price(session: Session) -> None:
    category = Category(name=unique_name("category"))
    product = Product(
        name="Keyboard",
        price=Decimal("19.99"),
        stock=3,
        category=category,
    )
    session.add(product)
    session.commit()
    session.refresh(product)

    assert product.category is category
    assert category.products == [product]
    assert product.price == Decimal("19.99")
    assert product.created_at.tzinfo is UTC
    assert product.updated_at.tzinfo is UTC
    session.add(Product(name="Orphan", price=Decimal("1.00"), stock=1, category_id=999999999))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


@pytest.mark.database
def test_commit_persists_and_rollback_discards(migrated_engine, session: Session) -> None:
    committed_name = unique_name("committed")
    rolled_back_name = unique_name("rolled-back")
    session.add(Category(name=committed_name))
    session.commit()
    session.add(Category(name=rolled_back_name))
    session.rollback()

    with Session(migrated_engine) as verification_session:
        names = set(verification_session.scalars(select(Category.name)).all())

    logger.info("experiment=transaction committed=%s rolled_back=%s", committed_name in names, rolled_back_name in names)
    assert committed_name in names
    assert rolled_back_name not in names


@pytest.mark.database
def test_connection_pool_reuses_connection(database_url: str) -> None:
    engine = create_engine(database_url, pool_size=1, max_overflow=0)
    connection_creations = 0

    def count_new_connection(*_args: object) -> None:
        nonlocal connection_creations
        connection_creations += 1

    event.listen(engine, "connect", count_new_connection)
    try:
        with engine.connect() as first_connection:
            first_connection.execute(text("SELECT 1"))
        with engine.connect() as second_connection:
            second_connection.execute(text("SELECT 1"))
    finally:
        engine.dispose()

    logger.info("experiment=connection-pool connection_creations=%d", connection_creations)
    assert connection_creations == 1


@pytest.mark.database
def test_session_dependency_closes_connection(migrated_engine, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setenv("DATABASE_URL", str(migrated_engine.url))
    get_settings.cache_clear()
    from app.db import database

    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=migrated_engine))
    dependency = database.get_db()
    database_session = next(dependency)
    database_session.execute(text("SELECT 1"))
    dependency.close()

    logger.info("experiment=session-lifecycle checked_out=%d", migrated_engine.pool.checkedout())
    assert migrated_engine.pool.checkedout() == 0
    get_settings.cache_clear()


@pytest.mark.database
def test_connection_leak_exhausts_small_pool_but_cleanup_recovers(database_url: str) -> None:
    engine = create_engine(database_url, pool_size=1, max_overflow=0, pool_timeout=0.1)
    held_connection = engine.connect()
    try:
        held_connection.execute(text("SELECT 1"))
        with pytest.raises(TimeoutError):
            engine.connect()
    finally:
        held_connection.close()

    with engine.connect() as recovered_connection:
        recovered_connection.execute(text("SELECT 1"))
    logger.info("experiment=connection-leak recovered_after_close=true")
    engine.dispose()
