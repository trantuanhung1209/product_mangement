import hashlib
import hmac
import secrets
from dataclasses import dataclass
from enum import Enum

from fastapi import HTTPException
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings


# An OTP belongs to one purpose. Namespaces and the HMAC label both include it, so a code issued for
# sign-up can never be accepted for a password reset (or the other way round).
REGISTRATION = "registration"
PASSWORD_RESET = "password-reset"

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

# Same as _VERIFY but a correct code is left in place: {0} missing, {1} locked out (key deleted),
# {2} correct, {3} wrong. The caller finishes with _CONSUME once its other checks pass.
_CHECK = """
local data = redis.call('HMGET', KEYS[1], 'otp_hash')
if not data[1] then return 0 end
if data[1] == ARGV[1] then return 2 end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return 1
end
return 3
"""

# Deletes the pending record only if it still holds this exact OTP: exactly one caller gets 1.
_CONSUME = """
if redis.call('HGET', KEYS[1], 'otp_hash') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
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


def hash_otp(email: str, otp: str, purpose: str = REGISTRATION) -> str:
    return _hmac(f"otp:{purpose}", f"{email_id(email)}:{otp}")


def _pending_key(email: str, purpose: str) -> str:
    return f"{purpose}:pending:{email_id(email)}"


def _cooldown_key(email: str, purpose: str) -> str:
    return f"{purpose}:cooldown:{email_id(email)}"


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _require(redis: Redis | None) -> Redis:
    if redis is None:
        raise _unavailable()
    return redis


def acquire_cooldown(redis: Redis | None, email: str, purpose: str = REGISTRATION) -> int:
    """Returns 0 when the cooldown was started, otherwise the seconds still to wait."""
    client = _require(redis)
    key = _cooldown_key(email, purpose)
    seconds = get_settings().otp_resend_cooldown_seconds
    try:
        if client.set(key, "1", nx=True, ex=seconds):
            return 0
        return max(1, int(client.ttl(key)))
    except RedisError:
        raise _unavailable() from None


def release_cooldown(redis: Redis | None, email: str, purpose: str = REGISTRATION) -> None:
    try:
        _require(redis).delete(_cooldown_key(email, purpose))
    except RedisError:
        pass


def save_pending(redis: Redis | None, email: str, password_hash: str, otp: str, purpose: str = REGISTRATION) -> None:
    client = _require(redis)
    key = _pending_key(email, purpose)
    try:
        with client.pipeline() as pipe:
            pipe.delete(key)
            pipe.hset(key, mapping={"password_hash": password_hash, "otp_hash": hash_otp(email, otp, purpose), "attempts": 0})
            pipe.expire(key, get_settings().otp_ttl_seconds)
            pipe.execute()
    except RedisError:
        raise _unavailable() from None


def delete_pending(redis: Redis | None, email: str, purpose: str = REGISTRATION) -> None:
    try:
        _require(redis).delete(_pending_key(email, purpose))
    except RedisError:
        pass


def replace_otp(redis: Redis | None, email: str, otp: str, purpose: str = REGISTRATION) -> bool:
    client = _require(redis)
    try:
        result = client.eval(
            _REPLACE_OTP, 1, _pending_key(email, purpose), hash_otp(email, otp, purpose), get_settings().otp_ttl_seconds
        )
    except RedisError:
        raise _unavailable() from None
    return int(result) == 1


def verify_pending(redis: Redis | None, email: str, otp: str, purpose: str = REGISTRATION) -> VerifyResult:
    client = _require(redis)
    settings = get_settings()
    try:
        result = client.eval(
            _VERIFY, 1, _pending_key(email, purpose), hash_otp(email, otp, purpose), settings.otp_max_attempts
        )
    except RedisError:
        raise _unavailable() from None
    code = int(result[0])
    if code == 2:
        return VerifyResult(VerifyOutcome.OK, result[1])
    return VerifyResult({0: VerifyOutcome.MISSING, 1: VerifyOutcome.LOCKED}.get(code, VerifyOutcome.WRONG))


def check_pending(redis: Redis | None, email: str, otp: str, purpose: str) -> VerifyOutcome:
    """Validates an OTP and counts wrong attempts, but does not consume a correct one."""
    client = _require(redis)
    try:
        code = int(client.eval(
            _CHECK, 1, _pending_key(email, purpose), hash_otp(email, otp, purpose), get_settings().otp_max_attempts
        ))
    except RedisError:
        raise _unavailable() from None
    return {0: VerifyOutcome.MISSING, 1: VerifyOutcome.LOCKED, 2: VerifyOutcome.OK}.get(code, VerifyOutcome.WRONG)


def consume_pending(redis: Redis | None, email: str, otp: str, purpose: str) -> bool:
    client = _require(redis)
    try:
        return int(client.eval(_CONSUME, 1, _pending_key(email, purpose), hash_otp(email, otp, purpose))) == 1
    except RedisError:
        raise _unavailable() from None
