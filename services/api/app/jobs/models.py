"""Pydantic v2 models describing queued quantum jobs.

These types are the contract shared by the store, the queue and the HTTP router.
Timestamps are ISO-8601 strings in UTC (``...+00:00``) rather than ``datetime``
objects so that a job round-trips through JSON — and therefore through Redis —
without any custom encoder.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, computed_field


def utc_now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string.

    Returns:
        A timezone-aware ISO-8601 timestamp, e.g. ``"2026-08-16T10:00:00+00:00"``.
    """
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    """Parse an ISO-8601 timestamp produced by :func:`utc_now_iso`.

    Args:
        value: The timestamp string, or None.

    Returns:
        The parsed datetime, or None when the value is missing or malformed.
    """
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


class JobStatus(str, Enum):
    """Lifecycle states of a queued job.

    A job moves QUEUED -> RUNNING -> DONE|ERROR, or QUEUED -> CANCELLED. There is
    no transition out of a terminal state.
    """

    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    DONE = "DONE"
    ERROR = "ERROR"
    CANCELLED = "CANCELLED"

    @property
    def is_terminal(self) -> bool:
        """Report whether no further transition is possible from this state.

        Returns:
            True for DONE, ERROR and CANCELLED.
        """
        return self in (JobStatus.DONE, JobStatus.ERROR, JobStatus.CANCELLED)


class JobRequest(BaseModel):
    """Payload submitted by a client to enqueue a circuit execution."""

    qasm: str = Field(description="OpenQASM 3 (or 2) circuit source.")
    backend: str = Field("aer_simulator", description="Backend id to execute on.")
    shots: int = Field(1024, ge=1, le=20000, description="Number of repetitions.")
    noise: float = Field(0.0, ge=0.0, le=0.5, description="Depolarising noise strength.")
    user_id: str | None = Field(default=None, description="Opaque owner id used for listing.")
    label: str | None = Field(default=None, description="Human readable name for the job.")
    idempotency_key: str | None = Field(
        default=None,
        max_length=200,
        description=(
            "Optional client-generated key. Two submissions carrying the same key "
            "(from the same user_id) return the SAME job instead of creating two. "
            "Send one when a retry after a timeout would otherwise double-submit."
        ),
    )


class Job(BaseModel):
    """A submitted job together with its progress and, once finished, its result."""

    id: str = Field(description="Server-generated job identifier.")
    status: JobStatus = Field(description="Current lifecycle state.")
    backend: str = Field(description="Backend id the job targets.")
    shots: int = Field(description="Number of repetitions requested.")
    noise: float = Field(default=0.0, description="Depolarising noise strength requested.")
    label: str | None = Field(default=None, description="Human readable name, if supplied.")
    user_id: str | None = Field(default=None, description="Owner id, if supplied.")
    qasm: str = Field(default="", description="The circuit source that was submitted.")
    idempotency_key: str | None = Field(
        default=None, description="The key this job was deduplicated under, if any."
    )
    worker: str | None = Field(
        default=None,
        description=(
            "Which executor claimed this job. Set by JobStore.claim and left in place "
            "afterwards, so a job stuck in RUNNING names the process to go and look at."
        ),
    )

    created_at: str = Field(description="ISO-8601 UTC time the job was accepted.")
    started_at: str | None = Field(default=None, description="ISO-8601 UTC execution start.")
    finished_at: str | None = Field(default=None, description="ISO-8601 UTC terminal time.")

    result: dict[str, Any] | None = Field(default=None, description="Runner result when DONE.")
    error: str | None = Field(default=None, description="Failure message when ERROR.")
    progress: float = Field(default=0.0, ge=0.0, le=1.0, description="Coarse progress in [0, 1].")
    queue_position: int | None = Field(
        default=None, description="Approximate position in the queue while QUEUED."
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def duration_ms(self) -> float | None:
        """Wall-clock execution time in milliseconds.

        Returns:
            Milliseconds between ``started_at`` and ``finished_at``, or None when
            the job has not both started and finished.
        """
        start = _parse_iso(self.started_at)
        end = _parse_iso(self.finished_at)
        if start is None or end is None:
            return None
        return round((end - start).total_seconds() * 1000, 2)

    def to_summary(self) -> "JobSummary":
        """Project this job onto the list view, dropping the result payload.

        Returns:
            A :class:`JobSummary` carrying only the small fields.
        """
        return JobSummary(
            id=self.id,
            status=self.status,
            backend=self.backend,
            shots=self.shots,
            label=self.label,
            user_id=self.user_id,
            created_at=self.created_at,
            started_at=self.started_at,
            finished_at=self.finished_at,
            progress=self.progress,
            queue_position=self.queue_position,
            error=self.error,
            duration_ms=self.duration_ms,
        )


class JobSummary(BaseModel):
    """A job without its (potentially megabyte-sized) result payload.

    Listing endpoints return this so that fetching a hundred jobs does not drag
    a hundred count dictionaries across the wire.
    """

    id: str
    status: JobStatus
    backend: str
    shots: int
    label: str | None = None
    user_id: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    progress: float = 0.0
    queue_position: int | None = None
    error: str | None = None
    duration_ms: float | None = None
