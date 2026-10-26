import pytest
from fastapi.testclient import TestClient
from redis import Redis

from app.core.cache import LIST_VERSION_KEY, get_redis
from app.core.config import get_settings
from test_cache import (
    PRODUCTS_URL,
    UnavailableRedis,
    cache_database_url,
    cache_engine,
    cache_redis,
    client,
    create_category,
    create_product,
    unique_prefix,
)

CURSOR_URL = f"{PRODUCTS_URL}/cursor"


def seed(client: TestClient, count: int = 3) -> tuple[str, int, list[dict]]:
    prefix = unique_prefix()
    category_id = create_category(client, prefix)
    products = [create_product(client, f"{prefix}-item-{index}", category_id) for index in range(count)]
    return prefix, category_id, products


def names(response) -> list[str]:
    return [item["name"] for item in response.json()["items"]]


@pytest.mark.database
def test_cursor_page_is_cached_per_filter_and_per_cursor(client: TestClient, cache_redis: Redis) -> None:
    prefix, _, products = seed(client)
    params = {"search": prefix, "limit": 2}

    first = client.get(CURSOR_URL, params=params)
    second = client.get(CURSOR_URL, params={"search": f"  {prefix}  ", "limit": 2})  # normalized like the offset list
    assert first.status_code == 200
    assert (first.headers["x-cache"], second.headers["x-cache"]) == ("MISS", "HIT")
    assert second.json() == first.json()
    assert names(first) == [products[2]["name"], products[1]["name"]]

    cursor = first.json()["next_cursor"]
    page_two = client.get(CURSOR_URL, params={**params, "cursor": cursor})
    page_two_again = client.get(CURSOR_URL, params={**params, "cursor": cursor})
    assert (page_two.headers["x-cache"], page_two_again.headers["x-cache"]) == ("MISS", "HIT")
    assert names(page_two) == [products[0]["name"]]
    assert page_two_again.json() == page_two.json()

    assert client.get(CURSOR_URL, params={"search": prefix, "limit": 3}).headers["x-cache"] == "MISS"
    keys = [key for key in cache_redis.scan_iter(match="product-catalog:products:list:*cursor*")]
    assert len(keys) == 3
    assert all(0 < cache_redis.ttl(key) <= 60 for key in keys)


@pytest.mark.database
def test_cursor_cache_does_not_collide_with_the_offset_list(client: TestClient) -> None:
    prefix, _, _ = seed(client)

    cursor_response = client.get(CURSOR_URL, params={"search": prefix})
    offset_response = client.get(PRODUCTS_URL, params={"search": prefix})
    assert cursor_response.headers["x-cache"] == "MISS"
    assert offset_response.headers["x-cache"] == "MISS"  # not served from the cursor entry
    assert "total" in offset_response.json() and "total" not in cursor_response.json()
    assert client.get(CURSOR_URL, params={"search": prefix}).headers["x-cache"] == "HIT"
    assert client.get(PRODUCTS_URL, params={"search": prefix}).headers["x-cache"] == "HIT"


@pytest.mark.database
def test_product_changes_invalidate_cached_cursor_pages(client: TestClient) -> None:
    prefix, category_id, products = seed(client, count=2)
    params = {"search": prefix}
    assert names(client.get(CURSOR_URL, params=params)) == [products[1]["name"], products[0]["name"]]
    assert client.get(CURSOR_URL, params=params).headers["x-cache"] == "HIT"

    created = create_product(client, f"{prefix}-new", category_id)
    after_create = client.get(CURSOR_URL, params=params)
    assert after_create.headers["x-cache"] == "MISS" and names(after_create)[0] == created["name"]

    assert client.patch(f"{PRODUCTS_URL}/{created['id']}", json={"stock": 9}).status_code == 200
    after_update = client.get(CURSOR_URL, params=params)
    assert after_update.headers["x-cache"] == "MISS" and after_update.json()["items"][0]["stock"] == 9

    assert client.put(
        f"{PRODUCTS_URL}/{products[0]['id']}",
        json={"name": f"{prefix}-renamed", "description": None, "price": "10.00", "stock": 1, "category_id": category_id, "image_url": None},
    ).status_code == 200
    after_put = client.get(CURSOR_URL, params=params)
    assert after_put.headers["x-cache"] == "MISS" and f"{prefix}-renamed" in names(after_put)

    assert client.delete(f"{PRODUCTS_URL}/{created['id']}").status_code == 204
    after_delete = client.get(CURSOR_URL, params=params)
    assert after_delete.headers["x-cache"] == "MISS" and created["name"] not in names(after_delete)


@pytest.mark.database
def test_failed_mutation_keeps_cached_cursor_page(client: TestClient) -> None:
    prefix, _, _ = seed(client, count=1)
    client.get(CURSOR_URL, params={"search": prefix})
    failed = client.post(
        PRODUCTS_URL, json={"name": f"{prefix}-x", "price": "10.00", "stock": 1, "category_id": 999999999}
    )
    assert failed.status_code == 404
    assert client.get(CURSOR_URL, params={"search": prefix}).headers["x-cache"] == "HIT"


@pytest.mark.database
def test_invalid_cursors_are_never_cached_or_served_from_a_valid_entry(client: TestClient, cache_redis: Redis) -> None:
    prefix, _, _ = seed(client)
    first = client.get(CURSOR_URL, params={"search": prefix, "limit": 1})
    cursor = first.json()["next_cursor"]
    assert client.get(CURSOR_URL, params={"search": prefix, "limit": 1, "cursor": cursor}).status_code == 200
    cached_keys = set(cache_redis.scan_iter(match="product-catalog:products:list:*cursor*"))

    for bad in (f"{cursor}x", "not-a-cursor"):
        assert client.get(CURSOR_URL, params={"search": prefix, "limit": 1, "cursor": bad}).status_code == 400
    # A cursor issued for one filter must not be accepted for another, even though it is cached for the first.
    assert client.get(CURSOR_URL, params={"search": prefix + "x", "limit": 1, "cursor": cursor}).status_code == 400
    assert client.get(CURSOR_URL, params={"search": prefix, "limit": 1, "cursor": cursor}).headers["x-cache"] == "HIT"
    assert set(cache_redis.scan_iter(match="product-catalog:products:list:*cursor*")) == cached_keys


@pytest.mark.database
def test_cursor_falls_back_to_the_database_when_redis_is_unavailable(client: TestClient) -> None:
    prefix, _, products = seed(client, count=2)
    client.app.dependency_overrides[get_redis] = UnavailableRedis

    response = client.get(CURSOR_URL, params={"search": prefix})

    assert response.status_code == 200
    assert response.headers["x-cache"] == "MISS"
    assert names(response) == [products[1]["name"], products[0]["name"]]


@pytest.mark.database
def test_search_rate_limit_still_applies_to_cached_cursor_pages(
    client: TestClient, cache_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    prefix, _, _ = seed(client, count=1)
    monkeypatch.setenv("RATE_LIMIT_PUBLIC_SEARCH_PER_MINUTE", "2")
    get_settings.cache_clear()
    statuses = [client.get(CURSOR_URL, params={"search": prefix}) for _ in range(3)]
    assert [response.status_code for response in statuses] == [200, 200, 429]
    assert statuses[1].headers["x-cache"] == "HIT"  # the second request was a hit, and still counted
    assert "retry-after" in statuses[2].headers
    get_settings.cache_clear()
