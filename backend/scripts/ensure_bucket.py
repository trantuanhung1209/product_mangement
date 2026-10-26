from minio import Minio

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    if not settings.minio_endpoint or not settings.minio_access_key or not settings.minio_secret_key:
        raise SystemExit("MINIO_ENDPOINT, MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be configured.")
    client = Minio(settings.minio_endpoint, access_key=settings.minio_access_key, secret_key=settings.minio_secret_key, secure=settings.minio_secure)
    if client.bucket_exists(settings.minio_bucket):
        print(f"Bucket {settings.minio_bucket} already exists.")
    else:
        client.make_bucket(settings.minio_bucket)
        print(f"Bucket {settings.minio_bucket} created.")


if __name__ == "__main__":
    main()
