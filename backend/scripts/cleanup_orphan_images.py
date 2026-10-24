import argparse

from app.db.database import get_session_factory
from app.services.image import run_image_cleanup


def main() -> None:
    parser = argparse.ArgumentParser(description="Dọn object ảnh không còn Product tham chiếu.")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ in số object sẽ xóa.")
    args = parser.parse_args()

    with get_session_factory()() as session:
        removed, retained = run_image_cleanup(session, dry_run=args.dry_run)
    action = "Sẽ xóa" if args.dry_run else "Đã xóa"
    print(f"{action} {removed} object; giữ lại {retained} task để retry hoặc vì object vẫn được tham chiếu.")


if __name__ == "__main__":
    main()
