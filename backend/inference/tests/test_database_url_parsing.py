"""
Unit tests for DATABASE_URL parsing with special characters in credentials.

Tests that create_app_engine(), get_masked_url(), and
_parse_database_url_safe() handle passwords containing $, !, @, %, :, /,
?, #, and other reserved URL characters without SQLAlchemy URL parsing errors.
"""

import os
import sys
import unittest
from unittest.mock import patch

# Set DATABASE_URL before importing database module (module-level engine creation)
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

# Add backend to path so we can import inference.database
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.inference.database import (
    create_app_engine,
    get_masked_url,
    _parse_database_url_safe,
)


class TestDatabaseUrlParsingSpecialChars(unittest.TestCase):
    """Tests that DATABASE_URL parsing handles special characters safely."""

    def test_password_with_dollar_sign(self):
        """Password containing $ must parse without ArgumentError."""
        url = "postgresql+psycopg2://user:Brdoch!123$@host.supabase.com:5432/mydb"
        parsed = _parse_database_url_safe(url)
        self.assertEqual(parsed.password, "Brdoch!123$")
        self.assertEqual(parsed.host, "host.supabase.com")
        self.assertEqual(parsed.port, 5432)
        self.assertEqual(parsed.database, "mydb")

    def test_password_with_exclamation(self):
        """Password containing ! must parse without ArgumentError."""
        url = "postgresql+psycopg2://user:pass!word@host.supabase.com:5432/mydb"
        parsed = _parse_database_url_safe(url)
        self.assertEqual(parsed.password, "pass!word")

    def test_password_with_at_sign(self):
        """Password containing @ must parse (urlsplit splits on last @)."""
        url = "postgresql+psycopg2://user:pass@word@host.supabase.com:5432/mydb"
        parsed = _parse_database_url_safe(url)
        self.assertEqual(parsed.password, "pass@word")
        self.assertEqual(parsed.host, "host.supabase.com")

    def test_password_already_percent_encoded(self):
        """Already-encoded password (%21 for !) decodes and re-encodes idempotently."""
        url = "postgresql+psycopg2://user:Brdoch%21123%24@host.supabase.com:5432/mydb"
        parsed = _parse_database_url_safe(url)
        # unquote decodes %21 -> ! and %24 -> $, then URL.create() re-encodes
        self.assertEqual(parsed.password, "Brdoch!123$")

    def test_password_with_multiple_special_chars(self):
        """Password with $, !, @ and other URL-reserved chars must parse."""
        url = "postgresql+psycopg2://user:p@ss!w0rd$@host.supabase.com:5432/mydb"
        parsed = _parse_database_url_safe(url)
        self.assertEqual(parsed.password, "p@ss!w0rd$")
        self.assertEqual(parsed.host, "host.supabase.com")

    def test_get_masked_url_hides_password(self):
        """get_masked_url() must not expose the password in output."""
        url = "postgresql+psycopg2://user:Brdoch!123$@host.supabase.com:5432/mydb"
        masked = get_masked_url(url)
        self.assertNotIn("Brdoch!123$", masked)
        self.assertIn("***", masked)

    def test_get_masked_url_hides_at_password(self):
        """get_masked_url() must hide passwords containing @."""
        url = "postgresql+psycopg2://user:pass@word@host.supabase.com:5432/mydb"
        masked = get_masked_url(url)
        self.assertNotIn("pass@word", masked)

    def test_create_app_engine_with_special_password(self):
        """create_app_engine() must not raise ArgumentError with special char passwords."""
        url = "postgresql+psycopg2://user:Brdoch!123$@host.supabase.com:5432/mydb"
        # Should not raise sqlalchemy.exc.ArgumentError
        try:
            engine = create_app_engine(url)
        except Exception as e:
            self.fail(f"create_app_engine() raised {type(e).__name__}: {e}")
        self.assertIsNotNone(engine)
        engine.dispose()

    def test_create_app_engine_sqlite_still_works(self):
        """create_app_engine() must still work with SQLite URLs."""
        engine = create_app_engine("sqlite:///:memory:")
        self.assertIsNotNone(engine)
        engine.dispose()

    def test_url_render_encodes_password(self):
        """URL.create() output must percent-encode special characters in password."""
        url = "postgresql+psycopg2://user:Brdoch!123$@host.supabase.com:5432/mydb"
        parsed = _parse_database_url_safe(url)
        rendered = parsed.render_as_string(hide_password=False)
        self.assertNotIn("$", rendered.split("@")[0].split(":")[-1])
        self.assertIn("%24", rendered)

    def test_ssl_query_params_preserved(self):
        """SSL query parameters (sslmode=require) must be preserved."""
        url = "postgresql+psycopg2://user:pass!word@host.supabase.com:5432/mydb?sslmode=require"
        parsed = _parse_database_url_safe(url)
        self.assertEqual(parsed.query.get("sslmode"), "require")


if __name__ == "__main__":
    unittest.main()
