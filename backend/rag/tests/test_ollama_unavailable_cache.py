"""Ollama unavailable cache: refused connections are not retried within the TTL; success resets it.
No Ollama needed (urlopen is faked), plus one real check against a closed local port."""

import socket
import time
import urllib.error
import urllib.request
from unittest.mock import MagicMock

import pytest

from backend.rag import server


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    monkeypatch.setattr(server, "_ollama_down_until", 0.0)
    monkeypatch.setattr(server, "OLLAMA_UNAVAILABLE_CACHE_SECONDS", 15.0)


def refused():
    return urllib.error.URLError(ConnectionRefusedError(10061, "refused"))


def test_refused_connection_is_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(server.urllib.request, "urlopen", lambda req, timeout: calls.append(1) or (_ for _ in ()).throw(refused()))
    with pytest.raises(urllib.error.URLError):
        server.ollama_urlopen("req", timeout=5)
    with pytest.raises(server.OllamaUnavailableError):
        server.ollama_urlopen("req", timeout=5)
    assert len(calls) == 1  # second call never touched the network


def test_success_resets_and_ttl_expiry_retries(monkeypatch):
    resp = MagicMock()
    monkeypatch.setattr(server, "_ollama_down_until", time.monotonic() - 1)  # TTL already expired
    monkeypatch.setattr(server.urllib.request, "urlopen", lambda req, timeout: resp)
    assert server.ollama_urlopen("req", timeout=5) is resp
    assert server._ollama_down_until == 0.0


@pytest.mark.parametrize("err", [socket.timeout("timed out"), TimeoutError("read timed out"),
                                 urllib.error.HTTPError("u", 500, "busy", {}, None)])
def test_timeouts_and_http_errors_do_not_mark_down(monkeypatch, err):
    monkeypatch.setattr(server.urllib.request, "urlopen", lambda req, timeout: (_ for _ in ()).throw(err))
    with pytest.raises(type(err)):
        server.ollama_urlopen("req", timeout=5)
    assert server._ollama_down_until == 0.0


def test_probe_ignores_cache(monkeypatch):
    monkeypatch.setattr(server, "_ollama_down_until", time.monotonic() + 60)
    resp = MagicMock()
    monkeypatch.setattr(server.urllib.request, "urlopen", lambda req, timeout: resp)
    assert server.ollama_urlopen("req", timeout=3, probe=True) is resp
    assert server._ollama_down_until == 0.0  # a successful probe clears the state


def test_cache_disabled_with_zero_ttl(monkeypatch):
    monkeypatch.setattr(server, "OLLAMA_UNAVAILABLE_CACHE_SECONDS", 0.0)
    calls = []
    monkeypatch.setattr(server.urllib.request, "urlopen", lambda req, timeout: calls.append(1) or (_ for _ in ()).throw(refused()))
    for _ in range(2):
        with pytest.raises(urllib.error.URLError):
            server.ollama_urlopen("req", timeout=5)
    assert len(calls) == 2


def test_real_closed_port_second_embedding_is_immediate(monkeypatch):
    # A genuinely closed local port (Ollama not running). On Windows each refused attempt costs ~2s.
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]  # closed once the socket is released
    monkeypatch.setattr(server, "OLLAMA_BASE_URL", f"http://127.0.0.1:{port}")
    t0 = time.perf_counter(); assert server.get_query_embedding("hello", timeout=5) is None; first = time.perf_counter() - t0
    t1 = time.perf_counter(); assert server.get_query_embedding("hello", timeout=5) is None; second = time.perf_counter() - t1
    print(f"\nfirst (real refused connect): {first:.3f}s, second (cached): {second:.4f}s")
    assert second < 0.05


def test_server_generated_session_ids_are_unpredictable(monkeypatch):
    import asyncio
    import hashlib
    import re
    monkeypatch.setattr(server, "_ollama_down_until", time.monotonic() + 60)  # skip Ollama: fast local answer
    ids = set()
    for _ in range(3):  # same query, same second
        resp = asyncio.run(server.chat_endpoint(server.ChatRequest(message="hi")))
        sid = resp["session_id"] if isinstance(resp, dict) else getattr(resp, "session_id", None)
        assert sid and re.fullmatch(r"sess_[0-9a-f]{32}", sid), sid
        ids.add(sid)
    assert len(ids) == 3
    old_style = f"sess_{int(time.time())}_{hashlib.md5(b'hi').hexdigest()[:8]}"
    assert old_style not in ids
