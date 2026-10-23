import logging

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app


@pytest.fixture
def lab_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("ENABLE_LAB_ROUTES", "true")
    get_settings.cache_clear()
    client = TestClient(create_app())
    yield client
    get_settings.cache_clear()


def test_lab_routes_are_disabled_when_configuration_is_false(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENABLE_LAB_ROUTES", "false")
    get_settings.cache_clear()

    app = create_app()

    assert "/lab/success" not in {getattr(route, "path", None) for route in app.routes}
    get_settings.cache_clear()


def lifecycle_messages(caplog: pytest.LogCaptureFixture, path: str) -> list[str]:
    return [record.getMessage() for record in caplog.records if f"path={path}" in record.getMessage()]


def test_success_has_request_observability_and_verified_middleware_order(
    lab_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="app.lifecycle")

    response = lab_client.get("/lab/success")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["x-request-id"]
    assert float(response.headers["x-process-time-ms"]) >= 0
    messages = [record.getMessage() for record in caplog.records]
    assert [message.split(" method=")[0] for message in messages] == [
        "A before",
        "B before",
        "Endpoint: success",
        "B after",
        "A after",
    ]


def test_http_exception_is_handled_and_middleware_observes_response(
    lab_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="app.lifecycle")

    response = lab_client.get("/lab/http-error")

    assert response.status_code == 404
    assert response.json() == {"detail": "Lab resource not found"}
    assert response.headers["x-request-id"]
    assert "B after method=GET path=/lab/http-error" in lifecycle_messages(caplog, "/lab/http-error")[-2]


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "", "price": 0, "stock": -1},
        "not-json",
    ],
)
def test_validation_returns_422_before_endpoint(
    lab_client: TestClient, caplog: pytest.LogCaptureFixture, payload: dict[str, object] | str
) -> None:
    caplog.set_level(logging.INFO, logger="app.lifecycle")
    request = lab_client.post("/lab/validate", json=payload) if isinstance(payload, dict) else lab_client.post(
        "/lab/validate", content=payload, headers={"content-type": "application/json"}
    )

    assert request.status_code == 422
    assert request.headers["content-type"].startswith("application/json")
    assert request.headers["x-request-id"]
    messages = lifecycle_messages(caplog, "/lab/validate")
    assert not any(message.startswith("Endpoint: validate") for message in messages)
    assert messages[-2].startswith("B after")
    assert messages[-1].startswith("A after")


def test_unhandled_exception_is_reraised_by_default(lab_client: TestClient) -> None:
    with pytest.raises(RuntimeError, match="Lab unhandled exception"):
        lab_client.get("/lab/unhandled-error")


def test_unhandled_exception_can_be_observed_as_500(
    lab_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="app.lifecycle")
    client = TestClient(lab_client.app, raise_server_exceptions=False)

    response = client.get("/lab/unhandled-error")

    assert response.status_code == 500
    assert response.text == "Internal Server Error"
    assert response.headers["content-type"].startswith("text/plain")
    assert "x-process-time-ms" not in response.headers
    messages = lifecycle_messages(caplog, "/lab/unhandled-error")
    assert any(message.startswith("B exception") for message in messages)
    assert any(message.startswith("A exception") for message in messages)
    assert not any(message.startswith("B after") or message.startswith("A after") for message in messages)


def test_slow_endpoint_uses_non_blocking_sleep_without_waiting_in_test(
    lab_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def no_delay(_: float) -> None:
        return None

    monkeypatch.setattr("app.routers.lab.asyncio.sleep", no_delay)

    response = lab_client.get("/lab/slow")

    assert response.status_code == 200
    assert response.json()["scenario"] == "slow"
    assert response.headers["x-process-time-ms"]
