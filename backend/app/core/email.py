import logging
from typing import Protocol

import resend
from resend.http_client_requests import RequestsClient

from app.core.config import get_settings


logger = logging.getLogger("app.email")
SENDER_NAME = "Product Catalog"


class EmailDeliveryError(Exception):
    pass


class EmailSender(Protocol):
    is_configured: bool

    def send_otp(self, to: str, otp: str, ttl_seconds: int) -> None: ...

    def send_already_registered(self, to: str) -> None: ...

    def send_password_reset(self, to: str, otp: str, ttl_seconds: int) -> None: ...


def _otp_message(otp: str, ttl_seconds: int) -> tuple[str, str, str]:
    minutes = max(1, ttl_seconds // 60)
    subject = "Mã xác minh đăng ký Product Catalog"
    text = (
        f"Mã xác minh của bạn là {otp}. Mã có hiệu lực trong {minutes} phút.\n"
        "Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này. Không chia sẻ mã này với bất kỳ ai."
    )
    html = (
        f"<p>Mã xác minh của bạn là:</p><p style=\"font-size:28px;letter-spacing:6px\"><strong>{otp}</strong></p>"
        f"<p>Mã có hiệu lực trong {minutes} phút.</p>"
        "<p>Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này. Không chia sẻ mã này với bất kỳ ai.</p>"
    )
    return subject, text, html


def _already_registered_message() -> tuple[str, str, str]:
    subject = "Email này đã được đăng ký Product Catalog"
    text = (
        "Có người vừa dùng email này để đăng ký, nhưng tài khoản đã tồn tại. "
        "Hãy đăng nhập bằng email này. Nếu không phải bạn, bạn có thể bỏ qua email này."
    )
    html = (
        "<p>Có người vừa dùng email này để đăng ký, nhưng tài khoản đã tồn tại.</p>"
        "<p>Hãy đăng nhập bằng email này. Nếu không phải bạn, bạn có thể bỏ qua email này.</p>"
    )
    return subject, text, html


def _password_reset_message(otp: str, ttl_seconds: int) -> tuple[str, str, str]:
    minutes = max(1, ttl_seconds // 60)
    subject = "Mã đặt lại mật khẩu Product Catalog"
    text = (
        f"Mã đặt lại mật khẩu của bạn là {otp}. Mã có hiệu lực trong {minutes} phút.\n"
        "Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu của bạn không thay đổi. Không chia sẻ mã này với bất kỳ ai."
    )
    html = (
        f"<p>Mã đặt lại mật khẩu của bạn là:</p><p style=\"font-size:28px;letter-spacing:6px\"><strong>{otp}</strong></p>"
        f"<p>Mã có hiệu lực trong {minutes} phút.</p>"
        "<p>Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu của bạn không thay đổi. Không chia sẻ mã này với bất kỳ ai.</p>"
    )
    return subject, text, html


class ResendEmailSender:
    is_configured = True

    def __init__(self, api_key: str, from_email: str) -> None:
        self._api_key = api_key
        self._from = f"{SENDER_NAME} <{from_email}>"
        resend.default_http_client = RequestsClient(timeout=10)

    def _send(self, to: str, message: tuple[str, str, str]) -> None:
        subject, text, html = message
        resend.api_key = self._api_key
        try:
            resend.Emails.send({"from": self._from, "to": [to], "subject": subject, "text": text, "html": html})
        except Exception as error:
            # Log only the exception type: its message may echo the request, which carries the OTP.
            logger.error("Email delivery failed (%s)", type(error).__name__)
            raise EmailDeliveryError from None

    def send_otp(self, to: str, otp: str, ttl_seconds: int) -> None:
        self._send(to, _otp_message(otp, ttl_seconds))

    def send_already_registered(self, to: str) -> None:
        self._send(to, _already_registered_message())

    def send_password_reset(self, to: str, otp: str, ttl_seconds: int) -> None:
        self._send(to, _password_reset_message(otp, ttl_seconds))


class ConsoleEmailSender:
    """Development stand-in when no Resend key is set. It records that a mail would have gone out and
    nothing else: the code is never written to the console or the logs."""

    is_configured = True

    def _note(self, kind: str) -> None:
        logger.info("Email '%s' not delivered: RESEND_API_KEY is not set (APP_ENV=development).", kind)

    def send_otp(self, to: str, otp: str, ttl_seconds: int) -> None:
        self._note("registration OTP")

    def send_already_registered(self, to: str) -> None:
        self._note("already registered")

    def send_password_reset(self, to: str, otp: str, ttl_seconds: int) -> None:
        self._note("password reset OTP")


class UnavailableEmailSender:
    is_configured = False

    def send_otp(self, to: str, otp: str, ttl_seconds: int) -> None:
        raise EmailDeliveryError

    def send_already_registered(self, to: str) -> None:
        raise EmailDeliveryError

    def send_password_reset(self, to: str, otp: str, ttl_seconds: int) -> None:
        raise EmailDeliveryError


def get_email_sender() -> EmailSender:
    settings = get_settings()
    if settings.resend_api_key:
        return ResendEmailSender(settings.resend_api_key, settings.resend_from_email)
    if settings.app_env == "development":
        return ConsoleEmailSender()
    return UnavailableEmailSender()
