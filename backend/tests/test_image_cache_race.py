from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.endpoints import products as product_endpoints
from app.core.security import ACCESS_TOKEN_COOKIE, CSRF_TOKEN_COOKIE
from app.models import ImageCleanupTask, Product, UserRole
from app.services.image import delete_image, get_image, run_image_cleanup
from test_auth import (
    CSRF_HEADER,
    auth_database_url,
    auth_engine,
    auth_redis,
    client,
    create_product,
    create_user,
    csrf_headers,
    image_bytes,
    login,
    require_minio,
)

PRODUCTS = "/api/v1/products"


def admin_client(client: TestClient, engine) -> TestClient:
    email, password = create_user(engine, role=UserRole.ADMIN)
    login(client, email, password)
    return client


def jpeg_upload() -> dict:
    return {"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")}


@pytest.mark.database
def test_image_upload_and_delete_invalidate_cached_detail_and_list(client: TestClient, auth_engine) -> None:
    require_minio()
    product_id = create_product(auth_engine)
    admin_client(client, auth_engine)
    detail = f"{PRODUCTS}/{product_id}"
    assert client.get(detail).headers["x-cache"] == "MISS"
    assert client.get(detail).headers["x-cache"] == "HIT"
    assert client.get(PRODUCTS).headers["x-cache"] == "MISS"
    assert client.get(PRODUCTS).headers["x-cache"] == "HIT"

    uploaded = client.post(f"{detail}/image", headers=csrf_headers(client), files=jpeg_upload())
    assert uploaded.status_code == 200
    after_upload = client.get(detail)
    assert after_upload.headers["x-cache"] == "MISS"
    assert after_upload.json()["image_url"] == f"{detail}/image"
    assert client.get(PRODUCTS).headers["x-cache"] == "MISS"

    assert client.get(detail).headers["x-cache"] == "HIT"
    assert client.delete(f"{detail}/image", headers=csrf_headers(client)).status_code == 204
    after_delete = client.get(detail)
    assert after_delete.headers["x-cache"] == "MISS"
    assert after_delete.json()["image_url"] is None


@pytest.mark.database
def test_product_put_invalidates_cached_detail_and_list(client: TestClient, auth_engine) -> None:
    product_id = create_product(auth_engine)
    admin_client(client, auth_engine)
    detail = f"{PRODUCTS}/{product_id}"
    current = client.get(detail).json()
    assert client.get(detail).headers["x-cache"] == "HIT"
    assert client.get(PRODUCTS).headers["x-cache"] == "MISS"
    assert client.get(PRODUCTS).headers["x-cache"] == "HIT"

    body = {key: current[key] for key in ("name", "description", "price", "stock", "category_id", "image_url")}
    body["stock"] = 7
    assert client.put(detail, json=body, headers=csrf_headers(client)).status_code == 200

    assert client.get(detail).headers["x-cache"] == "MISS"
    assert client.get(detail).json()["stock"] == 7
    assert client.get(PRODUCTS).headers["x-cache"] == "MISS"


@pytest.mark.database
def test_concurrent_uploads_to_one_product_leave_exactly_one_object_and_no_orphan(
    client: TestClient, auth_engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    require_minio()
    product_id = create_product(auth_engine)
    admin_client(client, auth_engine)
    access, csrf = client.cookies.get(ACCESS_TOKEN_COOKIE), client.cookies.get(CSRF_TOKEN_COOKIE)
    assert access and csrf
    generated: list[str] = []
    original_upload = product_endpoints.upload_image

    def recording_upload(data: bytes) -> str:
        key = original_upload(data)
        generated.append(key)
        return key

    monkeypatch.setattr(product_endpoints, "upload_image", recording_upload)
    barrier = Barrier(3)

    def upload() -> int:
        with TestClient(client.app) as concurrent_client:
            concurrent_client.cookies.set(ACCESS_TOKEN_COOKIE, access, path="/")
            concurrent_client.cookies.set(CSRF_TOKEN_COOKIE, csrf, path="/")
            barrier.wait(timeout=10)
            return concurrent_client.post(
                f"{PRODUCTS}/{product_id}/image", headers={CSRF_HEADER: csrf}, files=jpeg_upload()
            ).status_code

    with ThreadPoolExecutor(max_workers=3) as executor:
        statuses = [future.result(timeout=30) for future in [executor.submit(upload) for _ in range(3)]]

    assert statuses == [200, 200, 200]
    assert len(generated) == len(set(generated)) == 3
    with Session(auth_engine) as session:
        final_key = session.get(Product, product_id).image_object_key
        assert final_key in generated
        run_image_cleanup(session)  # the periodic/manual retry the app relies on
        assert session.query(ImageCleanupTask).filter(ImageCleanupTask.object_key.in_(generated)).count() == 0
    try:
        assert get_image(final_key)
        for replaced in set(generated) - {final_key}:
            with pytest.raises(HTTPException, match="Image not found"):
                get_image(replaced)
    finally:
        delete_image(final_key)


@pytest.mark.database
def test_failed_upload_after_create_leaves_the_product_intact_and_a_retry_succeeds(client: TestClient, auth_engine) -> None:
    require_minio()
    admin_client(client, auth_engine)
    category = client.post("/api/v1/categories", json={"name": f"retry-{uuid4().hex}"}, headers=csrf_headers(client)).json()
    created = client.post(
        PRODUCTS,
        json={"name": f"retry-{uuid4().hex}", "price": "5.00", "stock": 1, "category_id": category["id"]},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    endpoint = f"{PRODUCTS}/{product_id}/image"

    bad = client.post(endpoint, headers=csrf_headers(client), files={"file": ("x.jpg", b"not-an-image", "image/jpeg")})
    assert bad.status_code == 422
    assert client.get(f"{PRODUCTS}/{product_id}").json()["image_url"] is None
    assert client.get(endpoint).status_code == 404

    good = client.post(endpoint, headers=csrf_headers(client), files=jpeg_upload())
    assert good.status_code == 200 and good.json()["id"] == product_id
    assert client.get(endpoint).headers["content-type"] == "image/webp"
    with Session(auth_engine) as session:
        key = session.get(Product, product_id).image_object_key
        assert session.query(ImageCleanupTask).filter_by(object_key=key).count() == 0
    delete_image(key)
