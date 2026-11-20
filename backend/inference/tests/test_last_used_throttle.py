"""last_used_at is written at most once per LAST_USED_UPDATE_INTERVAL per key (no network)."""

from datetime import datetime, timedelta, timezone

import pytest

from inference import auth


@pytest.mark.parametrize("last_used, expected", [
    (None, True),                                                    # never used: write
    (datetime.now(timezone.utc) - timedelta(seconds=5), False),      # just written: skip
    (datetime.now(timezone.utc) - timedelta(seconds=61), True),      # older than the interval: write
    (datetime.utcnow() - timedelta(seconds=5), False),               # naive timestamps treated as UTC
])
def test_last_used_staleness(last_used, expected):
    assert auth._last_used_is_stale(last_used) is expected


def test_interval_is_one_minute():
    assert auth.LAST_USED_UPDATE_INTERVAL == timedelta(seconds=60)
