"""
A5: broadcast notifications use one multi-row INSERT, falling back to the per-user path only on an
FK violation so users without a profile row are still skipped. No database (fakes only).
Run from the repo root:  python -m pytest backend/notifications/tests/test_broadcast_batch.py -q
"""

import psycopg2
import pytest

from backend.notifications import service
from backend.notifications.service import NotificationService


class FKViolation(psycopg2.IntegrityError):
    pgcode = "23503"


class UniqueViolation(psycopg2.IntegrityError):
    pgcode = "23505"


class FakeCursor:
    def __init__(self, autocommit=False):
        self.connection = type("C", (), {"autocommit": autocommit})()
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append(" ".join(sql.split()))


@pytest.fixture
def env(monkeypatch):
    state = {"batches": [], "batch_error": None, "single": [], "missing": set()}
    monkeypatch.setattr(service, "_get_table_columns",
                        lambda cur, table: {"id": "uuid", "message": "text", "detail": "text",
                                            "metadata": "text", "related_entity_id": "text", "created_at": "text"})

    def fake_execute_values(cur, sql, rows, template=None, page_size=100):
        state["batches"].append((sql, rows, template))
        if state["batch_error"]:
            raise state["batch_error"]

    def fake_single(cls, cur, user_id, **kw):
        state["single"].append(user_id)
        return None if user_id in state["missing"] else f"n_{user_id}"

    monkeypatch.setattr(service, "execute_values", fake_execute_values)
    monkeypatch.setattr(NotificationService, "_create_notification_in_broadcast", classmethod(fake_single))
    return state


def broadcast(cur, users):
    return NotificationService._broadcast_notifications(
        cur, users, title="T", message="M", notification_type="SYSTEM", metadata={"k": 1}, related_entity_id="e1")


def test_happy_path_is_one_batch_insert(env):
    cur = FakeCursor()
    assert broadcast(cur, ["u1", "u2", "u3"]) == 3
    assert len(env["batches"]) == 1 and env["single"] == []
    sql, rows, template = env["batches"][0]
    assert "INSERT INTO notifications (id, user_id, title, message, detail, notification_type, is_read" in sql
    assert template.count("FALSE") == 1 and template.count("%s") == len(rows[0])
    assert [r[1] for r in rows] == ["u1", "u2", "u3"]
    assert len({r[0] for r in rows}) == 3  # distinct ids
    assert cur.statements == ["SAVEPOINT sp_broadcast_batch;", "RELEASE SAVEPOINT sp_broadcast_batch;"]


def test_missing_profile_falls_back_and_skips_only_those_users(env):
    env["batch_error"] = FKViolation("insert or update violates foreign key constraint")
    env["missing"] = {"ghost"}
    cur = FakeCursor()
    assert broadcast(cur, ["u1", "ghost", "u2"]) == 2  # same count as the old per-user loop
    assert env["single"] == ["u1", "ghost", "u2"]
    assert cur.statements == ["SAVEPOINT sp_broadcast_batch;", "ROLLBACK TO SAVEPOINT sp_broadcast_batch;"]


@pytest.mark.parametrize("err", [UniqueViolation("dup"), RuntimeError("db down")])
def test_other_errors_propagate_after_rollback(env, err):
    env["batch_error"] = err
    cur = FakeCursor()
    with pytest.raises(type(err)):
        broadcast(cur, ["u1"])
    assert env["single"] == []
    assert cur.statements[-1] == "ROLLBACK TO SAVEPOINT sp_broadcast_batch;"


def test_empty_recipient_list_does_nothing(env):
    cur = FakeCursor()
    assert broadcast(cur, []) == 0
    assert env["batches"] == [] and cur.statements == []


def test_autocommit_cursor_uses_no_savepoint(env):
    cur = FakeCursor(autocommit=True)
    assert broadcast(cur, ["u1"]) == 1
    assert cur.statements == []


def test_single_and_batch_rows_have_identical_shape(monkeypatch):
    cols = {"id": "text", "message": "text", "metadata": "text", "created_at": "text"}
    insert_cols, values = service._notification_row(cols, "u1", "T", "M", "SYSTEM", None, None)
    assert insert_cols == ["id", "user_id", "title", "message", "notification_type", "is_read", "metadata", "created_at"]
    assert len(values) == len(insert_cols) - 1  # is_read is the literal FALSE
    assert values[0].startswith("notif_")
