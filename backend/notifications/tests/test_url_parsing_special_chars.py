"""
Unit tests for DATABASE_URL parsing with special characters in credentials.
Tests that urlsplit and component extraction handle passwords containing '@'
and other special characters without IP address validation errors.
"""

import os
import sys
import unittest
from urllib.parse import urlsplit, unquote

# Add backend to path so we can import db module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Import parsing helpers directly without triggering module-level DB connections
from backend.notifications.db import _extract_url_components, _sanitize_error_message

# ── Dummy DATABASE_URL with special characters in password ──────────────
# The password contains '@' which must not break URL parsing.
# Username also contains special chars for good measure.
DUMMY_DB_URL = "postgresql://db_user%40name:DummyPass@123@db.supabase.co:5432/postgres?sslmode=require"


class TestUrlParsingSpecialChars(unittest.TestCase):
    """Tests that DATABASE_URL parsing handles special characters safely."""

    def test_urlsplit_with_at_in_password(self):
        """urlsplit must not raise ValueError when password contains '@'."""
        # This is the exact scenario that was failing:
        # ValueError: 'DummyPass@123' does not appear to be an IPv4 or IPv6 address
        try:
            parsed = urlsplit(DUMMY_DB_URL)
        except ValueError as e:
            self.fail(f"urlsplit raised ValueError with @ in password: {e}")

    def test_extract_components_decodes_credentials(self):
        """Component extraction must URL-decode username and password."""
        parsed = urlsplit(DUMMY_DB_URL)
        components = _extract_url_components(parsed)

        self.assertEqual(components["host"], "db.supabase.co")
        self.assertEqual(components["port"], 5432)
        self.assertEqual(components["dbname"], "postgres")
        # Username 'db_user%40name' decodes to 'db_user@name'
        self.assertEqual(components["user"], "db_user@name")
        # Password 'DummyPass@123' is preserved as-is (already decoded by urlsplit)
        self.assertEqual(components["password"], "DummyPass@123")

    def test_extract_components_handles_plain_at_password(self):
        """Component extraction handles unencoded '@' in password."""
        url = "postgresql://user:DummyPass@123@db.supabase.co:5432/postgres"
        parsed = urlsplit(url)
        components = _extract_url_components(parsed)

        self.assertEqual(components["host"], "db.supabase.co")
        self.assertEqual(components["port"], 5432)
        self.assertEqual(components["dbname"], "postgres")
        self.assertEqual(components["user"], "user")
        self.assertEqual(components["password"], "DummyPass@123")

    def test_sanitize_error_message_masks_sensitive_values(self):
        """Error sanitization must not leak credentials or hostnames."""
        raw = "ValueError: 'DummyPass@123' does not appear to be an IPv4 or IPv6 address"
        masked = _sanitize_error_message(raw)
        self.assertNotIn("DummyPass@123", masked)
        self.assertNotIn("db.supabase.co", masked)
        self.assertNotIn("postgresql://", masked)

    def test_sanitize_error_message_masks_password_param(self):
        """password= parameter in error messages must be masked."""
        raw = "connection failed: password=dummy-secret-value@host"
        masked = _sanitize_error_message(raw)
        self.assertNotIn("dummy-secret-value", masked)
        self.assertIn("password=<redacted>", masked)


if __name__ == "__main__":
    unittest.main()
