"""backend .env is parsed once per process for non-override loads (it was re-parsed on every
Supabase call). No network."""

from pathlib import Path
from unittest.mock import patch

from inference import supabase_config as cfg


def test_non_override_load_reads_file_once(tmp_path, monkeypatch):
    env = tmp_path / ".env"; env.write_text("X_ENV_ONCE=1\n", encoding="utf-8")
    monkeypatch.setattr(cfg, "_loaded_env_files", set())
    with patch.object(cfg, "load_dotenv") as ld:
        for _ in range(5):
            cfg.load_backend_env(env_file=env, override=False)
    assert ld.call_count == 1


def test_override_load_always_reads(tmp_path, monkeypatch):
    env = tmp_path / ".env"; env.write_text("X_ENV_ONCE=1\n", encoding="utf-8")
    monkeypatch.setattr(cfg, "_loaded_env_files", set())
    with patch.object(cfg, "load_dotenv") as ld:
        cfg.load_backend_env(env_file=env, override=False)
        cfg.load_backend_env(env_file=env, override=True)
        cfg.load_backend_env(env_file=env, override=True)
    assert ld.call_count == 3


def test_missing_file_is_not_remembered(tmp_path, monkeypatch):
    env = tmp_path / ".env"  # does not exist yet
    monkeypatch.setattr(cfg, "_loaded_env_files", set())
    with patch.object(cfg, "load_dotenv") as ld:
        cfg.load_backend_env(env_file=env, override=False)
        env.write_text("X_ENV_ONCE=1\n", encoding="utf-8")
        cfg.load_backend_env(env_file=env, override=False)  # created later: now loaded
    assert ld.call_count == 1
