"""Asynchronous job queue routes: submit, poll, list, cancel and stats.

WIRING
------
Registered in ``app/main.py`` (``app.include_router(jobs.router)``), so every
route below is live on ``services/api``. The header used to say the opposite —
"not registered anywhere yet" — which was true when the file was written and
stopped being true without the comment noticing. It matters because these
routes are NOT proxied by the Next server (docs/HARDWARE.md §2 lists the five
that are), so they are reachable only by whoever can reach the Python port
directly. That is the whole argument for keeping that port private.

Queue semantics — at-most-once, and what that costs — are in docs/JOBS.md.
"""

from __future__ import annotations

from typing import Any, Callable, TypeVar

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.jobs import archive, queue
from app.jobs.models import Job, JobRequest, JobSummary

# SECURITY FIX (audit finding PY-1): same pre-parse resource guard as the other
# routers. This router is not wired into main.py today; the guard is added now
# so that enabling it later does not reintroduce the unbounded-parse DoS.
from app.quantum.runner import effective_max_qubits
from app.routers.circuits import guard_qasm

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

T = TypeVar("T")


def _guard(operation: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Run a queue call, translating ValueError into a 400 response.

    Args:
        operation: The callable to invoke.
        *args: Positional arguments forwarded to ``operation``.
        **kwargs: Keyword arguments forwarded to ``operation``.

    Returns:
        Whatever ``operation`` returns.

    Raises:
        HTTPException: 400 when the operation raises ValueError.
    """
    try:
        return operation(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class CancelResponse(BaseModel):
    """The outcome of a cancellation attempt."""

    cancelled: bool


@router.post("", response_model=Job, status_code=202)
@router.post("/", response_model=Job, status_code=202, include_in_schema=False)
def submit_job(request: JobRequest) -> Job:
    """Accept a circuit for asynchronous execution.

    Args:
        request: The circuit, backend, shots, noise and optional owner/label.

    Returns:
        The accepted job in state QUEUED, with 202 Accepted.
    """
    # SECURITY FIX (audit finding PY-1): cap before work, at THIS backend's
    # measured limit rather than the global 24 — see app/quantum/limits.py.
    guard_qasm(request.qasm, effective_max_qubits(request.backend, request.noise))
    return _guard(queue.submit, request)


@router.get("", response_model=list[JobSummary])
@router.get("/", response_model=list[JobSummary], include_in_schema=False)
def list_jobs(
    user_id: str | None = Query(default=None, description="Only jobs owned by this user."),
    limit: int = Query(default=50, ge=1, le=500, description="Maximum jobs to return."),
) -> list[JobSummary]:
    """List recent jobs without their result payloads.

    Args:
        user_id: Optional owner filter.
        limit: Maximum number of jobs to return.

    Returns:
        Job summaries, most recently created first.
    """
    jobs = _guard(queue.list_jobs, user_id=user_id, limit=limit)
    return [job.to_summary() for job in jobs]


@router.get("/stats/summary")
def job_stats() -> dict[str, Any]:
    """Report per-status counts and worker pool size.

    Returns:
        The queue statistics dictionary.
    """
    return _guard(queue.stats)


class HistoryResponse(BaseModel):
    """Durable job history — see app/jobs/archive.py for what this is and isn't."""

    configured: bool
    jobs: list[dict[str, Any]]


@router.get("/history", response_model=HistoryResponse)
def job_history(
    user_id: str | None = Query(default=None, description="Only jobs owned by this user."),
    limit: int = Query(default=50, ge=1, le=200, description="Maximum rows to return."),
    offset: int = Query(default=0, ge=0, description="Rows to skip, for pagination."),
) -> HistoryResponse:
    """Read durable job history from Postgres, independent of the live queue.

    Distinct from ``GET /api/jobs``: that endpoint reads the live store
    (in-memory or Redis, bounded/expiring by design — see app/jobs/store.py).
    This one reads the ``job_history`` table archived jobs are best-effort
    mirrored into (app/jobs/archive.py), which is not bounded and does not
    expire. ``configured: false`` with an empty list means no ``DATABASE_URL``
    is set for this deployment — a normal, supported state — not an error.

    Args:
        user_id: Optional owner filter.
        limit: Maximum rows to return.
        offset: Rows to skip.

    Returns:
        Whether durable history is configured, and the matching rows.
    """
    return HistoryResponse(
        configured=archive.is_configured(),
        jobs=archive.list_history(user_id=user_id, limit=limit, offset=offset),
    )


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    """Fetch a single job, including its result once it is DONE.

    Args:
        job_id: The job identifier returned by the submit call.

    Returns:
        The job.

    Raises:
        HTTPException: 404 when the job is unknown or has expired.
    """
    job = _guard(queue.get, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job '{job_id}'.")
    return job


@router.delete("/{job_id}", response_model=CancelResponse)
def cancel_job(job_id: str) -> CancelResponse:
    """Cancel a job that has not started executing yet.

    Args:
        job_id: The job identifier.

    Returns:
        ``{"cancelled": true}`` when the job moved to CANCELLED, otherwise
        ``{"cancelled": false}`` (unknown, already running, or already finished).
    """
    return CancelResponse(cancelled=_guard(queue.cancel, job_id))
