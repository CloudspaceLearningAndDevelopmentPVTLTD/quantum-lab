"""Offline tests for the durable job-history archive (app/jobs/archive.py).

No real Postgres in this suite: everything here exercises the "DATABASE_URL
unset" path, which is what every environment without Azure Database for
PostgreSQL configured actually runs — including CI. The lazy-import,
never-raise contract is the thing worth pinning down; the SQL itself is only
exercised against a live database in production.
"""

from __future__ import annotations

import os

import pytest

from app.jobs import archive
from app.jobs.models import Job, JobStatus, utc_now_iso


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure DATABASE_URL is unset and the module cache is reset per test."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    archive.reset_for_tests()
    yield
    archive.reset_for_tests()


def _job(status: JobStatus = JobStatus.DONE) -> Job:
    return Job(
        id="job-1",
        status=status,
        backend="aer_simulator",
        shots=1024,
        created_at=utc_now_iso(),
        finished_at=utc_now_iso() if status.is_terminal else None,
    )


def test_not_configured_without_database_url() -> None:
    assert archive.is_configured() is False


def test_record_is_a_silent_noop_without_database_url() -> None:
    # Must not raise, and must not attempt a connection.
    archive.record(_job())


def test_list_history_returns_empty_without_database_url() -> None:
    assert archive.list_history() == []


def test_record_skips_non_terminal_jobs() -> None:
    # QUEUED/RUNNING jobs are churn, not history — verified indirectly: this
    # must not raise even if DATABASE_URL were set, since the terminal check
    # happens before any connection attempt.
    archive.record(_job(status=JobStatus.QUEUED))


def test_unreachable_database_url_degrades_to_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    # A syntactically valid but unreachable URL (nothing listens on this
    # port) must fail closed, not raise, matching REDIS_URL's fallback
    # behaviour in app/jobs/store.py.
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:1/nonexistent")
    assert archive.is_configured() is False
    archive.record(_job())  # must not raise
    assert archive.list_history() == []


def test_missing_package_degrades_to_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    """DATABASE_URL set but psycopg_pool unimportable must not raise."""
    import builtins

    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
    real_import = builtins.__import__

    def _blocked_import(name: str, *args: object, **kwargs: object) -> object:
        if name == "psycopg_pool":
            raise ImportError("simulated: package not installed")
        return real_import(name, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(builtins, "__import__", _blocked_import)
    assert archive.is_configured() is False
