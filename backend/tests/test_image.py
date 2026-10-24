import asyncio
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.api.v1.endpoints import products as product_endpoints
from app.services.image import MAX_UPLOAD_BYTES, process_image


def image_bytes(format: str, size: tuple[int, int] = (40, 20), mode: str = "RGB") -> bytes:
    image = Image.new(mode, size, (20, 40, 60, 120) if mode == "RGBA" else (20, 40, 60))
    output = BytesIO()
    image.save(output, format=format)
    return output.getvalue()


@pytest.mark.parametrize("format", ["JPEG", "WEBP"])
def test_supported_images_are_normalized_to_webp(format: str) -> None:
    data, width, height = process_image(image_bytes(format))
    with Image.open(BytesIO(data)) as image:
        assert image.format == "WEBP"
        assert image.size == (width, height)


def test_png_transparency_and_resize_are_preserved() -> None:
    data, width, height = process_image(image_bytes("PNG", (2000, 1000), "RGBA"))
    with Image.open(BytesIO(data)) as image:
        assert (width, height) == (1600, 800)
        assert image.mode == "RGBA"


@pytest.mark.parametrize("payload", [b"not-an-image", b"GIF89a"])
def test_invalid_or_unsupported_image_is_rejected(payload: bytes) -> None:
    with pytest.raises(HTTPException, match="Invalid image|Only JPEG"):
        process_image(payload)


def test_too_large_upload_is_rejected_before_decoding() -> None:
    with pytest.raises(HTTPException, match="5 MB"):
        process_image(b"0" * (MAX_UPLOAD_BYTES + 1))


class FakeProduct:
    def __init__(self, old_key: str | None) -> None:
        self.id = 1
        self.image_object_key = old_key
        self.image_width = None
        self.image_height = None
        self.image_url = None


class FakeDb:
    def __init__(self, fail_first_commit: bool = False) -> None:
        self.fail_first_commit = fail_first_commit
        self.commits = 0
        self.rolled_back = False

    def commit(self) -> None:
        self.commits += 1
        if self.fail_first_commit and self.commits == 1:
            raise RuntimeError("database unavailable")

    def rollback(self) -> None:
        self.rolled_back = True

    def refresh(self, _product: FakeProduct) -> None:
        return


def upload_file() -> UploadFile:
    return UploadFile(BytesIO(b"source"), filename="source.jpg")


def test_failed_image_metadata_commit_queues_uploaded_object_for_retry(monkeypatch) -> None:
    db = FakeDb(fail_first_commit=True)
    queued: list[str] = []
    monkeypatch.setattr(product_endpoints.product_service, "get_product_for_update_or_404", lambda *_: FakeProduct(None))
    monkeypatch.setattr(product_endpoints, "process_image", lambda _: (b"webp", 1, 1))
    monkeypatch.setattr(product_endpoints, "upload_image", lambda _: "products/new.webp")
    monkeypatch.setattr(product_endpoints, "delete_image", lambda _: False)
    monkeypatch.setattr(product_endpoints, "queue_image_cleanup", lambda _, key: queued.append(key))

    with pytest.raises(HTTPException, match="could not be saved"):
        asyncio.run(product_endpoints.upload_product_image(1, upload_file(), db, None, object()))

    assert db.rolled_back and db.commits == 2
    assert queued == ["products/new.webp"]


def test_cleanup_failure_does_not_fail_successful_image_replace(monkeypatch) -> None:
    db = FakeDb()
    product = FakeProduct("products/old.webp")
    monkeypatch.setattr(product_endpoints.product_service, "get_product_for_update_or_404", lambda *_: product)
    monkeypatch.setattr(product_endpoints, "process_image", lambda _: (b"webp", 1, 1))
    monkeypatch.setattr(product_endpoints, "upload_image", lambda _: "products/new.webp")
    monkeypatch.setattr(product_endpoints, "queue_image_cleanup", lambda *_: None)
    monkeypatch.setattr(product_endpoints, "run_image_cleanup", lambda _: (_ for _ in ()).throw(RuntimeError("MinIO down")))
    monkeypatch.setattr(product_endpoints.ProductResponse, "model_validate", lambda _: "saved")

    assert asyncio.run(product_endpoints.upload_product_image(1, upload_file(), db, None, object())) == "saved"
    assert db.commits == 1 and db.rolled_back
