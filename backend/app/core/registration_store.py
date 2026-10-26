import hashlib
import hmac
import secrets
from dataclasses import dataclass
from enum import Enum

from fastapi import HTTPException
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings


PENDING_NAMESPACE = "registration:pending"
COOLDOWN_NAMESPACE = "registration:cooldown"

# KEYS[1] pending hash; ARGV: otp_hash, max_attempts.
# Returns {0} missing/expired, {1} locked out (key deleted), {2, password_hash} correct (key deleted),
# {3} wrong. One script means two concurrent verifies can never both consume the same OTP.
_VERIFY = """
local data = redis.call('HMGET', KEYS[1], 'otp_hash', 'password_hash')
if not data[1] then return {0} end
if data[1] == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {2, data[2]}
end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return {1}
end
return {3}
"""

# KEYS[1] pending hash; ARGV: new otp_hash, ttl. Replaces the OTP only if a pending record exists.
_REPLACE_OTP = """
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'otp_hash', ARGV[1], 'attempts', 0)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
"""


class VerifyOutcome(str, Enum):
    MISSING = "missing"
    LOCKED = "locked"
    WRONG = "wrong"
    OK = "ok"


@dataclass(frozen=True)
class VerifyResult:
    outcome: VerifyOutcome
    password_hash: str | None = None


def _unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="Dịch vụ đăng ký tạm thời không khả dụng. Vui lòng thử lại sau.")


def _hmac(label: str, value: str) -> str:
    key = get_settings().otp_hmac_key
    if not key:
        raise _unavailable()
    return hmac.new(key.encode(), f"{label}:{value}".encode(), hashlib.sha256).hexdigest()


def email_id(email: str) -> str:
    # Redis never sees the plaintext email.
    return _hmac("email", email)


def hash_otp(email: str, otp: str) -> str:
    return _hmac("otp", f"{email_id(email)}:{otp}")


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _require(redis: Redis | None) -> Redis:
    if redis is None:
        raise _unavailable()
    return redis


def acquire_cooldown(redis: Redis | None, email: str) -> int:
    """Returns 0 when the cooldown was started, otherwise the seconds still to wait."""
    client = _require(redis)
    key = f"{COOLDOWN_NAMESPACE}:{email_id(email)}"
    seconds = get_settings().otp_resend_cooldown_seconds
    try:
        if client.set(key, "1", nx=True, ex=seconds):
            return 0
        return max(1, int(client.ttl(key)))
    except RedisError:
        raise _unavailable() from None


def release_cooldown(redis: Redis | None, email: str) -> None:
    try:
        _require(redis).delete(f"{COOLDOWN_NAMESPACE}:{email_id(email)}")
    except RedisError:
        pass


def save_pending(redis: Redis | None, email: str, password_hash: str, otp: str) -> None:
    client = _require(redis)
    key = f"{PENDING_NAMESPACE}:{email_id(email)}"
    try:
        with client.pipeline() as pipe:
            pipe.delete(key)
            pipe.hset(key, mapping={"password_hash": password_hash, "otp_hash": hash_otp(email, otp), "attempts": 0})
            pipe.expire(key, get_settings().otp_ttl_seconds)
            pipe.execute()
    except RedisError:
        raise _unavailable() from None


def delete_pending(redis: Redis | None, email: str) -> None:
    try:
        _require(redis).delete(f"{PENDING_NAMESPACE}:{email_id(email)}")
    except RedisError:
        pass


def replace_otp(redis: Redis | None, email: str, otp: str) -> bool:
    client = _require(redis)
    try:
        result = client.eval(
            _REPLACE_OTP, 1, f"{PENDING_NAMESPACE}:{email_id(email)}", hash_otp(email, otp), get_settings().otp_ttl_seconds
        )
    except RedisError:
        raise _unavailable() from None
    return int(result) == 1


def verify_pending(redis: Redis | None, email: str, otp: str) -> VerifyResult:
    client = _require(redis)
    settings = get_settings()
    try:
        result = client.eval(
            _VERIFY, 1, f"{PENDING_NAMESPACE}:{email_id(email)}", hash_otp(email, otp), settings.otp_max_attempts
        )
    except RedisError:
        raise _unavailable() from None
    code = int(result[0])
    if code == 2:
        return VerifyResult(VerifyOutcome.OK, result[1])
    return VerifyResult({0: VerifyOutcome.MISSING, 1: VerifyOutcome.LOCKED}.get(code, VerifyOutcome.WRONG))
