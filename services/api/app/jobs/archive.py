"""Optional durable job history, backed by Postgres.

Neither of the two live job stores (``app.jobs.store``) is meant to be a
system of record: :class:`~app.jobs.store.MemoryJobStore` is bounded at 500
jobs and dies with the process, and :class:`~app.jobs.store.RedisJobStore`
expires every job after 24 hours by design (a job result is a convenience
cache, not history — see that module's docstring). That is the right
trade-off for "is my circuit done yet", and the wrong one for "what did I
run last week" — an education platform has real reasons to keep that: a
learner's own run history, and usage data to see which lessons/backends
people actually exercise.

This module is that third, slower tier. It writes one row per FINISHED job
(terminal status only — QUEUED/RUNNING churn is not history) to a
``job_history`` table and never blocks or fails a job on its behalf.

Same lazy-optional shape as ``app.jobs.store``'s Redis path, one level up:
``DATABASE_URL`` unset, or unreachable, or the ``psycopg`` package missing,
all mean "archiving is off" — never "the job failed" and never "the request
failed". ``app.jobs.queue`` calls :func:`record` in a bare ``try/except`` for
the same reason: durability here is a bonus, not a dependency the live queue
can be made to wait on or die from.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any

from app.jobs.models import Job

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS job_history (
    id              TEXT PRIMARY KEY,
    user_id         TEXT,
    label           TEXT,
    backend         TEXT NOT NULL,
    shots           INTEGER NOT NULL,
    noise           DOUBLE PRECISION NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,
    error           TEXT,
    duration_ms     DOUBLE PRECISION,
    created_at      TIMESTAMPTZ NOT NULL,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_history_user_id_idx
    ON job_history (user_id, created_at DESC);
"""
# Deliberately NOT storing `qasm` or `result`: the former can be arbitrarily
# large user-authored text and the latter can hold a megabyte-sized counts
# dict for a wide circuit (see JobSummary's docstring in app/jobs/models.py
# for the same reasoning applied to the listing endpoint). This table answers
# "what did I run, when, and did it work" — not "replay the exact counts" —
# which keeps every row small and fixed-size regardless of circuit width.

_pool_lock = threading.Lock()
_pool: Any | None = None
_schema_ready = False
_unavailable = False  # sticky: stop retrying every request after one failure


def _connect() -> Any | None:
    """Build (or reuse) a psycopg connection pool from ``DATABASE_URL``.

    Returns:
        A live connection pool, or None when the URL is unset, the
        ``psycopg`` package is missing, or the server does not answer.
    """
    global _pool, _schema_ready, _unavailable
    if _unavailable:
        return None
    url = os.getenv("DATABASE_URL")
    if not url:
        return None
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is not None:
            return _pool
        try:
            import psycopg_pool  # noqa: PLC0415 - optional dependency, imported lazily
        except ImportError as exc:
            logger.info("DATABASE_URL is set but psycopg[pool] is not installed (%s).", exc)
            _unavailable = True
            return None
        try:
            pool = psycopg_pool.ConnectionPool(url, min_size=0, max_size=3, open=True, timeout=3)
            with pool.connection(timeout=3) as conn, conn.cursor() as cur:
                cur.execute(_SCHEMA)
            _schema_ready = True
        except Exception as exc:  # noqa: BLE001 - any connection/DDL failure means "off"
            logger.warning("Could not reach Postgres at DATABASE_URL (%s); job history is off.", exc)
            _unavailable = True
            return None
        _pool = pool
        logger.info("Job history: Postgres (schema ready).")
        return _pool


def is_configured() -> bool:
    """Report whether durable job history is live for this process.

    Returns:
        True once ``DATABASE_URL`` is set and a connection has actually
        succeeded — not merely that the variable is present.
    """
    return _connect() is not None


def record(job: Job) -> None:
    """Best-effort archive of one finished job. Never raises.

    Args:
        job: A job in a terminal state (DONE, ERROR or CANCELLED). Non-terminal
            jobs are accepted but skipped — this table is history, not a live
            mirror of the queue.
    """
    if not job.status.is_terminal:
        return
    pool = _connect()
    if pool is None:
        return
    try:
        with pool.connection(timeout=3) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO job_history
                    (id, user_id, label, backend, shots, noise, status, error,
                     duration_ms, created_at, started_at, finished_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    error = EXCLUDED.error,
                    duration_ms = EXCLUDED.duration_ms,
                    started_at = EXCLUDED.started_at,
                    finished_at = EXCLUDED.finished_at
                """,
                (
                    job.id,
                    job.user_id,
                    job.label,
                    job.backend,
                    job.shots,
                    job.noise,
                    job.status.value,
                    job.error,
                    job.duration_ms,
                    job.created_at,
                    job.started_at,
                    job.finished_at,
                ),
            )
    except Exception as exc:  # noqa: BLE001 - archiving must never break the queue
        logger.warning("Failed to archive job %s to Postgres (%s).", job.id, exc)


def list_history(
    user_id: str | None = None, limit: int = 50, offset: int = 0
) -> list[dict[str, Any]]:
    """Read back archived job rows, most recent first.

    Args:
        user_id: Optional owner filter — omit for all users (an operator/
            admin view; the router is expected to enforce who may do that).
        limit: Maximum rows to return.
        offset: Rows to skip, for simple pagination.

    Returns:
        A list of plain dicts (JSON-serialisable as-is), or an empty list
        when history is not configured.
    """
    pool = _connect()
    if pool is None:
        return []
    where = "WHERE user_id = %s" if user_id is not None else ""
    params: tuple[Any, ...] = (user_id, limit, offset) if user_id is not None else (limit, offset)
    try:
        with pool.connection(timeout=3) as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, user_id, label, backend, shots, noise, status, error,
                       duration_ms, created_at, started_at, finished_at
                FROM job_history
                {where}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                params,
            )
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row, strict=True)) for row in cur.fetchall()]
    except Exception as exc:  # noqa: BLE001 - a read failure degrades to "no history"
        logger.warning("Failed to read job history from Postgres (%s).", exc)
        return []


def reset_for_tests() -> None:
    """Drop the cached pool so tests can point at a fresh ``DATABASE_URL``."""
    global _pool, _schema_ready, _unavailable
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.close()
            except Exception:  # noqa: BLE001 - best-effort cleanup
                pass
        _pool = None
        _schema_ready = False
        _unavailable = False
