from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from redis import Redis
from sqlalchemy.orm import Session

from app.api.v1.endpoints.auth import set_auth_cookies
from app.core.cache import get_redis
from app.core.email import EmailSender, get_email_sender
from app.core.rate_limit import limit_register_request, limit_register_resend, limit_register_verify
from app.core.security import create_session, require_allowed_origin
from app.db.database import get_db
from app.models import User
from app.schemas.auth import UserResponse
from app.schemas.registration import RegisterRequest, RegistrationAccepted, ResendOtpRequest, VerifyOtpRequest
from app.services import registration as service


# No session exists yet, so the double-submit CSRF token cannot apply. Every endpoint here instead
# rejects a foreign Origin, and none sets a cookie before the OTP is verified.
router = APIRouter(
    prefix="/auth/register", tags=["registration"], dependencies=[Depends(require_allowed_origin)]
)


@router.post("/request-otp", response_model=RegistrationAccepted, status_code=status.HTTP_202_ACCEPTED)
def request_otp(
    payload: RegisterRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
    sender: EmailSender = Depends(get_email_sender),
    _: None = Depends(limit_register_request),
) -> RegistrationAccepted:
    return RegistrationAccepted(**asdict(service.request_otp(db, redis, sender, background, payload.email, payload.password)))


@router.post("/resend-otp", response_model=RegistrationAccepted, status_code=status.HTTP_202_ACCEPTED)
def resend_otp(
    payload: ResendOtpRequest,
    background: BackgroundTasks,
    redis: Redis | None = Depends(get_redis),
    sender: EmailSender = Depends(get_email_sender),
    _: None = Depends(limit_register_resend),
) -> RegistrationAccepted:
    return RegistrationAccepted(**asdict(service.resend_otp(redis, sender, background, payload.email)))


@router.post("/verify-otp", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def verify_otp(
    payload: VerifyOtpRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
    _: None = Depends(limit_register_verify),
) -> User:
    user = service.verify_otp(db, redis, payload.email, payload.otp)
    token, refresh_token, csrf_token = create_session(user, redis, request.headers.get("user-agent"))
    set_auth_cookies(response, token, refresh_token, csrf_token)
    return user
