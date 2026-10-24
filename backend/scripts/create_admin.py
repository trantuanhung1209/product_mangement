import getpass
import sys

from sqlalchemy.orm import Session

from app.db.database import get_session_factory
from app.services.auth import create_admin


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m scripts.create_admin admin@example.com")
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if not password:
        raise SystemExit("Password must not be empty.")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    with get_session_factory()() as session:
        try:
            user = create_admin(session, sys.argv[1], password)
        except ValueError as error:
            raise SystemExit(str(error)) from None
    print(f"Admin created: {user.email}")


if __name__ == "__main__":
    main()
