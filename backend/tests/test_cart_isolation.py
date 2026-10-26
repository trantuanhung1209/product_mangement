from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import ACCESS_TOKEN_COOKIE, CSRF_TOKEN_COOKIE
from app.models import Cart, CartItem
from test_auth import CSRF_HEADER, auth_database_url, auth_engine, auth_redis, client, csrf_headers
from test_cart import add_item, authenticate, create_product


def concurrent_requests(client: TestClient, calls: list[tuple[str, str, dict | None]]) -> list[int]:
    """Send every (method, path, json) at once, as the same logged-in user, from separate clients."""
    access = client.cookies.get(ACCESS_TOKEN_COOKIE)
    csrf = client.cookies.get(CSRF_TOKEN_COOKIE)
    assert access and csrf
    barrier = Barrier(len(calls))

    def send(method: str, path: str, body: dict | None) -> int:
        with TestClient(client.app) as concurrent_client:
            concurrent_client.cookies.set(ACCESS_TOKEN_COOKIE, access, path="/")
            concurrent_client.cookies.set(CSRF_TOKEN_COOKIE, csrf, path="/")
            barrier.wait(timeout=5)
            return concurrent_client.request(method, path, json=body, headers={CSRF_HEADER: csrf}).status_code

    with ThreadPoolExecutor(max_workers=len(calls)) as executor:
        futures = [executor.submit(send, *call) for call in calls]
        return [future.result(timeout=15) for future in futures]


def cart_rows(engine, user_id: int) -> dict[int, int]:
    with Session(engine) as db:
        cart = db.scalar(select(Cart).where(Cart.user_id == user_id))
        if cart is None:
            return {}
        return {item.product_id: item.quantity for item in db.scalars(select(CartItem).where(CartItem.cart_id == cart.id))}


@pytest.mark.database
def test_another_user_cannot_read_change_or_delete_a_cart_item(client: TestClient, auth_engine) -> None:
    owner_id = authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=5)
    assert add_item(client, product_id, 2).status_code == 201

    with TestClient(client.app) as intruder:
        intruder_id = authenticate(intruder, auth_engine)
        assert intruder.get("/api/v1/cart").json()["items"] == []
        assert intruder.patch(
            f"/api/v1/cart/items/{product_id}", json={"quantity": 5}, headers=csrf_headers(intruder)
        ).status_code == 404
        assert intruder.delete(f"/api/v1/cart/items/{product_id}", headers=csrf_headers(intruder)).status_code == 404
        assert intruder.delete("/api/v1/cart", headers=csrf_headers(intruder)).status_code == 204  # clears only their own (empty) cart
        assert add_item(intruder, product_id, 1).status_code == 201  # their own row, independent of the owner's

    assert cart_rows(auth_engine, owner_id) == {product_id: 2}
    assert cart_rows(auth_engine, intruder_id) == {product_id: 1}
    assert client.get("/api/v1/cart").json()["total_quantity"] == 2


@pytest.mark.database
def test_cart_response_never_exposes_another_users_data(client: TestClient, auth_engine) -> None:
    authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=5)
    assert add_item(client, product_id, 1).status_code == 201
    body = client.get("/api/v1/cart").text
    with TestClient(client.app) as other:
        authenticate(other, auth_engine)
        assert other.get("/api/v1/cart").text != body
        assert "user" not in other.get("/api/v1/cart").json()


@pytest.mark.database
def test_concurrent_quantity_updates_end_in_one_valid_value(client: TestClient, auth_engine) -> None:
    user_id = authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=5)
    assert add_item(client, product_id, 1).status_code == 201
    path = f"/api/v1/cart/items/{product_id}"

    statuses = concurrent_requests(client, [("PATCH", path, {"quantity": quantity}) for quantity in (2, 3, 4, 5)])

    assert statuses == [200, 200, 200, 200]
    rows = cart_rows(auth_engine, user_id)
    assert list(rows) == [product_id] and rows[product_id] in {2, 3, 4, 5}
    with Session(auth_engine) as db:
        assert db.scalar(select(func.count()).select_from(CartItem).join(Cart).where(Cart.user_id == user_id)) == 1


@pytest.mark.database
def test_concurrent_update_and_delete_never_errors_or_leaves_a_partial_row(client: TestClient, auth_engine) -> None:
    user_id = authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=5)
    assert add_item(client, product_id, 1).status_code == 201
    path = f"/api/v1/cart/items/{product_id}"

    statuses = concurrent_requests(client, [("PATCH", path, {"quantity": 3}), ("DELETE", path, None)])

    assert all(status in {200, 204, 404} for status in statuses), statuses
    rows = cart_rows(auth_engine, user_id)
    assert rows in ({}, {product_id: 3})


@pytest.mark.database
def test_concurrent_clear_and_add_leaves_a_consistent_cart(client: TestClient, auth_engine) -> None:
    user_id = authenticate(client, auth_engine)
    product_id = create_product(auth_engine, stock=5)
    assert add_item(client, product_id, 1).status_code == 201

    statuses = concurrent_requests(
        client, [("DELETE", "/api/v1/cart", None), ("POST", "/api/v1/cart/items", {"product_id": product_id, "quantity": 2})]
    )

    assert all(status in {201, 204} for status in statuses), statuses
    rows = cart_rows(auth_engine, user_id)
    assert rows in ({}, {product_id: 2}, {product_id: 3})
