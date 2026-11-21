"""The vector store is opened at startup (in the background) instead of on the first chat request.
Fake chromadb module and patched startup steps: no real store, database or network is touched."""

import asyncio
import logging
import sys
import threading
import time
import types

import pytest

from backend.rag import server


class FakeClient:
    instances = []
    delay = 0.0
    fail = False

    def __init__(self, path):
        if FakeClient.fail:
            raise RuntimeError("store unavailable")
        time.sleep(FakeClient.delay)
        FakeClient.instances.append(self)

    def get_collection(self, name):
        return ("collection", name, id(self))


@pytest.fixture(autouse=True)
def fake_chromadb(monkeypatch):
    FakeClient.instances, FakeClient.delay, FakeClient.fail = [], 0.0, False
    monkeypatch.setitem(sys.modules, "chromadb", types.SimpleNamespace(PersistentClient=FakeClient))
    monkeypatch.setattr(server, "_collection", None)
    monkeypatch.setattr(server, "_chroma_client", None)


def test_successful_warm_up_opens_store_once_and_requests_reuse_it():
    assert server.warm_up_vector_store() is True
    warmed = server._collection
    assert warmed is not None and len(FakeClient.instances) == 1
    for _ in range(3):  # later chat requests
        assert server.get_chroma_collection() is warmed
    assert len(FakeClient.instances) == 1


def test_failed_warm_up_does_not_raise_and_first_request_recovers(caplog):
    FakeClient.fail = True
    with caplog.at_level(logging.WARNING, logger="inferxe.rag"):
        assert server.warm_up_vector_store() is False
    assert server._collection is None
    assert "Vector store warm-up failed" in caplog.text
    FakeClient.fail = False  # store becomes available
    assert server.get_chroma_collection() is not None  # first request opens it, as before
    assert len(FakeClient.instances) == 1


def test_request_during_warm_up_waits_and_shares_the_same_store():
    FakeClient.delay = 0.3
    t = threading.Thread(target=server.warm_up_vector_store)
    t.start()
    time.sleep(0.05)  # warm-up now holds the lock
    from_request = server.get_chroma_collection()
    t.join(5)
    assert from_request is server._collection
    assert len(FakeClient.instances) == 1


def _run_lifespan(main):
    async def go():
        t0 = time.perf_counter()
        async with main.lifespan(main.app):
            entered = time.perf_counter() - t0
        return entered
    return asyncio.run(go())


def test_startup_launches_warm_up_without_blocking(monkeypatch):
    from backend.notifications import main
    ran = threading.Event()
    def slow_warm_up():
        time.sleep(0.5); ran.set(); return True
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(main, "close_pool", lambda: None)
    monkeypatch.setattr(main, "RAG_MOUNTED", True)
    monkeypatch.setattr(server, "warm_up_vector_store", slow_warm_up)
    entered = _run_lifespan(main)
    assert entered < 0.3  # startup did not wait for the 0.5 s warm-up
    assert ran.wait(3)    # but the warm-up did run


def test_startup_survives_warm_up_failure(monkeypatch):
    from backend.notifications import main
    FakeClient.fail = True
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(main, "close_pool", lambda: None)
    monkeypatch.setattr(main, "RAG_MOUNTED", True)
    _run_lifespan(main)  # must not raise
    thread = next((t for t in threading.enumerate() if t.name == "vector-store-warmup"), None)
    if thread:
        thread.join(3)
    assert server._collection is None  # left for the first request to retry


def test_no_warm_up_when_rag_not_mounted(monkeypatch):
    from backend.notifications import main
    monkeypatch.setattr(main, "RAG_MOUNTED", False)
    assert main._start_vector_store_warmup() is None


def test_standalone_rag_app_warms_up_at_startup_without_blocking(monkeypatch):
    ran = threading.Event()
    def slow_warm_up():
        time.sleep(0.5); ran.set(); return True
    monkeypatch.setattr(server, "warm_up_vector_store", slow_warm_up)
    async def go():
        t0 = time.perf_counter()
        async with server.app.router.lifespan_context(server.app):
            return time.perf_counter() - t0
    entered = asyncio.run(go())
    assert entered < 0.3 and ran.wait(3)
