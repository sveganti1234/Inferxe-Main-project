"""INFERXE_TEST_MODE (unsigned JWTs) is honoured only inside a test runner and never in production."""

import base64
import json
import sys

import pytest
from fastapi import HTTPException

from inference import auth


def unsigned_jwt(sub="attacker-chosen-sub"):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{enc({'alg': 'none'})}.{enc({'sub': sub, 'token_use': 'id'})}.sig"


def test_enabled_in_test_runner(monkeypatch):
    monkeypatch.setenv("INFERXE_TEST_MODE", "1")
    monkeypatch.delenv("INFERXE_ENV", raising=False)
    assert auth.test_mode_enabled() is True


@pytest.mark.parametrize("env", ["production", "PROD", "staging"])
def test_disabled_in_production_like_environments(monkeypatch, env):
    monkeypatch.setenv("INFERXE_TEST_MODE", "1")
    monkeypatch.setenv("INFERXE_ENV", env)
    assert auth.test_mode_enabled() is False


def test_disabled_outside_a_test_runner(monkeypatch):
    monkeypatch.setenv("INFERXE_TEST_MODE", "1")
    monkeypatch.delenv("INFERXE_ENV", raising=False)
    monkeypatch.delitem(sys.modules, "pytest", raising=False)
    monkeypatch.delitem(sys.modules, "unittest", raising=False)
    assert auth.test_mode_enabled() is False


def test_unsigned_token_rejected_when_safeguard_blocks_test_mode(monkeypatch):
    monkeypatch.setenv("INFERXE_TEST_MODE", "1")
    monkeypatch.setenv("INFERXE_ENV", "production")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "ap-south-1_testpool")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "test_client_id")
    signature_checked = []

    def no_network_jwks(url):  # the verified path asks for signing keys; no real Cognito call in tests
        signature_checked.append(url)
        raise RuntimeError("no network in tests")

    monkeypatch.setattr(auth, "_get_jwks_client", no_network_jwks)
    with pytest.raises(HTTPException) as info:
        auth.verify_cognito_jwt(unsigned_jwt())
    assert info.value.status_code in (401, 503)  # rejected, never accepted
    assert signature_checked  # it went down the signature-verifying path, not the test-mode shortcut
