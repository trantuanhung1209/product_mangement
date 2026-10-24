from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.models import User, UserRole
from app.schemas.auth import normalize_email


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        return None
    return user


def create_admin(db: Session, email: str, password: str) -> User:
    normalized_email = normalize_email(email)
    existing_user = db.scalar(select(User).where(User.email == normalized_email))
    if existing_user is not None:
        raise ValueError("Email already exists.")
    user = User(email=normalized_email, password_hash=hash_password(password), role=UserRole.ADMIN)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
