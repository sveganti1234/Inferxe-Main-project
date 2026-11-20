"""Query-embedding LRU cache and thread-safe Chroma initialisation. No Ollama, no ChromaDB needed."""

import sys
import threading
import time
import types

import pytest

from backend.rag import server


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(server, "_embedding_cache", server.OrderedDict())
    monkeypatch.setattr(server, "RAG_EMBEDDING_CACHE_SIZE", 3)


def counting_fetch(monkeypatch, result=lambda q: [float(len(q))]):
    calls = []
    def fetch(query, timeout=10):
        calls.append(query)
        return result(query)
    monkeypatch.setattr(server, "_fetch_query_embedding", fetch)
    return calls


def test_repeated_query_served_from_cache(monkeypatch):
    calls = counting_fetch(monkeypatch)
    a = server.get_query_embedding("what is an H100?")
    b = server.get_query_embedding("what is an H100?")
    assert a == b and calls == ["what is an H100?"]


def test_exact_text_is_the_key(monkeypatch):
    calls = counting_fetch(monkeypatch)
    server.get_query_embedding("What is an H100?")
    server.get_query_embedding("what is an h100?")  # different text: not conflated
    assert len(calls) == 2


def test_failures_are_not_cached(monkeypatch):
    calls = counting_fetch(monkeypatch, result=lambda q: None)
    assert server.get_query_embedding("q") is None
    assert server.get_query_embedding("q") is None
    assert len(calls) == 2  # retried, never pinned to a failure


def test_lru_eviction_bounds_memory(monkeypatch):
    calls = counting_fetch(monkeypatch)
    for q in ("a", "b", "c", "a", "d"):  # "b" is least recently used when "d" arrives
        server.get_query_embedding(q)
    assert list(server._embedding_cache) == [(server.EMBEDDING_MODEL, q) for q in ("c", "a", "d")]
    server.get_query_embedding("b")
    assert calls.count("b") == 2


def test_cache_disabled_with_zero(monkeypatch):
    monkeypatch.setattr(server, "RAG_EMBEDDING_CACHE_SIZE", 0)
    calls = counting_fetch(monkeypatch)
    server.get_query_embedding("q"); server.get_query_embedding("q")
    assert len(calls) == 2 and len(server._embedding_cache) == 0


def test_cache_is_keyed_by_model(monkeypatch):
    calls = counting_fetch(monkeypatch)
    server.get_query_embedding("q")
    monkeypatch.setattr(server, "EMBEDDING_MODEL", "another-embedding-model")
    server.get_query_embedding("q")
    assert len(calls) == 2


def test_concurrent_lookups_are_safe(monkeypatch):
    monkeypatch.setattr(server, "RAG_EMBEDDING_CACHE_SIZE", 50)
    counting_fetch(monkeypatch)
    errors = []
    def worker(i):
        try:
            for j in range(200):
                assert server.get_query_embedding(f"q{(i + j) % 80}") is not None
        except Exception as e:  # pragma: no cover
            errors.append(e)
    ts = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in ts: t.start()
    for t in ts: t.join(10)
    assert errors == [] and len(server._embedding_cache) <= 50


def test_chroma_collection_created_once_under_concurrency(monkeypatch):
    created = []
    class FakeClient:
        def __init__(self, path):
            created.append(path); time.sleep(0.05)  # widen the race window
        def get_collection(self, name):
            return object()
    monkeypatch.setitem(sys.modules, "chromadb", types.SimpleNamespace(PersistentClient=FakeClient))
    monkeypatch.setattr(server, "_collection", None)
    monkeypatch.setattr(server, "_chroma_client", None)
    barrier, results = threading.Barrier(16), []
    def worker():
        barrier.wait(); results.append(server.get_chroma_collection())
    ts = [threading.Thread(target=worker) for _ in range(16)]
    for t in ts: t.start()
    for t in ts: t.join(5)
    assert len(created) == 1 and len({id(r) for r in results}) == 1
