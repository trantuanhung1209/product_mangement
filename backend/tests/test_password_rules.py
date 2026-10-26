import json
from pathlib import Path

import pytest

from app.core import otp_store
from app.schemas.password_rules import password_problems


CASES_FILE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "passwordCases.json"
CASES = [(case["password"], case["problems"]) for case in json.loads(CASES_FILE.read_text(encoding="utf-8"))]


# The frontend test reads the same file, so the two implementations cannot drift apart unnoticed.
@pytest.mark.parametrize(("password", "count"), CASES)
def test_shared_password_cases(password: str, count: int) -> None:
    assert len(password_problems(password)) == count


def test_an_otp_hash_is_bound_to_its_purpose() -> None:
    registration = otp_store.hash_otp("a@example.com", "123456", otp_store.REGISTRATION)
    reset = otp_store.hash_otp("a@example.com", "123456", otp_store.PASSWORD_RESET)
    assert registration != reset
