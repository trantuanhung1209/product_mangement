from pydantic_core import PydanticCustomError


PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < PASSWORD_MIN_LENGTH:
        problems.append(f"Mật khẩu phải có ít nhất {PASSWORD_MIN_LENGTH} ký tự.")
    if not any(ch.isupper() for ch in password):
        problems.append("Mật khẩu phải có ít nhất 1 chữ hoa.")
    if not any("0" <= ch <= "9" for ch in password):
        problems.append("Mật khẩu phải có ít nhất 1 chữ số.")
    if not any(not ch.isalnum() for ch in password):
        problems.append("Mật khẩu phải có ít nhất 1 ký tự đặc biệt.")
    return problems


def require_strong_password(value: str) -> str:
    """The one place a new password is validated: sign-up, reset and change all call this."""
    problems = password_problems(value)
    if problems:
        raise PydanticCustomError("weak_password", problems[0])
    return value
