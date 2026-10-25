import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.models import Category, Product
from test_auth import SECRET, auth_database_url, auth_engine, auth_redis, client


CURSOR_URL = "/api/v1/products/cursor"


def create_products(engine, *, count: int, prefix: str, created_at: datetime, category_id: int | None = None) -> tuple[int, list[int]]:
    with Session(engine) as db:
        if category_id is None:
            category = Category(name=f"Cursor-{uuid4().hex}")
            db.add(category)
            db.flush()
            category_id = category.id
        products = [
            Product(
                name=f"{prefix}-{index}",
                price=Decimal("10.00") + index,
                stock=10,
                category_id=category_id,
                created_at=created_at,
                updated_at=created_at,
            )
            for index in range(count)
        ]
        db.add_all(products)
        db.commit()
        return category_id, [product.id for product in products]


def signed_cursor(values: dict[str, object]) -> str:
    payload = json.dumps(values, separators=(",", ":"), sort_keys=True).encode()
    signature = hmac.new(SECRET.encode(), payload, hashlib.sha256).digest()
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
    return f"{encode(payload)}.{encode(signature)}"


@pytest.mark.database
def test_cursor_pages_are_stable_for_equal_timestamps(client: TestClient, auth_engine) -> None:
    prefix = f"cursor-{uuid4().hex}"
    _, created_ids = create_products(auth_engine, count=5, prefix=prefix, created_at=datetime(2026, 1, 1, tzinfo=UTC))

    collected: list[int] = []
    cursor: str | None = None
    while True:
        params = {"search": prefix, "limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        response = client.get(CURSOR_URL, params=params)
        assert response.status_code == 200
        body = response.json()
        collected.extend(item["id"] for item in body["items"])
        if not body["has_more"]:
            assert body["next_cursor"] is None
            break
        cursor = body["next_cursor"]
        assert cursor is not None

    assert collected == list(reversed(created_ids))
    assert len(collected) == len(set(collected)) == 5
    assert "ix_products_created_at_id" in {index["name"] for index in inspect(auth_engine).get_indexes("products")}


@pytest.mark.database
def test_cursor_validation_filters_and_limits(client: TestClient, auth_engine) -> None:
    empty = client.get(CURSOR_URL, params={"search": f"empty-{uuid4().hex}"})
    assert empty.status_code == 200
    assert empty.json() == {"items": [], "next_cursor": None, "has_more": False}
    assert client.get(CURSOR_URL, params={"limit": 101}).status_code == 422

    prefix = f"cursor-filter-{uuid4().hex}"
    first_category, first_ids = create_products(
        auth_engine, count=2, prefix=prefix, created_at=datetime(2026, 1, 2, tzinfo=UTC)
    )
    second_category, _ = create_products(
        auth_engine, count=1, prefix=prefix, created_at=datetime(2026, 1, 2, tzinfo=UTC)
    )
    first = client.get(CURSOR_URL, params={"search": prefix, "category_id": first_category, "limit": 1})
    assert first.status_code == 200
    assert first.json()["items"][0]["id"] == first_ids[-1]
    price_filtered = client.get(
        CURSOR_URL,
        params={"search": prefix, "category_id": first_category, "min_price": "10.5", "max_price": "11"},
    )
    assert [item["id"] for item in price_filtered.json()["items"]] == [first_ids[-1]]
    cursor = first.json()["next_cursor"]
    assert cursor is not None
    assert client.get(CURSOR_URL, params={"search": prefix, "category_id": second_category, "cursor": cursor}).status_code == 400
    assert client.get(CURSOR_URL, params={"cursor": "not-a-cursor"}).status_code == 400
    assert client.get(CURSOR_URL, params={"cursor": f"{cursor}x"}).status_code == 400
    unsupported = signed_cursor({"v": 2, "created_at": datetime.now(UTC).isoformat(), "id": 1, "f": "0" * 64})
    assert client.get(CURSOR_URL, params={"cursor": unsupported}).status_code == 400
    assert client.get(CURSOR_URL, params={"search": prefix, "limit": 100}).status_code == 200


@pytest.mark.database
def test_cursor_handles_product_changes_without_duplicate(client: TestClient, auth_engine) -> None:
    prefix = f"cursor-change-{uuid4().hex}"
    created_at = datetime(2026, 1, 3, tzinfo=UTC)
    category_id, created_ids = create_products(auth_engine, count=3, prefix=prefix, created_at=created_at)
    first = client.get(CURSOR_URL, params={"search": prefix, "limit": 1})
    assert first.status_code == 200
    first_id = first.json()["items"][0]["id"]
    cursor = first.json()["next_cursor"]
    assert cursor is not None

    with Session(auth_engine) as db:
        db.delete(db.get(Product, created_ids[-2]))
        newest = Product(
            name=f"{prefix}-new", price=Decimal("99.00"), stock=1, category_id=category_id,
            created_at=created_at + timedelta(seconds=1), updated_at=created_at + timedelta(seconds=1),
        )
        db.add(newest)
        db.commit()
        newest_id = newest.id

    next_page = client.get(CURSOR_URL, params={"search": prefix, "limit": 10, "cursor": cursor})
    assert next_page.status_code == 200
    next_ids = [item["id"] for item in next_page.json()["items"]]
    assert first_id not in next_ids
    assert newest_id not in next_ids
