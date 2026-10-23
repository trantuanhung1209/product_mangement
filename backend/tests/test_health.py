from fastapi.testclient import TestClient

from app.main import app


def test_health_check_returns_service_status() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "product-catalog-api"}
    assert response.headers["x-request-id"]
    assert float(response.headers["x-process-time-ms"]) >= 0
    assert "/lab/success" not in {getattr(route, "path", None) for route in app.routes}
