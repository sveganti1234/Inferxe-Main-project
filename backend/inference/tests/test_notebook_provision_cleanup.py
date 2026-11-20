"""A provisioned runtime must be released if saving the notebook fails (otherwise a real provider
would keep billing an untracked GPU). Fake driver and repository; no network."""

import threading
from unittest.mock import MagicMock

import pytest

from inference import notebook_service
from inference.notebook_service import create_notebook


class RecordingDriver:
    def __init__(self, fail_terminate=False):
        self.provisioned, self.terminated, self.fail_terminate = [], [], fail_terminate
        self.lock = threading.Lock()

    def provision(self, instance_id, gpu_profile, **kw):
        with self.lock:
            self.provisioned.append(instance_id)
        return {"status": "running", "runtime_reference": f"sim://{instance_id}"}

    def terminate(self, runtime_reference):
        if self.fail_terminate:
            raise RuntimeError("provider unreachable")
        with self.lock:
            self.terminated.append(runtime_reference)
        return {"status": "terminated"}


class SaveFailed(Exception):
    pass


def failing_repo():
    repo = MagicMock()
    repo.create_notebook_session.side_effect = SaveFailed("supabase unavailable")
    return repo


def test_runtime_released_when_save_fails():
    driver = RecordingDriver()
    with pytest.raises(SaveFailed):
        create_notebook(failing_repo(), user_id="user-1", name="nb", driver=driver)
    assert len(driver.provisioned) == 1
    assert driver.terminated == [f"sim://{driver.provisioned[0]}"]


def test_original_error_kept_when_cleanup_also_fails():
    driver = RecordingDriver(fail_terminate=True)
    with pytest.raises(SaveFailed):  # the save error, not the cleanup error, reaches the caller
        create_notebook(failing_repo(), user_id="user-1", name="nb", driver=driver)


def test_no_cleanup_on_success():
    driver = RecordingDriver()
    repo = MagicMock()
    repo.create_notebook_session.side_effect = lambda **kw: MagicMock(id=kw["instance_id"])
    create_notebook(repo, user_id="user-1", name="nb", driver=driver)
    assert driver.terminated == []


def test_concurrent_failures_release_every_runtime():
    driver = RecordingDriver()
    errors = []
    def worker():
        try:
            create_notebook(failing_repo(), user_id="user-1", name="nb", driver=driver)
        except SaveFailed:
            errors.append(1)
    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads: t.start()
    for t in threads: t.join(5)
    assert len(errors) == 20
    assert sorted(driver.terminated) == sorted(f"sim://{i}" for i in driver.provisioned)
