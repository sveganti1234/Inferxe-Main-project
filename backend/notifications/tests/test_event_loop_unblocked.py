"""
B1 regression tests: blocking work in the RAG chat path and in auth must not freeze the
notifications event loop. No network/database: the RAG handler and DBConnection are faked.
Run from the repo root:  python -m pytest backend/notifications/tests/test_event_loop_unblocked.py -q
"""

import asyncio
import inspect
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.notifications import auth, main

pytestmark = pytest.mark.skipif(not main.RAG_MOUNTED, reason="RAG routes not mounted in this environment")


class FastDB:
    def __init__(self, autocommit=True, **kwargs):
        pass

    def __enter__(self):
        raise RuntimeError("no database in tests")  # /health reports degraded, quickly

    def __exit__(self, *exc):
        return False


def test_auth_dependencies_are_sync():
    # Sync dependencies run in the threadpool; async ones would run the blocking JWKS fetch on the loop.
    for dep in (auth.get_current_user, auth.require_admin_user, auth.get_optional_user):
        assert not inspect.iscoroutinefunction(dep), dep.__name__


def test_rag_wrappers_are_sync_routes():
    names = {"chat_handler", "chat_history_handler", "chat_sessions_handler",
             "documents_metadata_handler", "documents_upload_handler", "supabase_status_handler"}
    found = {r.endpoint.__name__: r.endpoint for r in main.app.routes if getattr(r, "endpoint", None)
             and r.endpoint.__name__ in names}
    assert set(found) == names
    assert not any(inspect.iscoroutinefunction(fn) for fn in found.values())


def test_health_answers_while_slow_chat_is_in_flight(monkeypatch):
    async def slow_chat(payload, **_):  # also receives retrieval_organization_id
        time.sleep(1.5)  # blocking, like the real Ollama/ChromaDB calls
        return {"response": "ok"}

    monkeypatch.setattr(main, "chat_endpoint", slow_chat)
    monkeypatch.setattr(main, "get_supabase_client", lambda: None)
    monkeypatch.setattr(main, "DBConnection", FastDB)

    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            t0 = time.perf_counter()
            chat = asyncio.create_task(client.post("/api/chat", json={"message": "hello"}))
            await asyncio.sleep(0.2)  # let the chat request reach its blocking handler
            health = await client.get("/health")
            # Measured from chat start: ~0.2s if the loop stays free, >=1.5s if chat blocked it.
            health_latency = time.perf_counter() - t0
            chat_res = await chat
            return health, health_latency, chat_res

    health, latency, chat_res = asyncio.run(scenario())
    assert health.status_code == 200
    assert latency < 0.8, f"/health waited {latency:.2f}s behind the chat request"
    assert chat_res.status_code == 200, chat_res.text  # the slow handler really ran
    assert chat_res.json() == {"response": "ok"}


def test_chat_concurrency_limit_returns_503_and_keeps_wallet_api_responsive(monkeypatch):
    import threading as _threading

    release = _threading.Event()

    async def blocking_chat(payload, **_):  # also receives retrieval_organization_id
        release.wait(5)  # holds its chat slot until the test releases it
        return {"response": "ok"}

    monkeypatch.setattr(main, "chat_endpoint", blocking_chat)
    monkeypatch.setattr(main, "get_supabase_client", lambda: None)
    monkeypatch.setattr(main, "DBConnection", FastDB)
    monkeypatch.setattr(main, "_chat_slots", _threading.BoundedSemaphore(1))
    monkeypatch.setattr(main, "RAG_CHAT_QUEUE_SECONDS", 0.2)

    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            first = asyncio.create_task(client.post("/api/chat", json={"message": "one"}))
            await asyncio.sleep(0.2)  # first chat now holds the only slot
            t0 = time.perf_counter()
            second = await client.post("/api/chat", json={"message": "two"})
            busy_latency = time.perf_counter() - t0
            t1 = time.perf_counter()
            health = await client.get("/health")
            health_latency = time.perf_counter() - t1
            release.set()
            return await first, second, busy_latency, health, health_latency

    first, second, busy_latency, health, health_latency = asyncio.run(scenario())
    assert second.status_code == 503
    assert second.headers["retry-after"] == "5"
    assert busy_latency < 1.0  # waited ~RAG_CHAT_QUEUE_SECONDS, not for the first chat
    assert health.status_code == 200 and health_latency < 0.8
    assert first.status_code == 200  # the slot holder completes normally


def test_chat_slot_released_after_handler_error(monkeypatch):
    import threading as _threading

    async def failing_chat(payload, **_):  # also receives retrieval_organization_id
        raise RuntimeError("ollama down")

    sem = _threading.BoundedSemaphore(1)
    monkeypatch.setattr(main, "chat_endpoint", failing_chat)
    monkeypatch.setattr(main, "get_supabase_client", lambda: None)
    monkeypatch.setattr(main, "_chat_slots", sem)
    client = TestClient(main.app, raise_server_exceptions=False)
    assert client.post("/api/chat", json={"message": "x"}).status_code == 500
    assert sem.acquire(blocking=False)  # slot was returned despite the error
    sem.release()
