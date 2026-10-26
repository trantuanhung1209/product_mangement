import logging
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import email as email_module
from app.core.cache import get_redis
from app.core.config import get_settings
from app.core.email import ConsoleEmailSender, EmailDeliveryError, ResendEmailSender, UnavailableEmailSender, get_email_sender
from app.core.security import hash_password
from app.models import User, UserRole
from app.services.registration import ACCEPTED_MESSAGE, INVALID_OTP_MESSAGE, LOCKED_MESSAGE
from test_auth import auth_database_url, auth_engine, auth_redis, client, create_user  # noqa: F401


PASSWORD = "Str0ng!Passw0rd"
REQUEST = "/api/v1/auth/register/request-otp"
RESEND = "/api/v1/auth/register/resend-otp"
VERIFY = "/api/v1/auth/register/verify-otp"


class FakeSender:
    is_configured = True

    def __init__(self) -> None:
        self.otps: list[tuple[str, str]] = []
        self.notices: list[str] = []
        self.fail = False

    def send_otp(self, to: str, otp: str, ttl_seconds: int) -> None:
        if self.fail:
            raise EmailDeliveryError
        self.otps.append((to, otp))

    def send_already_registered(self, to: str) -> None:
        if self.fail:
            raise EmailDeliveryError
        self.notices.append(to)

    @property
    def last_otp(self) -> str:
        return self.otps[-1][1]


@pytest.fixture
def sender(client: TestClient) -> FakeSender:
    fake = FakeSender()
    client.app.dependency_overrides[get_email_sender] = lambda: fake
    return fake


def new_email() -> str:
    return f"{uuid4().hex}@example.com"


def set_env(monkeypatch: pytest.MonkeyPatch, name: str, value: str) -> None:
    monkeypatch.setenv(name, value)
    get_settings.cache_clear()


def request_otp(client: TestClient, email: str, password: str = PASSWORD):
    return client.post(REQUEST, json={"email": email, "password": password})


def verify(client: TestClient, email: str, otp: str):
    return client.post(VERIFY, json={"email": email, "otp": otp})


def user_count(engine, email: str) -> int:
    with Session(engine) as session:
        return session.scalar(select(func.count()).select_from(User).where(User.email == email))


def all_redis_text(redis: Redis) -> str:
    chunks = []
    for key in redis.scan_iter("*"):
        chunks.append(key)
        kind = redis.type(key)
        if kind == "hash":
            chunks.extend(f"{k}={v}" for k, v in redis.hgetall(key).items())
        elif kind == "string":
            chunks.append(str(redis.get(key)))
    return "\n".join(chunks)


# --- password rules ----------------------------------------------------------------------------

@pytest.mark.database
@pytest.mark.parametrize(
    ("password", "fragment"),
    [
        ("Sh0rt!", "ít nhất 8 ký tự"),
        ("lowercase1!", "chữ hoa"),
        ("NoDigitsHere!", "chữ số"),
        ("NoSpecial123", "ký tự đặc biệt"),
        ("A1!" + "a" * 126, "ít nhất 8"),  # 129 characters is rejected by the length cap
    ],
)
def test_weak_password_is_rejected(client: TestClient, sender: FakeSender, password: str, fragment: str) -> None:
    response = request_otp(client, new_email(), password)
    assert response.status_code == 422
    assert not sender.otps
    if len(password) <= 128:
        assert fragment in response.json()["detail"][0]["msg"]


@pytest.mark.database
@pytest.mark.parametrize("password", ["Abcdef1!", "Mật-khẩu-Tốt-1", "Đẹp-1xyz", "Mật khẩu 1A", "P@ssw0rd" + "x" * 120])
def test_valid_password_is_accepted(client: TestClient, sender: FakeSender, password: str) -> None:
    assert request_otp(client, new_email(), password).status_code == 202


# --- happy path and hygiene --------------------------------------------------------------------

@pytest.mark.database
def test_register_creates_user_role_user_and_signs_in(client: TestClient, sender: FakeSender, auth_engine, auth_redis: Redis) -> None:
    email = new_email()
    response = request_otp(client, email)
    assert response.status_code == 202
    assert response.json() == {"message": ACCEPTED_MESSAGE, "expires_in_seconds": 300, "resend_in_seconds": 60}
    assert user_count(auth_engine, email) == 0  # no user until the OTP is right

    stored = all_redis_text(auth_redis)
    assert sender.last_otp not in stored and PASSWORD not in stored and email not in stored
    ttl = auth_redis.ttl(next(auth_redis.scan_iter("registration:pending:*")))
    assert 0 < ttl <= 300

    created = verify(client, email, sender.last_otp)
    assert created.status_code == 201
    body = created.json()
    assert body["email"] == email and body["role"] == "USER" and body["is_active"] is True
    assert "password" not in str(body).lower() and sender.last_otp not in created.text
    assert client.get("/api/v1/auth/me").json()["email"] == email  # auto sign-in
    with Session(auth_engine) as session:
        user = session.scalar(select(User).where(User.email == email))
        assert user.role is UserRole.USER and user.password_hash != PASSWORD
    assert client.post("/api/v1/auth/logout").status_code in (204, 401, 403)


@pytest.mark.database
def test_email_is_normalized(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email = new_email()
    assert request_otp(client, f"  {email.upper()} ").status_code == 202
    assert verify(client, email, sender.last_otp).status_code == 201
    assert user_count(auth_engine, email) == 1


@pytest.mark.database
def test_otp_cannot_be_reused(client: TestClient, sender: FakeSender) -> None:
    email = new_email()
    request_otp(client, email)
    otp = sender.last_otp
    assert verify(client, email, otp).status_code == 201
    again = verify(client, email, otp)
    assert again.status_code == 400 and again.json()["detail"] == INVALID_OTP_MESSAGE


@pytest.mark.database
def test_wrong_otp_is_rejected_then_right_one_still_works(client: TestClient, sender: FakeSender) -> None:
    email = new_email()
    request_otp(client, email)
    wrong = "000000" if sender.last_otp != "000000" else "000001"
    response = verify(client, email, wrong)
    assert response.status_code == 400 and response.json()["detail"] == INVALID_OTP_MESSAGE
    assert verify(client, email, sender.last_otp).status_code == 201


@pytest.mark.database
def test_five_wrong_attempts_destroy_the_otp(client: TestClient, sender: FakeSender, auth_redis: Redis, auth_engine, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_REGISTRATION_PER_MINUTE", "50")
    email = new_email()
    request_otp(client, email)
    right = sender.last_otp
    wrong = "000000" if right != "000000" else "000001"
    details = [verify(client, email, wrong).json()["detail"] for _ in range(5)]
    assert details[:4] == [INVALID_OTP_MESSAGE] * 4 and details[4] == LOCKED_MESSAGE
    assert not list(auth_redis.scan_iter("registration:pending:*"))
    response = verify(client, email, right)  # even the correct code is dead now
    assert response.status_code == 400 and user_count(auth_engine, email) == 0


@pytest.mark.database
def test_expired_otp_is_rejected(client: TestClient, sender: FakeSender, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "OTP_TTL_SECONDS", "1")
    email = new_email()
    request_otp(client, email)
    time.sleep(1.2)
    response = verify(client, email, sender.last_otp)
    assert response.status_code == 400 and response.json()["detail"] == INVALID_OTP_MESSAGE


@pytest.mark.database
def test_verify_without_request_is_rejected(client: TestClient, sender: FakeSender) -> None:
    assert verify(client, new_email(), "123456").status_code == 400


@pytest.mark.database
@pytest.mark.parametrize("otp", ["12345", "1234567", "abcdef", "12 456", ""])
def test_malformed_otp_is_rejected(client: TestClient, sender: FakeSender, otp: str) -> None:
    assert verify(client, new_email(), otp).status_code == 422


# --- enumeration, role, injection --------------------------------------------------------------

@pytest.mark.database
def test_existing_email_gets_the_same_response_and_no_pending(client: TestClient, sender: FakeSender, auth_engine, auth_redis: Redis) -> None:
    existing, _ = create_user(auth_engine)
    fresh = new_email()
    first = request_otp(client, existing)
    second = request_otp(client, fresh)
    assert (first.status_code, first.json()) == (second.status_code, second.json())
    assert sender.notices == [existing] and [to for to, _ in sender.otps] == [fresh]
    assert len(list(auth_redis.scan_iter("registration:pending:*"))) == 1  # only the new email


@pytest.mark.database
def test_existing_email_cannot_be_taken_over_with_a_forged_pending(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email = new_email()
    request_otp(client, email)
    otp = sender.last_otp
    with Session(auth_engine) as session:  # the account appears between request and verify
        session.add(User(email=email, password_hash=hash_password("Other1!pass"), role=UserRole.USER))
        session.commit()
    response = verify(client, email, otp)
    assert response.status_code == 400 and "access_token" not in response.cookies
    assert user_count(auth_engine, email) == 1


@pytest.mark.database
@pytest.mark.parametrize("extra", [{"role": "ADMIN"}, {"is_active": False}, {"id": 1}])
def test_extra_fields_are_rejected_on_every_endpoint(client: TestClient, sender: FakeSender, extra: dict) -> None:
    email = new_email()
    assert client.post(REQUEST, json={"email": email, "password": PASSWORD, **extra}).status_code == 422
    assert client.post(RESEND, json={"email": email, **extra}).status_code == 422
    assert client.post(VERIFY, json={"email": email, "otp": "123456", **extra}).status_code == 422
    assert not sender.otps


@pytest.mark.database
def test_foreign_origin_is_rejected(client: TestClient, sender: FakeSender) -> None:
    headers = {"Origin": "http://evil.test"}
    assert client.post(REQUEST, json={"email": new_email(), "password": PASSWORD}, headers=headers).status_code == 403
    assert client.post(RESEND, json={"email": new_email()}, headers=headers).status_code == 403
    assert client.post(VERIFY, json={"email": new_email(), "otp": "123456"}, headers=headers).status_code == 403
    assert not sender.otps


# --- cooldown, resend, rate limits -------------------------------------------------------------

@pytest.mark.database
def test_resend_is_blocked_during_cooldown_then_replaces_the_otp(client: TestClient, sender: FakeSender, auth_redis: Redis) -> None:
    email = new_email()
    request_otp(client, email)
    first = sender.last_otp
    blocked = client.post(RESEND, json={"email": email})
    assert blocked.status_code == 429 and 1 <= int(blocked.headers["retry-after"]) <= 60
    assert request_otp(client, email).status_code == 429  # a new request is on the same cooldown

    auth_redis.delete(next(auth_redis.scan_iter("registration:cooldown:*")))
    assert client.post(RESEND, json={"email": email}).status_code == 202
    second = sender.last_otp
    if first != second:  # 1-in-a-million collision otherwise
        assert verify(client, email, first).status_code == 400
    assert verify(client, email, second).status_code == 201


@pytest.mark.database
def test_resend_without_pending_sends_nothing_and_looks_the_same(client: TestClient, sender: FakeSender) -> None:
    response = client.post(RESEND, json={"email": new_email()})
    assert response.status_code == 202 and response.json()["message"] == ACCEPTED_MESSAGE
    assert not sender.otps and not sender.notices


@pytest.mark.database
def test_cooldown_ttl_matches_setting(client: TestClient, sender: FakeSender, auth_redis: Redis) -> None:
    request_otp(client, new_email())
    ttl = auth_redis.ttl(next(auth_redis.scan_iter("registration:cooldown:*")))
    assert 0 < ttl <= 60


@pytest.mark.database
def test_request_rate_limit_per_ip_returns_429_with_retry_after(client: TestClient, sender: FakeSender, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_REGISTRATION_PER_MINUTE", "2")
    assert [request_otp(client, new_email()).status_code for _ in range(2)] == [202, 202]
    limited = request_otp(client, new_email())
    assert limited.status_code == 429 and 1 <= int(limited.headers["retry-after"]) <= 60


@pytest.mark.database
def test_verify_rate_limit_per_email(client: TestClient, sender: FakeSender, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_REGISTRATION_PER_MINUTE", "2")
    email = new_email()
    assert [verify(client, email, "123456").status_code for _ in range(2)] == [400, 400]
    limited = verify(client, email, "123456")
    assert limited.status_code == 429 and "retry-after" in limited.headers


@pytest.mark.database
def test_resend_rate_limit(client: TestClient, sender: FakeSender, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_REGISTRATION_PER_MINUTE", "1")
    email = new_email()
    assert client.post(RESEND, json={"email": email}).status_code == 202
    assert client.post(RESEND, json={"email": email}).status_code == 429


# --- failures ----------------------------------------------------------------------------------

@pytest.mark.database
def test_email_failure_is_cleaned_up_after_the_response(client: TestClient, sender: FakeSender, auth_redis: Redis) -> None:
    sender.fail = True
    email = new_email()
    assert request_otp(client, email).status_code == 202  # same answer: delivery happens after the response
    assert not list(auth_redis.scan_iter("registration:*"))  # no usable OTP, no cooldown left behind
    sender.fail = False
    assert request_otp(client, email).status_code == 202
    assert sender.otps  # and the retry went out at once


@pytest.mark.database
def test_resend_failure_is_cleaned_up_the_same_way(client: TestClient, sender: FakeSender, auth_redis: Redis) -> None:
    email = new_email()
    request_otp(client, email)
    auth_redis.delete(next(auth_redis.scan_iter("registration:cooldown:*")))
    sender.fail = True
    assert client.post(RESEND, json={"email": email}).status_code == 202
    assert not list(auth_redis.scan_iter("registration:*"))


@pytest.mark.database
def test_existing_email_failure_looks_the_same_as_new_email_failure(client: TestClient, sender: FakeSender, auth_engine) -> None:
    sender.fail = True
    existing, _ = create_user(auth_engine)
    a, b = request_otp(client, existing), request_otp(client, new_email())
    assert (a.status_code, a.json()) == (b.status_code, b.json()) == (202, a.json())


@pytest.mark.database
def test_timings_follow_settings(client: TestClient, sender: FakeSender, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "OTP_TTL_SECONDS", "120")
    set_env(monkeypatch, "OTP_RESEND_COOLDOWN_SECONDS", "45")
    body = request_otp(client, new_email()).json()
    assert (body["expires_in_seconds"], body["resend_in_seconds"]) == (120, 45)


@pytest.mark.database
def test_resend_answers_identically_with_or_without_a_pending_signup(client: TestClient, sender: FakeSender) -> None:
    pending = new_email()
    request_otp(client, pending)
    # Both resends answer 202 with the same body shape; only the outbound mail differs.
    nothing = client.post(RESEND, json={"email": new_email()})
    assert nothing.status_code == 202 and nothing.json().keys() == request_otp(client, new_email()).json().keys()


@pytest.mark.database
def test_unavailable_sender_returns_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RESEND_API_KEY", "")  # empty overrides any value from .env
    set_env(monkeypatch, "APP_ENV", "production")
    assert request_otp(client, new_email()).status_code == 503


@pytest.mark.database
def test_redis_unavailable_fails_closed(client: TestClient, sender: FakeSender) -> None:
    client.app.dependency_overrides[get_redis] = lambda: None
    assert request_otp(client, new_email()).status_code == 503
    assert verify(client, new_email(), "123456").status_code == 503


# --- concurrency -------------------------------------------------------------------------------

@pytest.mark.database
def test_concurrent_verify_creates_one_user(client: TestClient, sender: FakeSender, auth_engine, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_REGISTRATION_PER_MINUTE", "50")
    email = new_email()
    request_otp(client, email)
    otp = sender.last_otp
    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(lambda _: verify(client, email, otp).status_code, range(8)))
    assert statuses.count(201) == 1 and statuses.count(400) == 7
    assert user_count(auth_engine, email) == 1


# --- logging -----------------------------------------------------------------------------------

@pytest.mark.database
def test_no_secrets_in_logs_or_responses(client: TestClient, sender: FakeSender, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_REGISTRATION_PER_MINUTE", "50")
    caplog.set_level(logging.DEBUG)
    email = new_email()
    texts = [request_otp(client, email).text, request_otp(client, email).text, client.post(RESEND, json={"email": email}).text]
    wrong = verify(client, email, "000000")
    texts.append(wrong.text)
    texts.append(verify(client, email, sender.last_otp).text)
    texts.append(request_otp(client, new_email(), "weak").text)
    joined = "\n".join(texts) + caplog.text
    assert sender.last_otp not in joined and PASSWORD not in joined and "weak" not in joined.replace("weak_password", "")


def test_resend_sender_logs_only_the_exception_type(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    def boom(_params):
        raise RuntimeError("request failed for 654321 to a@example.com")

    monkeypatch.setattr(email_module.resend.Emails, "send", staticmethod(boom))
    caplog.set_level(logging.DEBUG)
    with pytest.raises(EmailDeliveryError):
        ResendEmailSender("re_test", "noreply@uside.id.vn").send_otp("a@example.com", "654321", 300)
    assert "654321" not in caplog.text and "a@example.com" not in caplog.text and "RuntimeError" in caplog.text


# --- sender selection --------------------------------------------------------------------------

def test_sender_selection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RESEND_API_KEY", "")  # empty overrides any value from .env
    set_env(monkeypatch, "APP_ENV", "production")
    assert isinstance(get_email_sender(), UnavailableEmailSender)
    set_env(monkeypatch, "APP_ENV", "development")
    assert isinstance(get_email_sender(), ConsoleEmailSender)
    set_env(monkeypatch, "RESEND_API_KEY", "re_test_key")
    assert isinstance(get_email_sender(), ResendEmailSender)
    set_env(monkeypatch, "APP_ENV", "production")
    assert isinstance(get_email_sender(), ResendEmailSender)


def test_console_sender_prints_to_stdout_not_logs(capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    ConsoleEmailSender().send_otp("a@example.com", "123456", 300)
    assert "123456" in capsys.readouterr().out and "123456" not in caplog.text


def test_resend_sender_builds_a_vietnamese_message_without_calling_the_network(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict] = []
    monkeypatch.setattr(email_module.resend.Emails, "send", staticmethod(lambda params: sent.append(params)))
    ResendEmailSender("re_test", "noreply@uside.id.vn").send_otp("a@example.com", "123456", 300)
    assert sent[0]["from"] == "Product Catalog <noreply@uside.id.vn>" and sent[0]["to"] == ["a@example.com"]
    assert "123456" in sent[0]["text"] and "5 phút" in sent[0]["text"]
