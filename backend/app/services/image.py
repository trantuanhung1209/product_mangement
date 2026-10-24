from io import BytesIO
import logging
from uuid import uuid4

from fastapi import HTTPException
from minio import Minio
from minio.error import S3Error
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session
from urllib3.exceptions import HTTPError

from app.core.config import get_settings
from app.models import ImageCleanupTask, Product


MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_WIDTH = 1600
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
logger = logging.getLogger("app.image")


def process_image(data: bytes) -> tuple[bytes, int, int]:
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 5 MB or smaller.")
    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in ALLOWED_FORMATS:
                raise HTTPException(status_code=422, detail="Only JPEG, PNG and WebP images are allowed.")
            if source.width * source.height > MAX_PIXELS:
                raise HTTPException(status_code=422, detail="Image has too many pixels.")
            image = ImageOps.exif_transpose(source)
            image.load()
            if image.width > MAX_WIDTH:
                height = round(image.height * MAX_WIDTH / image.width)
                image = image.resize((MAX_WIDTH, height), Image.Resampling.LANCZOS)
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            output = BytesIO()
            image.save(output, format="WEBP", quality=82, method=6)
            return output.getvalue(), image.width, image.height
    except Image.DecompressionBombError:
        raise HTTPException(status_code=422, detail="Image has too many pixels.") from None
    except UnidentifiedImageError:
        raise HTTPException(status_code=422, detail="Invalid image file.") from None


def _client() -> Minio:
    settings = get_settings()
    if not settings.minio_endpoint or not settings.minio_access_key or not settings.minio_secret_key:
        raise HTTPException(status_code=503, detail="Image storage is unavailable.")
    return Minio(settings.minio_endpoint, access_key=settings.minio_access_key, secret_key=settings.minio_secret_key, secure=settings.minio_secure)


def upload_image(data: bytes) -> str:
    settings = get_settings()
    key = f"products/{uuid4()}.webp"
    try:
        client = _client()
        if not client.bucket_exists(settings.minio_bucket):
            client.make_bucket(settings.minio_bucket)
        client.put_object(settings.minio_bucket, key, BytesIO(data), len(data), content_type="image/webp")
        return key
    except (S3Error, HTTPError):
        raise HTTPException(status_code=503, detail="Image storage is unavailable.") from None


def delete_image(key: str) -> bool:
    try:
        _client().remove_object(get_settings().minio_bucket, key)
        return True
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            return True
        logger.warning("Image deletion failed (%s)", error.code)
        return False
    except HTTPError as error:
        logger.warning("Image storage unavailable during deletion (%s)", type(error).__name__)
        return False


def get_image(key: str) -> bytes:
    try:
        response = _client().get_object(get_settings().minio_bucket, key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
    except S3Error:
        raise HTTPException(status_code=404, detail="Image not found.") from None
    except HTTPError:
        raise HTTPException(status_code=503, detail="Image storage is unavailable.") from None


def queue_image_cleanup(db: Session, key: str) -> None:
    if db.scalar(select(ImageCleanupTask.id).where(ImageCleanupTask.object_key == key)) is None:
        db.add(ImageCleanupTask(object_key=key))


def run_image_cleanup(db: Session, *, dry_run: bool = False) -> tuple[int, int]:
    removed = retained = 0
    tasks = list(db.scalars(select(ImageCleanupTask).order_by(ImageCleanupTask.id)))
    for task in tasks:
        if db.scalar(select(Product.id).where(Product.image_object_key == task.object_key)) is not None:
            retained += 1
            if not dry_run:
                db.delete(task)
            continue
        if dry_run:
            removed += 1
        elif delete_image(task.object_key):
            db.delete(task)
            removed += 1
        else:
            retained += 1
    if not dry_run:
        db.commit()
    return removed, retained
