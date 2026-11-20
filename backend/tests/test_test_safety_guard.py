"""Self-test for backend/conftest.py (Python test-safety guard). Uses no real service: 192.0.2.0/24 is a
reserved, never-routable documentation range, and the .env file used here is a temporary fixture."""

import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv

LIVE = os.environ.get("INFERXE_LIVE_SUPABASE_TESTS") == "1"
pytestmark = pytest.mark.skipif(LIVE, reason="guard is intentionally off for live integration runs")

BACKEND_DIR = Path(__file__).resolve().parents[1]


CREDENTIAL_VARS = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL",
                   "SUPABASE_DATABASE_URL", "NOTIFICATIONS_DATABASE_URL")


def _non_empty_credentials():
    """Credential variables holding something that could reach a real system. Keys: any value. URLs: anything
    but SQLite or loopback (test modules legitimately set DATABASE_URL=sqlite:///:memory:). Names only: assertion
    messages must never print values."""
    import isolation_guard
    from urllib.parse import urlsplit
    unsafe = []
    for name in CREDENTIAL_VARS:
        value = os.environ.get(name) or ""
        if not value:
            continue
        if name.endswith("_URL"):
            if value.startswith("sqlite") or isolation_guard.is_loopback(urlsplit(value).hostname):
                continue
        unsafe.append(name)
    return unsafe


def test_production_credentials_are_neutralised():
    assert _non_empty_credentials() == []


def test_importing_service_modules_does_not_reintroduce_credentials():
    import importlib
    for module in ("backend.notifications.auth", "backend.database.supabase_client", "backend.rag.server"):
        importlib.import_module(module)
    assert _non_empty_credentials() == []


def test_database_driver_is_refused_for_non_local_hosts(monkeypatch):
    from backend.notifications import db
    calls = []
    monkeypatch.setattr(db.psycopg2, "connect", lambda **kw: calls.append(kw))
    pool = db._ConnectionPool(1, host="aws-0-ap-south-1.pooler.supabase.com", port=5432, dbname="postgres")
    with pytest.raises(RuntimeError, match="test-safety"):
        pool.getconn(timeout=1)
    assert calls == []  # refused before the driver was called
    assert pool._slots.acquire(timeout=0)  # the pool slot was released


def test_load_dotenv_cannot_reintroduce_credentials(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=fake\n")
    load_dotenv(env_file, override=False)  # what the service modules do on import
    assert _non_empty_credentials() == []


def test_non_loopback_connections_and_dns_are_blocked():
    with pytest.raises(ConnectionRefusedError, match="test-safety"):
        socket.create_connection(("192.0.2.1", 443), timeout=1)
    with pytest.raises(ConnectionRefusedError, match="test-safety"):
        socket.getaddrinfo("abcdefghijklmnopqrst.supabase.co", 443)


def test_loopback_connections_still_work():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    try:
        client = socket.create_connection(server.getsockname(), timeout=2)
        client.close()
    finally:
        server.close()


def test_shell_exported_production_url_stops_the_run_before_any_test():
    env = {**os.environ, "SUPABASE_URL": "https://abcdefghijklmnopqrst.supabase.co"}
    env.pop("INFERXE_LIVE_SUPABASE_TESTS", None)
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", str(BACKEND_DIR / "inference" / "tests" / "test_last_used_throttle.py")],
        env=env, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode != 0
    output = result.stdout + result.stderr
    assert "SUPABASE_URL in the environment is not loopback (supabase project)" in output
    assert "abcdefghijklmnopqrst" not in output  # category only, never the host
    assert "passed" not in result.stdout


# ── Runner-independence, live mode and message hygiene (backend/isolation_guard.py) ──────────────

REPO_ROOT = BACKEND_DIR.parent
FAKE_LIVE_URL = "https://live-test-project-fake.supabase.co"  # never contacted: only blocked targets are probed

PROBE = '''
import os, socket, sys
sys.path[:0] = [{root!r}, {backend!r}]
import backend.notifications.auth  # a service module: loads .env only through isolation_guard.load_dotenv
expected_key = os.environ.get("EXPECT_SERVICE_KEY", "")
names = [n for n in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL")
         if os.environ.get(n) and not (n == "SUPABASE_SERVICE_ROLE_KEY" and expected_key and os.environ[n] == expected_key)]
expected_url = os.environ.get("EXPECT_SUPABASE_URL", "")
url_ok = os.environ.get("SUPABASE_URL", "") == expected_url
blocked = []
for target in [("192.0.2.1", 443)]:
    try:
        socket.create_connection(target, timeout=1)
    except ConnectionRefusedError as e:
        blocked.append("test-safety" in str(e) and "192.0.2.1" not in str(e))
try:
    socket.getaddrinfo("prod-project-fake.supabase.co", 443)
    blocked.append(False)
except ConnectionRefusedError as e:
    blocked.append("supabase project" in str(e) and "prod-project-fake" not in str(e))
print("PROBE", "creds=" + ",".join(names), "url_ok=" + str(url_ok), "blocked=" + str(all(blocked) and len(blocked) == 2))
'''


def _clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PYTEST", "INFERXE_LIVE", "_PYTEST"))}
    for name in CREDENTIAL_VARS:
        env.pop(name, None)  # as in a fresh shell: nothing exported
    env.update(extra)
    return env


def _write_probe(directory, filename):
    path = directory / filename
    path.write_text(PROBE.format(root=str(REPO_ROOT), backend=str(BACKEND_DIR)))
    return path


def test_unittest_runner_gets_the_guard(tmp_path):
    _write_probe(tmp_path, "test_probe_case.py")
    result = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(tmp_path), "-p", "test_probe_case.py"],
                            env=_clean_env(), capture_output=True, text=True, timeout=120)
    assert "PROBE creds= url_ok=True blocked=True" in result.stdout + result.stderr


def test_test_script_run_directly_gets_the_guard(tmp_path):
    probe = _write_probe(tmp_path, "test_probe_direct.py")
    result = subprocess.run([sys.executable, str(probe)], env=_clean_env(), capture_output=True, text=True, timeout=120)
    assert "PROBE creds= url_ok=True blocked=True" in result.stdout


def test_ordinary_process_is_unaffected(tmp_path):
    fixture = tmp_path / "fixture.env"
    fixture.write_text("INFERXE_FIXTURE=loaded\n")
    script = tmp_path / "serve_probe.py"
    script.write_text(
        f"import os, sys\nsys.path.append({str(BACKEND_DIR)!r})\nimport isolation_guard as g\n"
        f"g.load_dotenv({str(fixture)!r})\n"
        "print('ORDINARY', g.is_test_process(), g.guard_installed(), os.environ.get('INFERXE_FIXTURE'))\n")
    result = subprocess.run([sys.executable, str(script)], env=_clean_env(), capture_output=True, text=True, timeout=120)
    assert "ORDINARY False False loaded" in result.stdout


def test_live_mode_requires_an_explicit_non_production_target(monkeypatch):
    import isolation_guard as g
    monkeypatch.setenv("INFERXE_LIVE_SUPABASE_TESTS", "1")
    monkeypatch.delenv("INFERXE_LIVE_SUPABASE_URL", raising=False)
    monkeypatch.delenv("INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(g.IsolationError, match="INFERXE_LIVE_SUPABASE_URL"):
        g.validate_live_target()

    monkeypatch.setenv("INFERXE_LIVE_SUPABASE_URL", "https://prod-listed-fake.supabase.co")
    monkeypatch.setenv("INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY", "fake-live-key")
    monkeypatch.setenv("INFERXE_PRODUCTION_SUPABASE_HOSTS", "prod-listed-fake.supabase.co")
    with pytest.raises(g.IsolationError) as info:
        g.validate_live_target()
    assert "prod-listed-fake" not in str(info.value)

    monkeypatch.setenv("INFERXE_LIVE_SUPABASE_URL", FAKE_LIVE_URL)
    assert g.validate_live_target() == "live-test-project-fake.supabase.co"


def test_live_mode_refuses_the_project_configured_in_backend_env(monkeypatch):
    import isolation_guard as g
    prod_hosts, prod_keys = g._production_targets()  # read from the .env files, never exported or printed
    if not prod_hosts:
        pytest.skip("no project .env file with SUPABASE_URL on this machine")
    monkeypatch.setenv("INFERXE_LIVE_SUPABASE_TESTS", "1")
    monkeypatch.delenv("INFERXE_PRODUCTION_SUPABASE_HOSTS", raising=False)
    monkeypatch.setenv("INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY", "fake-live-key")
    monkeypatch.setenv("INFERXE_LIVE_SUPABASE_URL", "https://" + next(iter(prod_hosts)))
    with pytest.raises(g.IsolationError) as info:
        g.validate_live_target()
    assert next(iter(prod_hosts)) not in str(info.value)
    if prod_keys:
        monkeypatch.setenv("INFERXE_LIVE_SUPABASE_URL", FAKE_LIVE_URL)
        monkeypatch.setenv("INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY", next(iter(prod_keys)))
        with pytest.raises(g.IsolationError):
            g.validate_live_target()


def test_live_mode_keeps_the_guard_on_for_everything_but_the_named_project(tmp_path):
    probe = _write_probe(tmp_path, "test_probe_live.py")
    env = _clean_env(INFERXE_LIVE_SUPABASE_TESTS="1", INFERXE_LIVE_SUPABASE_URL=FAKE_LIVE_URL,
                     INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY="fake-live-key", EXPECT_SUPABASE_URL=FAKE_LIVE_URL,
                     EXPECT_SERVICE_KEY="fake-live-key")
    result = subprocess.run([sys.executable, str(probe)], env=env, capture_output=True, text=True, timeout=120)
    # Production credentials stay out, SUPABASE_URL is the named live project, other hosts remain blocked.
    assert "PROBE creds= url_ok=True blocked=True" in result.stdout


def test_live_mode_with_production_target_fails_before_any_test(tmp_path):
    probe = _write_probe(tmp_path, "test_probe_live_prod.py")
    env = _clean_env(INFERXE_LIVE_SUPABASE_TESTS="1", INFERXE_LIVE_SUPABASE_URL="https://prod-listed-fake.supabase.co",
                     INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY="fake-live-key",
                     INFERXE_PRODUCTION_SUPABASE_HOSTS="prod-listed-fake.supabase.co")
    result = subprocess.run([sys.executable, str(probe)], env=env, capture_output=True, text=True, timeout=120)
    output = result.stdout + result.stderr
    assert result.returncode != 0 and "PROBE" not in result.stdout
    assert "production Supabase project" in output and "prod-listed-fake" not in output
