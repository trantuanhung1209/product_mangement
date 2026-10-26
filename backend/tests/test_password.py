import logging
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy.orm import Session

from app.core.cache import get_redis
from app.core.email import get_email_sender
from app.core.security import ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, verify_password
from app.models import User
from app.services.otp_flow import ACCEPTED_MESSAGE, INVALID_OTP_MESSAGE, LOCKED_MESSAGE
from app.services.password import SAME_PASSWORD_MESSAGE, WRONG_CURRENT_MESSAGE
from uuid import uuid4

from app.core.security import hash_password
from app.models import UserRole
from test_auth import auth_database_url, auth_engine, auth_redis, client, csrf_headers, login  # noqa: F401
from test_registration import FakeSender, new_email, sender, set_env  # noqa: F401


OLD = "Old!Passw0rd-1"  # satisfies the rules, so it can be offered again as a "new" password
NEW = "N3w!Passw0rd-ok"
FORGOT = "/api/v1/auth/password/forgot"
RESET = "/api/v1/auth/password/reset"
CHANGE = "/api/v1/auth/password/change"
ME = "/api/v1/auth/me"


def create_user(engine, role: UserRole = UserRole.USER, active: bool = True) -> tuple[str, str]:
    email = f"{uuid4().hex}@example.com"
    with Session(engine) as session:
        session.add(User(email=email, password_hash=hash_password(OLD), role=role, is_active=active))
        session.commit()
    return email, OLD


def forgot(client: TestClient, email: str):
    return client.post(FORGOT, json={"email": email})


def reset(client: TestClient, email: str, otp: str, new_password: str = NEW):
    return client.post(RESET, json={"email": email, "otp": otp, "new_password": new_password})


def stored_hash(engine, email: str) -> str:
    with Session(engine) as session:
        return session.query(User).filter(User.email == email).one().password_hash


def keys(redis: Redis, pattern: str) -> list[str]:
    return list(redis.scan_iter(pattern))


def wrong_for(otp: str) -> str:
    return "000000" if otp != "000000" else "000001"


# --- forgot -------------------------------------------------------------------------------------

@pytest.mark.database
def test_forgot_answers_identically_for_known_and_unknown_emails(client: TestClient, sender: FakeSender, auth_engine, auth_redis: Redis) -> None:
    email, _ = create_user(auth_engine)
    known, unknown = forgot(client, email), forgot(client, new_email())
    assert (known.status_code, known.json()) == (unknown.status_code, unknown.json()) == (202, known.json())
    assert known.json()["message"] == ACCEPTED_MESSAGE
    assert [to for to, _ in sender.resets] == [email]
    assert len(keys(auth_redis, "password-reset:pending:*")) == 1  # only the real account


@pytest.mark.database
def test_inactive_account_gets_no_code(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email, _ = create_user(auth_engine, UserRole.USER, active=False)
    assert forgot(client, email).status_code == 202
    assert not sender.resets


@pytest.mark.database
def test_forgot_cooldown_applies_to_every_email_and_gives_retry_after(client: TestClient, sender: FakeSender, auth_engine) -> None:
    for email in (create_user(auth_engine)[0], new_email()):
        assert forgot(client, email).status_code == 202
        again = forgot(client, email)
        assert again.status_code == 429 and 1 <= int(again.headers["retry-after"]) <= 60


@pytest.mark.database
def test_forgot_rate_limit(client: TestClient, sender: FakeSender, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_PASSWORD_PER_MINUTE", "2")
    assert [forgot(client, new_email()).status_code for _ in range(2)] == [202, 202]
    limited = forgot(client, new_email())
    assert limited.status_code == 429 and 1 <= int(limited.headers["retry-after"]) <= 60


@pytest.mark.database
def test_forgot_email_failure_is_cleaned_up(client: TestClient, sender: FakeSender, auth_engine, auth_redis: Redis) -> None:
    email, _ = create_user(auth_engine)
    sender.fail = True
    assert forgot(client, email).status_code == 202
    assert not keys(auth_redis, "password-reset:*")
    sender.fail = False
    assert forgot(client, email).status_code == 202 and sender.resets


@pytest.mark.database
def test_forgot_and_reset_reject_foreign_origin_and_extra_fields(client: TestClient, sender: FakeSender) -> None:
    evil = {"Origin": "http://evil.test"}
    assert client.post(FORGOT, json={"email": new_email()}, headers=evil).status_code == 403
    assert client.post(RESET, json={"email": new_email(), "otp": "123456", "new_password": NEW}, headers=evil).status_code == 403
    assert client.post(FORGOT, json={"email": new_email(), "role": "ADMIN"}).status_code == 422
    assert client.post(RESET, json={"email": new_email(), "otp": "123456", "new_password": NEW, "is_active": True}).status_code == 422


@pytest.mark.database
def test_redis_down_fails_closed(client: TestClient, sender: FakeSender) -> None:
    client.app.dependency_overrides[get_redis] = lambda: None
    assert forgot(client, new_email()).status_code == 503
    assert reset(client, new_email(), "123456").status_code == 503


# --- reset --------------------------------------------------------------------------------------

@pytest.mark.database
def test_reset_changes_the_password_and_the_code_is_single_use(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email, _ = create_user(auth_engine)
    forgot(client, email)
    otp = sender.resets[-1][1]
    assert reset(client, email, otp).status_code == 204
    assert client.post("/api/v1/auth/login", json={"email": email, "password": OLD}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": email, "password": NEW}).status_code == 200
    assert "access_token" not in reset(client, email, otp).cookies
    again = reset(client, email, otp, "An0ther!Passw0rd")
    assert again.status_code == 400 and again.json()["detail"] == INVALID_OTP_MESSAGE


@pytest.mark.database
def test_reset_does_not_sign_in(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email, _ = create_user(auth_engine)
    forgot(client, email)
    response = reset(client, email, sender.resets[-1][1])
    assert response.status_code == 204 and not response.cookies
    assert client.get(ME).status_code == 401


@pytest.mark.database
def test_reset_revokes_old_sessions_and_tokens(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email, password = create_user(auth_engine)
    other = TestClient(client.app)
    login(other, email, password)
    login(client, email, password)
    refresh_cookie = client.cookies.get(REFRESH_TOKEN_COOKIE)
    stolen_access = client.cookies.get(ACCESS_TOKEN_COOKIE)
    assert other.get(ME).status_code == 200 and client.get(ME).status_code == 200

    forgot(client, email)
    assert reset(client, email, sender.resets[-1][1]).status_code == 204
    assert other.get(ME).status_code == 401 and client.get(ME).status_code == 401
    replay = TestClient(client.app)
    replay.cookies.set(ACCESS_TOKEN_COOKIE, stolen_access)
    assert replay.get(ME).status_code == 401  # the access token dies with its session
    replay.cookies.set(REFRESH_TOKEN_COOKIE, refresh_cookie, path="/api/v1/auth/refresh")
    assert replay.post("/api/v1/auth/refresh").status_code == 401


@pytest.mark.database
def test_wrong_code_then_right_code(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email, _ = create_user(auth_engine)
    forgot(client, email)
    otp = sender.resets[-1][1]
    wrong = reset(client, email, wrong_for(otp))
    assert wrong.status_code == 400 and wrong.json()["detail"] == INVALID_OTP_MESSAGE
    assert reset(client, email, otp).status_code == 204


@pytest.mark.database
def test_five_wrong_codes_destroy_the_code(client: TestClient, sender: FakeSender, auth_engine, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_PASSWORD_PER_MINUTE", "50")
    email, _ = create_user(auth_engine)
    forgot(client, email)
    otp = sender.resets[-1][1]
    details = [reset(client, email, wrong_for(otp)).json()["detail"] for _ in range(5)]
    assert details[:4] == [INVALID_OTP_MESSAGE] * 4 and details[4] == LOCKED_MESSAGE
    assert not keys(auth_redis, "password-reset:pending:*")
    assert reset(client, email, otp).status_code == 400
    assert verify_password(OLD, stored_hash(auth_engine, email))


@pytest.mark.database
def test_expired_code(client: TestClient, sender: FakeSender, auth_engine, monkeypatch: pytest.MonkeyPatch) -> None:
    import time

    set_env(monkeypatch, "OTP_TTL_SECONDS", "1")
    email, _ = create_user(auth_engine)
    forgot(client, email)
    time.sleep(1.2)
    assert reset(client, email, sender.resets[-1][1]).status_code == 400


@pytest.mark.database
def test_same_password_is_refused_without_burning_the_code(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email, _ = create_user(auth_engine)
    forgot(client, email)
    otp = sender.resets[-1][1]
    same = reset(client, email, otp, OLD)
    assert same.status_code == 400 and same.json()["detail"] == SAME_PASSWORD_MESSAGE
    assert reset(client, email, otp).status_code == 204


@pytest.mark.database
def test_same_password_answer_is_never_given_without_a_valid_code(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email, _ = create_user(auth_engine)
    forgot(client, email)
    probe = reset(client, email, wrong_for(sender.resets[-1][1]), OLD)  # the real current password, wrong code
    assert probe.json()["detail"] == INVALID_OTP_MESSAGE


@pytest.mark.database
@pytest.mark.parametrize("weak", ["Sh0rt!", "lowercase1!", "NoDigitsHere!", "NoSpecial123"])
def test_weak_new_password_is_refused_and_code_survives(client: TestClient, sender: FakeSender, auth_engine, weak: str) -> None:
    email, _ = create_user(auth_engine)
    forgot(client, email)
    otp = sender.resets[-1][1]
    assert reset(client, email, otp, weak).status_code == 422
    assert reset(client, email, otp).status_code == 204


@pytest.mark.database
def test_codes_of_different_purposes_are_not_interchangeable(client: TestClient, sender: FakeSender, auth_engine) -> None:
    email, _ = create_user(auth_engine)
    forgot(client, email)
    reset_otp = sender.resets[-1][1]
    registration = client.post("/api/v1/auth/register/verify-otp", json={"email": email, "otp": reset_otp})
    assert registration.status_code == 400
    fresh = new_email()
    client.post("/api/v1/auth/register/request-otp", json={"email": fresh, "password": OLD})
    assert reset(client, fresh, sender.last_otp).status_code == 400  # a sign-up code cannot reset anything


@pytest.mark.database
def test_concurrent_resets_apply_once(client: TestClient, sender: FakeSender, auth_engine, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_PASSWORD_PER_MINUTE", "50")
    email, _ = create_user(auth_engine)
    forgot(client, email)
    otp = sender.resets[-1][1]
    passwords = [f"Pa55!word-{i}-Aa" for i in range(8)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(lambda p: reset(client, email, otp, p).status_code, passwords))
    assert statuses.count(204) == 1 and statuses.count(400) == 7
    winners = [p for p in passwords if verify_password(p, stored_hash(auth_engine, email))]
    assert len(winners) == 1


@pytest.mark.database
def test_reset_rate_limit(client: TestClient, sender: FakeSender, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_PASSWORD_PER_MINUTE", "2")
    email = new_email()
    assert [reset(client, email, "123456").status_code for _ in range(2)] == [400, 400]
    limited = reset(client, email, "123456")
    assert limited.status_code == 429 and "retry-after" in limited.headers


@pytest.mark.database
def test_no_secrets_in_logs_or_responses(client: TestClient, sender: FakeSender, auth_engine, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_PASSWORD_PER_MINUTE", "50")
    caplog.set_level(logging.DEBUG)
    email, _ = create_user(auth_engine)
    texts = [forgot(client, email).text]
    otp = sender.resets[-1][1]
    texts += [reset(client, email, wrong_for(otp)).text, reset(client, email, otp, "weak").text, reset(client, email, otp).text]
    joined = "\n".join(texts) + caplog.text
    assert otp not in joined and NEW not in joined and OLD not in joined and "weak" not in joined.replace("weak_password", "")


# --- change -------------------------------------------------------------------------------------

def change(client: TestClient, current: str, new: str, headers: dict | None = None):
    return client.post(CHANGE, json={"current_password": current, "new_password": new}, headers=headers if headers is not None else csrf_headers(client))


@pytest.mark.database
def test_change_ends_every_session_including_this_one(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    other = TestClient(client.app)
    login(other, email, password)
    login(client, email, password)
    old_access = client.cookies.get(ACCESS_TOKEN_COOKIE)

    response = change(client, password, NEW)
    assert response.status_code == 204
    assert client.get(ME).status_code == 401 and other.get(ME).status_code == 401
    replay = TestClient(client.app)
    replay.cookies.set(ACCESS_TOKEN_COOKIE, old_access)
    assert replay.get(ME).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": email, "password": password}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": email, "password": NEW}).status_code == 200


@pytest.mark.database
def test_change_refuses_wrong_current_password_with_400_not_401(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    login(client, email, password)
    response = change(client, "Not-the-password1!", NEW)
    assert response.status_code == 400 and response.json()["detail"] == WRONG_CURRENT_MESSAGE
    assert client.get(ME).status_code == 200  # the session is untouched
    assert verify_password(password, stored_hash(auth_engine, email))


@pytest.mark.database
def test_change_refuses_same_and_weak_passwords(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    login(client, email, password)
    same = change(client, password, password)
    assert same.status_code == 400 and same.json()["detail"] == SAME_PASSWORD_MESSAGE
    for weak in ("Sh0rt!", "lowercase1!", "NoDigitsHere!", "NoSpecial123"):
        assert change(client, password, weak).status_code == 422
    assert client.get(ME).status_code == 200


@pytest.mark.database
def test_change_needs_login_and_csrf(client: TestClient, auth_engine) -> None:
    assert client.post(CHANGE, json={"current_password": OLD, "new_password": NEW}).status_code == 401
    email, password = create_user(auth_engine)
    login(client, email, password)
    assert change(client, password, NEW, headers={}).status_code == 403
    assert change(client, password, NEW, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert client.get(ME).status_code == 200
    assert client.post(CHANGE, json={"current_password": password, "new_password": NEW, "role": "ADMIN"}, headers=csrf_headers(client)).status_code == 422


@pytest.mark.database
def test_change_rate_limit(client: TestClient, auth_engine, monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, "RATE_LIMIT_PASSWORD_PER_MINUTE", "2")
    email, password = create_user(auth_engine)
    login(client, email, password)
    assert [change(client, "Wrong-one1!", NEW).status_code for _ in range(2)] == [400, 400]
    limited = change(client, "Wrong-one1!", NEW)
    assert limited.status_code == 429 and 1 <= int(limited.headers["retry-after"]) <= 60


@pytest.mark.database
def test_change_leaves_nothing_in_logs(client: TestClient, auth_engine, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    email, password = create_user(auth_engine)
    login(client, email, password)
    response = change(client, password, NEW)
    assert password not in caplog.text and NEW not in caplog.text and NEW not in response.text
