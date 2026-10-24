from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image

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
