import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from test_auth import SECRET, auth_database_url, auth_engine, auth_redis, client
from test_product_cursor import CURSOR_URL, create_products


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def first_cursor(client: TestClient, engine) -> tuple[str, str, list[int]]:
    prefix = f"tamper-{uuid4().hex}"
    _, ids = create_products(engine, count=4, prefix=prefix, created_at=datetime(2026, 1, 1, tzinfo=UTC))
    response = client.get(CURSOR_URL, params={"search": prefix, "limit": 2})
    assert response.status_code == 200
    return prefix, response.json()["next_cursor"], ids


@pytest.mark.database
def test_cursor_with_edited_payload_and_original_signature_is_rejected(client: TestClient, auth_engine) -> None:
    prefix, cursor, _ = first_cursor(client, auth_engine)
    payload_part, signature_part = cursor.split(".")
    values = json.loads(unb64(payload_part))
    values["id"] = values["id"] + 1000  # try to jump elsewhere in the list
    forged = f"{b64(json.dumps(values, separators=(',', ':'), sort_keys=True).encode())}.{signature_part}"

    response = client.get(CURSOR_URL, params={"search": prefix, "cursor": forged})

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid cursor."}


@pytest.mark.database
def test_cursor_with_signature_from_another_cursor_or_corrupted_signature_is_rejected(client: TestClient, auth_engine) -> None:
    prefix, cursor, _ = first_cursor(client, auth_engine)
    other_prefix, other_cursor, _ = first_cursor(client, auth_engine)
    payload_part, signature_part = cursor.split(".")
    swapped = f"{payload_part}.{other_cursor.split('.')[1]}"
    flipped = f"{payload_part}.{signature_part[:-2]}{'A' if signature_part[-2] != 'A' else 'B'}{signature_part[-1]}"

    for bad in (swapped, flipped, payload_part, f"{payload_part}.", f".{signature_part}", f"{cursor}.extra"):
        assert client.get(CURSOR_URL, params={"search": prefix, "cursor": bad}).status_code == 400, bad


@pytest.mark.database
def test_cursor_signed_with_the_jwt_secret_is_rejected_because_keys_are_separate(client: TestClient, auth_engine) -> None:
    prefix, cursor, _ = first_cursor(client, auth_engine)
    payload = unb64(cursor.split(".")[0])
    jwt_signed = f"{b64(payload)}.{b64(hmac.new(SECRET.encode(), payload, hashlib.sha256).digest())}"

    assert client.get(CURSOR_URL, params={"search": prefix, "cursor": jwt_signed}).status_code == 400
    assert client.get(CURSOR_URL, params={"search": prefix, "cursor": cursor}).status_code == 200


@pytest.mark.database
def test_valid_cursor_is_rejected_when_the_filter_it_was_issued_for_changes(client: TestClient, auth_engine) -> None:
    prefix, cursor, ids = first_cursor(client, auth_engine)

    assert client.get(CURSOR_URL, params={"search": prefix, "cursor": cursor, "limit": 1}).status_code == 200  # limit may change
    assert client.get(CURSOR_URL, params={"search": prefix + "x", "cursor": cursor}).status_code == 400
    assert client.get(CURSOR_URL, params={"search": prefix, "min_price": "11", "cursor": cursor}).status_code == 400
    assert client.get(CURSOR_URL, params={"cursor": cursor}).status_code == 400


@pytest.mark.database
def test_cursor_error_does_not_reveal_why_it_failed(client: TestClient, auth_engine) -> None:
    prefix, cursor, _ = first_cursor(client, auth_engine)
    payload_part, signature_part = cursor.split(".")
    values = json.loads(unb64(payload_part))
    values["id"] = "not-an-int"
    bodies = {
        client.get(CURSOR_URL, params={"search": prefix, "cursor": bad}).text
        for bad in (
            "garbage",
            f"{payload_part}.AAAA",
            f"{b64(json.dumps(values).encode())}.{signature_part}",
        )
    }
    assert bodies == {'{"detail":"Invalid cursor."}'}
