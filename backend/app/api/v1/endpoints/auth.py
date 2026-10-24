from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import ACCESS_TOKEN_COOKIE, CSRF_TOKEN_COOKIE, create_access_token, get_current_user, require_csrf
from app.db.database import get_db
from app.models import User
from app.schemas.auth import LoginRequest, UserResponse
from app.services.auth import authenticate_user


router = APIRouter(prefix="/auth", tags=["authentication"])


def set_auth_cookies(response: Response, token: str, csrf_token: str) -> None:
    settings = get_settings()
    max_age = settings.jwt_access_token_expire_minutes * 60
    response.set_cookie(ACCESS_TOKEN_COOKIE, token, max_age=max_age, httponly=True, secure=settings.jwt_cookie_secure, samesite="lax")
    response.set_cookie(CSRF_TOKEN_COOKIE, csrf_token, max_age=max_age, httponly=False, secure=settings.jwt_cookie_secure, samesite="lax")


@router.post("/login", response_model=UserResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> User:
    user = authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    token, csrf_token = create_access_token(user)
    set_auth_cookies(response, token, csrf_token)
    return user


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, _: User = Depends(require_csrf)) -> Response:
    response.delete_cookie(ACCESS_TOKEN_COOKIE, httponly=True, samesite="lax")
    response.delete_cookie(CSRF_TOKEN_COOKIE, httponly=False, samesite="lax")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
