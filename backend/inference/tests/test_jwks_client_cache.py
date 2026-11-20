"""B2: the Cognito JWKS client is reused across requests instead of rebuilt per request (no network)."""

import threading
from unittest.mock import MagicMock, patch

from inference import auth


def test_jwks_client_built_once_per_url():
    factory = MagicMock(side_effect=lambda *a, **kw: MagicMock())
    with patch("inference.auth.PyJWKClient", factory):
        a = auth._get_jwks_client("https://example.invalid/pool-a/jwks.json")
        b = auth._get_jwks_client("https://example.invalid/pool-a/jwks.json")
        c = auth._get_jwks_client("https://example.invalid/pool-b/jwks.json")
    assert a is b
    assert a is not c
    assert factory.call_count == 2
    assert factory.call_args.kwargs["timeout"] == 5


def test_jwks_client_cache_thread_safe():
    factory = MagicMock(side_effect=lambda *a, **kw: MagicMock())
    url = "https://example.invalid/pool-threads/jwks.json"
    results = []
    with patch("inference.auth.PyJWKClient", factory):
        threads = [threading.Thread(target=lambda: results.append(auth._get_jwks_client(url))) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(5)
    assert factory.call_count == 1
    assert len({id(r) for r in results}) == 1
