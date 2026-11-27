"""assert_profile_active reuses one pooled HTTP client and still fails closed."""
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

import inference.auth as auth


class _Settings:
    def rest_url(self, table):
        return f"http://127.0.0.1:9/rest/v1/{table}"

    def auth_headers(self):
        return {"apikey": "test-only"}


def _response(status_code, rows):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = rows
    return resp


class TestProfileStatusClient(unittest.TestCase):
    def setUp(self):
        auth._ACTIVE_PROFILE_CACHE.clear()
        auth._profile_http_client = None
        patches = [
            patch.object(auth, "is_test_mode_enabled", return_value=False),
            patch("inference.supabase_config.get_supabase_settings", return_value=_Settings()),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(setattr, auth, "_profile_http_client", None)
        self.addCleanup(auth._ACTIVE_PROFILE_CACHE.clear)

    def test_one_client_serves_repeated_lookups(self):
        fake = MagicMock(is_closed=False)
        fake.get.return_value = _response(200, [{"status": "active"}])
        with patch("httpx2.Client", return_value=fake) as factory:
            auth.assert_profile_active("user-a")
            auth.assert_profile_active("user-b")
        self.assertEqual(factory.call_count, 1)
        self.assertEqual(fake.get.call_count, 2)

    def test_suspended_profile_is_rejected(self):
        fake = MagicMock(is_closed=False)
        fake.get.return_value = _response(200, [{"status": "suspended"}])
        with patch("httpx2.Client", return_value=fake):
            with self.assertRaises(HTTPException) as ctx:
                auth.assert_profile_active("user-c")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_lookup_failure_fails_closed(self):
        fake = MagicMock(is_closed=False)
        fake.get.side_effect = RuntimeError("network down")
        with patch("httpx2.Client", return_value=fake):
            with self.assertRaises(HTTPException) as ctx:
                auth.assert_profile_active("user-d")
        self.assertEqual(ctx.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
