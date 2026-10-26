from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from redis import Redis
from sqlalchemy.orm import Session

from app.core.cache import get_redis
from app.core.email import EmailSender, get_email_sender
from app.core.rate_limit import limit_password_change, limit_password_forgot, limit_password_reset
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    CSRF_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
    get_current_user,
    require_allowed_origin,
    require_csrf,
)
from app.db.database import get_db
from app.models import User
from app.schemas.password import ChangePasswordRequest, ForgotPasswordRequest, ResetPasswordRequest
from app.schemas.registration import RegistrationAccepted
from app.services import password as service


router = APIRouter(prefix="/auth/password", tags=["password"])


# forgot/reset run before any session exists, so the double-submit CSRF token cannot apply: they reject
# a foreign Origin instead, accept JSON only and never set a cookie. change has a session and uses CSRF.
@router.post(
    "/forgot", response_model=RegistrationAccepted, status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_allowed_origin)],
)
def forgot_password(
    payload: ForgotPasswordRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
    sender: EmailSender = Depends(get_email_sender),
    _: None = Depends(limit_password_forgot),
) -> RegistrationAccepted:
    return RegistrationAccepted(**asdict(service.forgot(db, redis, sender, background, payload.email)))


@router.post("/reset", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_allowed_origin)])
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
    _: None = Depends(limit_password_reset),
) -> Response:
    service.reset(db, redis, payload.email, payload.otp, payload.new_password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/change", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
    _: None = Depends(require_csrf),
    __: None = Depends(limit_password_change),
) -> Response:
    service.change(
        db, redis, current_user, request.cookies.get(ACCESS_TOKEN_COOKIE), payload.current_password, payload.new_password
    )
    # Every session of this user, including this one, is gone: clear the browser's cookies too.
    response.delete_cookie(ACCESS_TOKEN_COOKIE, httponly=True, samesite="lax")
    response.delete_cookie(CSRF_TOKEN_COOKIE, httponly=False, samesite="lax")
    response.delete_cookie(REFRESH_TOKEN_COOKIE, httponly=True, samesite="lax", path="/api/v1/auth/refresh")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
