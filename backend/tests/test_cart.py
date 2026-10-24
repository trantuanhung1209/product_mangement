from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.cache import get_redis
from app.core.security import ACCESS_TOKEN_COOKIE, CSRF_TOKEN_COOKIE
from app.models import Cart, CartItem, Category, Product
from test_auth import (
    CSRF_HEADER,
    auth_database_url,
    auth_engine,
    auth_redis,
    client,
    create_user,
    csrf_headers,
    login,
)


def create_product(engine, *, stock: int = 5, price: str = "12.50") -> int:
    with Session(engine) as db:
        category = Category(name=f"Cart-{uuid4().hex}")
        db.add(category)
        db.flush()
        product = Product(
            name=f"Cart product {uuid4().hex}", price=Decimal(price), stock=stock, category_id=category.id
        )
        db.add(product)
        db.commit()
        return product.id


def authenticate(test_client: TestClient, engine) -> int:
    email, password = create_user(engine)
    login(test_client, email, password)
    return int(test_client.get("/api/v1/auth/me").json()["id"])


def add_item(test_client: TestClient, product_id: int, quantity: int = 1):
    return test_client.post(
        "/api/v1/cart/items",
        json={"product_id": product_id, "quantity": quantity},
        headers=csrf_headers(test_client),
    )


def concurrent_add(client: TestClient, product_id: int, count: int = 2) -> list[int]:
    access = client.cookies.get(ACCESS_TOKEN_COOKIE)
    csrf = client.cookies.get(CSRF_TOKEN_COOKIE)
    assert access and csrf
    barrier = Barrier(count)

    def request() -> int:
        with TestClient(client.app) as concurrent_client:
            concurrent_client.cookies.set(ACCESS_TOKEN_COOKIE, access, path="/")
            concurrent_client.cookies.set(CSRF_TOKEN_COOKIE, csrf, path="/")
            barrier.wait(timeout=5)
            return concurrent_client.post(
                "/api/v1/cart/items",
                json={"product_id": product_id, "quantity": 1},
                headers={CSRF_HEADER: csrf},
            ).status_code

    with ThreadPoolExecutor(max_workers=count) as executor:
        futures = [executor.submit(request) for _ in range(count)]
        return [future.result(timeout=10) for future in futures]


@pytest.mark.database
def test_cart_crud_persistence_price_and_stock(client: TestClient, auth_engine) -> None:
    user_id = authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=5, price="12.50")

    assert client.get("/api/v1/cart").json() == {"items": [], "total_quantity": 0, "subtotal": "0"}
    assert add_item(client, product_id, 2).status_code == 201
    added = add_item(client, product_id, 1)
    assert added.status_code == 201
    assert added.json()["items"][0]["quantity"] == 3
    assert added.json()["subtotal"] == "37.50"

    updated = client.patch(
        f"/api/v1/cart/items/{product_id}", json={"quantity": 4}, headers=csrf_headers(client)
    )
    assert updated.status_code == 200
    assert updated.json()["items"][0]["line_total"] == "50.00"
    with Session(auth_engine) as db:
        product = db.get(Product, product_id)
        assert product is not None and product.stock == 5
        product.price = Decimal("20.00")
        db.commit()

    persisted = client.get("/api/v1/cart").json()
    assert persisted["items"][0]["unit_price"] == "20.00"
    assert persisted["subtotal"] == "80.00"
    with Session(auth_engine) as db:
        product = db.get(Product, product_id)
        assert product is not None
        product.stock = 2
        db.commit()
    unavailable = client.get("/api/v1/cart").json()["items"][0]
    assert unavailable["available_stock"] == 2
    assert unavailable["is_available"] is False
    assert client.patch(
        f"/api/v1/cart/items/{product_id}", json={"quantity": 3}, headers=csrf_headers(client)
    ).status_code == 409
    assert client.delete(f"/api/v1/cart/items/{product_id}", headers=csrf_headers(client)).status_code == 204
    assert client.delete(f"/api/v1/cart/items/{product_id}", headers=csrf_headers(client)).status_code == 404
    assert client.delete("/api/v1/cart", headers=csrf_headers(client)).status_code == 204
    assert client.get("/api/v1/cart").json()["items"] == []

    with Session(auth_engine) as db:
        cart = db.scalar(select(Cart).where(Cart.user_id == user_id))
        assert cart is not None
        assert db.scalar(select(func.count()).select_from(CartItem).where(CartItem.cart_id == cart.id)) == 0


@pytest.mark.database
def test_cart_validation_isolation_and_product_delete_cascade(client: TestClient, auth_engine) -> None:
    authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=2)

    for quantity in (0, -1, "one"):
        assert client.post(
            "/api/v1/cart/items", json={"product_id": product_id, "quantity": quantity}, headers=csrf_headers(client)
        ).status_code == 422
    assert add_item(client, product_id, 3).status_code == 409
    assert add_item(client, 999999999).status_code == 404
    assert client.patch(
        f"/api/v1/cart/items/{product_id}", json={"quantity": 1}, headers=csrf_headers(client)
    ).status_code == 404
    assert add_item(client, product_id).status_code == 201

    with TestClient(client.app) as other_client:
        authenticate(other_client, auth_engine)
        assert other_client.get("/api/v1/cart").json()["items"] == []
        assert add_item(other_client, product_id).status_code == 201

    with Session(auth_engine) as db:
        product = db.get(Product, product_id)
        assert product is not None
        db.delete(product)
        db.commit()
        assert db.scalar(
            select(func.count()).select_from(CartItem).where(CartItem.product_id == product_id)
        ) == 0


@pytest.mark.database
def test_cart_security_blacklist_revocation_and_redis_failure(client: TestClient, auth_engine) -> None:
    product_id = create_product(auth_engine)
    assert client.get("/api/v1/cart").status_code == 401
    authenticate(client, auth_engine)
    assert client.post("/api/v1/cart/items", json={"product_id": product_id, "quantity": 1}).status_code == 403
    assert client.post(
        "/api/v1/cart/items", json={"product_id": product_id, "quantity": 1}, headers={CSRF_HEADER: "bad"}
    ).status_code == 403
    assert client.post(
        "/api/v1/cart/items",
        json={"product_id": product_id, "quantity": 1},
        headers={**csrf_headers(client), "Origin": "http://evil.example"},
    ).status_code == 403

    assert client.post("/api/v1/auth/revoke-access", headers=csrf_headers(client)).status_code == 204
    assert client.get("/api/v1/cart").status_code == 401
    assert client.post("/api/v1/auth/refresh", headers=csrf_headers(client)).status_code == 204
    assert client.get("/api/v1/cart").status_code == 200
    assert client.post("/api/v1/auth/logout", headers=csrf_headers(client)).status_code == 204
    assert client.get("/api/v1/cart").status_code == 401

    authenticate(client, auth_engine)
    client.app.dependency_overrides[get_redis] = lambda: None
    assert client.get("/api/v1/cart").status_code == 503


@pytest.mark.database
def test_concurrent_cart_creation_and_existing_item_add(client: TestClient, auth_engine) -> None:
    user_id = authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=5)
    assert concurrent_add(client, product_id) == [201, 201]
    assert client.get("/api/v1/cart").json()["items"][0]["quantity"] == 2
    assert concurrent_add(client, product_id) == [201, 201]

    with Session(auth_engine) as db:
        cart = db.scalar(select(Cart).where(Cart.user_id == user_id))
        assert cart is not None
        assert db.scalar(select(func.count()).select_from(Cart).where(Cart.user_id == user_id)) == 1
        assert db.scalar(select(func.count()).select_from(CartItem).where(CartItem.cart_id == cart.id)) == 1
        assert db.scalar(select(CartItem.quantity).where(CartItem.cart_id == cart.id, CartItem.product_id == product_id)) == 4


@pytest.mark.database
def test_concurrent_add_near_stock_limit_and_different_products(client: TestClient, auth_engine) -> None:
    authenticate(client, auth_engine)
    limited_product_id = create_product(auth_engine, stock=3)
    assert add_item(client, limited_product_id, 2).status_code == 201
    assert sorted(concurrent_add(client, limited_product_id)) == [201, 409]
    assert client.get("/api/v1/cart").json()["items"][0]["quantity"] == 3

    first_product_id = create_product(auth_engine, stock=3)
    second_product_id = create_product(auth_engine, stock=3)
    access = client.cookies.get(ACCESS_TOKEN_COOKIE)
    csrf = client.cookies.get(CSRF_TOKEN_COOKIE)
    assert access and csrf
    barrier = Barrier(2)

    def add(product_id: int) -> int:
        with TestClient(client.app) as concurrent_client:
            concurrent_client.cookies.set(ACCESS_TOKEN_COOKIE, access, path="/")
            concurrent_client.cookies.set(CSRF_TOKEN_COOKIE, csrf, path="/")
            barrier.wait(timeout=5)
            return concurrent_client.post(
                "/api/v1/cart/items",
                json={"product_id": product_id, "quantity": 1},
                headers={CSRF_HEADER: csrf},
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(add, product_id) for product_id in (first_product_id, second_product_id)]
        assert [future.result(timeout=10) for future in futures] == [201, 201]
    quantities = {item["product_id"]: item["quantity"] for item in client.get("/api/v1/cart").json()["items"]}
    assert quantities[first_product_id] == quantities[second_product_id] == 1


@pytest.mark.database
def test_concurrent_product_mutation_leaves_no_orphan_cart_items(client: TestClient, auth_engine) -> None:
    authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=2)
    access = client.cookies.get(ACCESS_TOKEN_COOKIE)
    csrf = client.cookies.get(CSRF_TOKEN_COOKIE)
    assert access and csrf
    barrier = Barrier(2)

    def add() -> int:
        with TestClient(client.app) as concurrent_client:
            concurrent_client.cookies.set(ACCESS_TOKEN_COOKIE, access, path="/")
            concurrent_client.cookies.set(CSRF_TOKEN_COOKIE, csrf, path="/")
            barrier.wait(timeout=5)
            return concurrent_client.post(
                "/api/v1/cart/items",
                json={"product_id": product_id, "quantity": 1},
                headers={CSRF_HEADER: csrf},
            ).status_code

    def delete_product() -> None:
        barrier.wait(timeout=5)
        with Session(auth_engine) as db:
            db.execute(update(Product).where(Product.id == product_id).values(stock=1))
            product = db.get(Product, product_id)
            assert product is not None
            db.delete(product)
            db.commit()

    with ThreadPoolExecutor(max_workers=2) as executor:
        add_future = executor.submit(add)
        delete_future = executor.submit(delete_product)
        add_status = add_future.result(timeout=10)
        delete_future.result(timeout=10)

    assert add_status in {201, 404}
    with Session(auth_engine) as db:
        assert db.get(Product, product_id) is None
        assert db.scalar(select(func.count()).select_from(CartItem).where(CartItem.product_id == product_id)) == 0
