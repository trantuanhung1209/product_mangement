from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from redis import Redis
from sqlalchemy.orm import Session

from app.core.cache import get_redis
from app.core.config import get_settings
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    CSRF_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
    _access_token,
    blacklist_access_token,
    create_session,
    get_current_session_id,
    get_current_user,
    list_user_sessions,
    require_csrf,
    revoke_other_user_sessions,
    revoke_session,
    revoke_user_session,
    rotate_refresh,
)
from app.db.database import get_db
from app.models import User
from app.schemas.auth import LoginRequest, UserResponse
from app.schemas.session import RevokeSessionsResponse, SessionResponse
from app.services.auth import authenticate_user


router = APIRouter(prefix="/auth", tags=["authentication"])


def set_auth_cookies(response: Response, token: str, refresh_token: str, csrf_token: str) -> None:
    settings = get_settings()
    access_max_age = settings.jwt_access_token_expire_minutes * 60
    refresh_max_age = settings.jwt_refresh_token_expire_days * 86400
    response.set_cookie(
        ACCESS_TOKEN_COOKIE, token, max_age=access_max_age, httponly=True,
        secure=settings.jwt_cookie_secure, samesite="lax", path="/",
    )
    response.set_cookie(
        REFRESH_TOKEN_COOKIE, refresh_token, max_age=refresh_max_age, httponly=True,
        secure=settings.jwt_cookie_secure, samesite="lax", path="/api/v1/auth/refresh",
    )
    response.set_cookie(
        CSRF_TOKEN_COOKIE, csrf_token, max_age=refresh_max_age, httponly=False,
        secure=settings.jwt_cookie_secure, samesite="lax", path="/",
    )


@router.post("/login", response_model=UserResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> User:
    user = authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    token, refresh_token, csrf_token = create_session(user, redis, request.headers.get("user-agent"))
    set_auth_cookies(response, token, refresh_token, csrf_token)
    return user


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.get("/sessions", response_model=list[SessionResponse])
def sessions(
    current_user: User = Depends(get_current_user),
    current_session_id: str = Depends(get_current_session_id),
    redis: Redis | None = Depends(get_redis),
) -> list[SessionResponse]:
    return [SessionResponse(
        session_id=item["session_id"], created_at=item["created_at"],
        last_active_at=item["last_active_at"], expires_at=item["expires_at"],
        user_agent=item["user_agent"], is_current=item["session_id"] == current_session_id,
    ) for item in list_user_sessions(redis, current_user.id)]


@router.delete("/sessions/others", response_model=RevokeSessionsResponse)
def revoke_others(
    current_user: User = Depends(get_current_user),
    current_session_id: str = Depends(get_current_session_id),
    _: None = Depends(require_csrf),
    redis: Redis | None = Depends(get_redis),
) -> RevokeSessionsResponse:
    return RevokeSessionsResponse(revoked_count=revoke_other_user_sessions(redis, current_user.id, current_session_id))


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_single_session(
    session_id: str,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    current_session_id: str = Depends(get_current_session_id),
    _: None = Depends(require_csrf),
    redis: Redis | None = Depends(get_redis),
) -> Response:
    if not revoke_user_session(redis, current_user.id, session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    if session_id == current_session_id:
        response.delete_cookie(ACCESS_TOKEN_COOKIE, httponly=True, samesite="lax")
        response.delete_cookie(CSRF_TOKEN_COOKIE, httponly=False, samesite="lax")
        response.delete_cookie(REFRESH_TOKEN_COOKIE, httponly=True, samesite="lax", path="/api/v1/auth/refresh")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/refresh", status_code=status.HTTP_204_NO_CONTENT)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> Response:
    session_id, refresh_token, csrf_token, user_id = rotate_refresh(
        request, request.cookies.get(REFRESH_TOKEN_COOKIE), redis
    )
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Authentication required.")
    set_auth_cookies(response, _access_token(user, session_id), refresh_token, csrf_token)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/revoke-access", status_code=status.HTTP_204_NO_CONTENT)
def revoke_access(
    request: Request,
    _: None = Depends(require_csrf),
    redis: Redis | None = Depends(get_redis),
) -> Response:
    blacklist_access_token(request.cookies.get(ACCESS_TOKEN_COOKIE), redis)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    _: None = Depends(require_csrf),
    redis: Redis | None = Depends(get_redis),
) -> Response:
    revoke_session(request.cookies.get(ACCESS_TOKEN_COOKIE), redis)
    response.delete_cookie(ACCESS_TOKEN_COOKIE, httponly=True, samesite="lax")
    response.delete_cookie(CSRF_TOKEN_COOKIE, httponly=False, samesite="lax")
    response.delete_cookie(REFRESH_TOKEN_COOKIE, httponly=True, samesite="lax", path="/api/v1/auth/refresh")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
