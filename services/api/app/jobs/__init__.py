"""Asynchronous job queue for long-running quantum circuit executions.

Real quantum hardware queues jobs for minutes to hours, so a synchronous
``POST /run`` is the wrong shape for it. This package provides a submit-then-poll
queue: :mod:`app.jobs.models` defines the wire types, :mod:`app.jobs.store` the
pluggable persistence (in-process by default, Redis when configured),
:mod:`app.jobs.queue` the public API plus its thread-pool worker, and
:mod:`app.jobs.worker` an optional standalone worker process.

Nothing here requires Redis, Celery or a network connection: with only
fastapi/pydantic/qiskit/qiskit-aer installed the queue runs entirely in-process.
"""

from __future__ import annotations

from app.jobs.models import Job, JobRequest, JobStatus, JobSummary

__all__ = ["Job", "JobRequest", "JobStatus", "JobSummary"]
