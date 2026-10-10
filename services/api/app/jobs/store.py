"""Pluggable persistence for queued jobs.

Two implementations sit behind one :class:`JobStore` protocol:

* :class:`MemoryJobStore` — a lock-guarded dict. Zero dependencies, perfect for a
  single API process, and the default.
* :class:`RedisJobStore` — one JSON blob per job under ``qlab:job:<id>`` with a
  24h TTL plus a per-user index list. Used only when ``REDIS_URL`` is set, the
  ``redis`` package imports, and a ping succeeds.

``redis`` is imported lazily inside a try/except so the service runs — and its
tests pass — with nothing but fastapi/pydantic/qiskit/qiskit-aer installed.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable

from app.jobs.models import Job, JobStatus, _parse_iso, utc_now_iso

logger = logging.getLogger(__name__)

# Keep at most this many jobs in memory. Each finished job holds a full counts
# dictionary, so an unbounded dict is a slow memory leak in a long-lived API
# process. 500 is far more history than the UI ever shows while staying small
# enough (a few MB worst case) to be irrelevant next to Aer's own footprint.
MAX_MEMORY_JOBS = 500

# Redis keys expire after a day: job results are a convenience cache, not a
# system of record, and nobody polls a job from yesterday.
REDIS_TTL_SECONDS = 24 * 60 * 60

_JOB_KEY_PREFIX = "qlab:job:"
_USER_KEY_PREFIX = "qlab:user:"
_ALL_JOBS_KEY = "qlab:jobs"
_CLAIM_KEY_PREFIX = "qlab:claim:"
_IDEMPOTENCY_KEY_PREFIX = "qlab:idem:"
# Bound on the per-user and global index lists, mirroring MAX_MEMORY_JOBS.
_REDIS_INDEX_LIMIT = 500


def _lease_expired(job: Job, lease_seconds: float) -> bool:
    """Report whether a RUNNING job has outlived its lease.

    Args:
        job: The stored job.
        lease_seconds: How long a job may stay RUNNING.

    Returns:
        True when the job is RUNNING and started longer ago than the lease. A
        RUNNING job with an unparseable or missing ``started_at`` is treated as
        expired: it cannot be aged, so leaving it would strand it forever.
    """
    if job.status is not JobStatus.RUNNING:
        return False
    started = _parse_iso(job.started_at)
    if started is None:
        return True
    return (datetime.now(timezone.utc) - started).total_seconds() > lease_seconds


def _reaped_fields(job: Job, lease_seconds: float) -> dict[str, Any]:
    """Build the update that fails a job whose worker is presumed dead.

    The message is deliberately explicit that the job may in fact have run.
    This queue is at-most-once (docs/JOBS.md): it will not retry, because the
    same hook that runs a local simulation can submit to a paid QPU, and a
    retry after an ambiguous crash spends the money twice. Telling the user
    "resubmit if you still need it" is the honest version of that trade.

    Args:
        job: The expired job.
        lease_seconds: The lease it outlived.

    Returns:
        Field updates for :meth:`JobStore.update`.
    """
    return {
        "status": JobStatus.ERROR,
        "finished_at": utc_now_iso(),
        "progress": 1.0,
        "error": (
            f"The worker running this job stopped responding: it stayed RUNNING for "
            f"more than {lease_seconds:.0f}s without finishing, so it is presumed dead "
            "(process killed, container replaced, or machine lost). The job was NOT "
            "retried automatically — this queue is at-most-once, because the same path "
            "can submit to paid hardware. Resubmit it if you still need the result."
        ),
    }


@runtime_checkable
class JobStore(Protocol):
    """The persistence operations the queue needs from a store."""

    def put(self, job: Job) -> Job:
        """Insert or overwrite a job.

        Args:
            job: The job to persist.

        Returns:
            The stored job.
        """
        ...

    def get(self, job_id: str) -> Job | None:
        """Fetch a job by id.

        Args:
            job_id: The job identifier.

        Returns:
            The job, or None when it is unknown or expired.
        """
        ...

    def update(self, job_id: str, **fields: Any) -> Job | None:
        """Apply a partial update to a stored job.

        Args:
            job_id: The job identifier.
            **fields: Field names and values to overwrite.

        Returns:
            The updated job, or None when the job is unknown.
        """
        ...

    def list(self, user_id: str | None = None, limit: int = 50) -> list[Job]:
        """List jobs newest-first.

        Args:
            user_id: When given, only jobs owned by this user.
            limit: Maximum number of jobs to return.

        Returns:
            Up to ``limit`` jobs, most recently created first.
        """
        ...

    def delete(self, job_id: str) -> bool:
        """Remove a job.

        Args:
            job_id: The job identifier.

        Returns:
            True when a job was removed.
        """
        ...

    def count_active(self) -> int:
        """Count jobs that are QUEUED or RUNNING.

        Returns:
            The number of non-terminal jobs.
        """
        ...

    def claim(self, job_id: str, owner: str) -> Job | None:
        """Atomically move a QUEUED job to RUNNING, or refuse.

        THIS IS THE ONLY THING STANDING BETWEEN THIS QUEUE AND DOUBLE
        EXECUTION. Every executor — the API's own thread pool and any number of
        ``app.jobs.worker`` processes — calls this before touching a job, and
        exactly one of them can win. The check it replaces was::

            job = store.get(job_id)
            if job.status is not JobStatus.QUEUED: return
            store.update(job_id, status=RUNNING)

        which is a read, a decision and a write with two gaps in between. Two
        drainers reading the same QUEUED job both proceeded. On a simulator that
        wastes CPU; through ``HARDWARE_SUBMITTER`` it submits the same circuit to
        a paid QPU twice.

        Args:
            job_id: The job to claim.
            owner: An opaque identifier for the claimer, recorded on the job so
                a stuck RUNNING job can be attributed.

        Returns:
            The job in RUNNING state when this caller won the claim, or None
            when the job is unknown, already claimed, or no longer QUEUED.
        """
        ...

    def reap_expired(self, lease_seconds: float) -> list[str]:
        """Fail jobs that have been RUNNING longer than the lease.

        A worker that is SIGKILLed, OOM-killed or loses its container leaves its
        job in RUNNING with nothing to move it. Without this, that job is polled
        forever: the client's monitor spins, the queue's ``count_active`` never
        drops, and the operator sees a queue that looks busy and is not.

        Args:
            lease_seconds: How long a job may stay RUNNING before it is presumed
                dead.

        Returns:
            The ids of the jobs moved to ERROR.
        """
        ...

    def reserve_idempotency_key(self, key: str, job_id: str) -> str:
        """Bind an idempotency key to a job id, first writer wins.

        Args:
            key: The caller-supplied key, already namespaced by the queue.
            job_id: The id to bind if the key is free.

        Returns:
            ``job_id`` when this caller claimed the key, or the id already bound
            to it. A caller that gets back a different id must discard its new
            job and return the existing one.
        """
        ...


class MemoryJobStore:
    """An in-process job store: a dict guarded by a :class:`threading.Lock`.

    The thread pool touches this from worker threads while the event loop reads
    it from request handlers, so every access takes the lock. Insertion order of
    the dict is the creation order, which is what the eviction policy walks.
    """

    def __init__(self, max_jobs: int = MAX_MEMORY_JOBS) -> None:
        """Create an empty store.

        Args:
            max_jobs: Soft upper bound on retained jobs.
        """
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._max_jobs = max_jobs
        # Bounded alongside the job dict: an unbounded key map is the same slow
        # leak the job dict was capped for.
        self._idempotency: dict[str, str] = {}

    def put(self, job: Job) -> Job:
        """Insert or overwrite a job, evicting old finished jobs if needed.

        Args:
            job: The job to persist.

        Returns:
            The stored job.
        """
        with self._lock:
            self._jobs[job.id] = job
            self._evict_locked()
        return job

    def get(self, job_id: str) -> Job | None:
        """Fetch a job by id.

        Args:
            job_id: The job identifier.

        Returns:
            The job, or None when unknown.
        """
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **fields: Any) -> Job | None:
        """Apply a partial update to a stored job.

        Args:
            job_id: The job identifier.
            **fields: Field names and values to overwrite.

        Returns:
            The updated job, or None when unknown.
        """
        with self._lock:
            existing = self._jobs.get(job_id)
            if existing is None:
                return None
            updated = existing.model_copy(update=fields)
            self._jobs[job_id] = updated
            return updated

    def list(self, user_id: str | None = None, limit: int = 50) -> list[Job]:
        """List jobs newest-first, optionally filtered by owner.

        Args:
            user_id: When given, only jobs with this ``user_id``.
            limit: Maximum number of jobs to return.

        Returns:
            Up to ``limit`` jobs, most recently created first.
        """
        with self._lock:
            jobs = list(self._jobs.values())
        if user_id is not None:
            jobs = [job for job in jobs if job.user_id == user_id]
        jobs.sort(key=lambda job: job.created_at, reverse=True)
        return jobs[: max(0, limit)]

    def delete(self, job_id: str) -> bool:
        """Remove a job.

        Args:
            job_id: The job identifier.

        Returns:
            True when a job was removed.
        """
        with self._lock:
            return self._jobs.pop(job_id, None) is not None

    def count_active(self) -> int:
        """Count QUEUED and RUNNING jobs.

        Returns:
            The number of non-terminal jobs.
        """
        with self._lock:
            return sum(1 for job in self._jobs.values() if not job.status.is_terminal)

    def claim(self, job_id: str, owner: str) -> Job | None:
        """Atomically move a QUEUED job to RUNNING under the store lock.

        Args:
            job_id: The job to claim.
            owner: Identifier of the claiming worker.

        Returns:
            The RUNNING job, or None when it could not be claimed.
        """
        with self._lock:
            existing = self._jobs.get(job_id)
            if existing is None or existing.status is not JobStatus.QUEUED:
                return None
            claimed = existing.model_copy(
                update={
                    "status": JobStatus.RUNNING,
                    "started_at": utc_now_iso(),
                    "progress": 0.1,
                    "queue_position": None,
                    "worker": owner,
                }
            )
            self._jobs[job_id] = claimed
            return claimed

    def reap_expired(self, lease_seconds: float) -> list[str]:
        """Fail jobs stuck in RUNNING past the lease.

        Args:
            lease_seconds: Seconds a job may stay RUNNING.

        Returns:
            The ids moved to ERROR.
        """
        with self._lock:
            expired = [
                job.id
                for job in self._jobs.values()
                if _lease_expired(job, lease_seconds)
            ]
            for job_id in expired:
                self._jobs[job_id] = self._jobs[job_id].model_copy(
                    update=_reaped_fields(self._jobs[job_id], lease_seconds)
                )
        return expired

    def reserve_idempotency_key(self, key: str, job_id: str) -> str:
        """Bind a key to a job id under the store lock, first writer wins.

        Args:
            key: The namespaced idempotency key.
            job_id: The id to bind if the key is free.

        Returns:
            The id now bound to the key.
        """
        with self._lock:
            existing = self._idempotency.get(key)
            if existing is not None:
                return existing
            self._idempotency[key] = job_id
            # FIFO trim. Python dicts preserve insertion order, so the oldest
            # key is the first one out. An expired key means a resubmission
            # creates a second job rather than being deduplicated, which is the
            # safe direction to fail: this is a convenience, not a ledger.
            while len(self._idempotency) > self._max_jobs:
                del self._idempotency[next(iter(self._idempotency))]
            return job_id

    def _evict_locked(self) -> None:
        """Drop the oldest finished jobs until the bound is respected.

        A QUEUED or RUNNING job is never evicted: losing it would strand a client
        polling for a result that will still be produced. If every retained job
        is active the store is allowed to exceed its bound rather than corrupt
        the queue; that can only happen with more live jobs than the bound.

        Note:
            The caller must already hold ``self._lock``.
        """
        while len(self._jobs) > self._max_jobs:
            victim = next(
                (job_id for job_id, job in self._jobs.items() if job.status.is_terminal),
                None,
            )
            if victim is None:
                return
            del self._jobs[victim]


class RedisJobStore:
    """A Redis-backed job store shared by several API or worker processes.

    Each job is one JSON string at ``qlab:job:<id>`` with a 24h TTL. Two list
    keys act as indexes — a global one and one per user — so listing does not
    need ``SCAN``. Every method degrades to a safe empty answer if Redis fails
    mid-flight rather than raising into a request handler.
    """

    def __init__(self, client: Any) -> None:
        """Wrap an already-connected redis client.

        Args:
            client: A ``redis.Redis`` instance with ``decode_responses=True``.
        """
        self._redis = client

    @staticmethod
    def _key(job_id: str) -> str:
        """Build the Redis key holding a job.

        Args:
            job_id: The job identifier.

        Returns:
            The namespaced key.
        """
        return f"{_JOB_KEY_PREFIX}{job_id}"

    @staticmethod
    def _user_key(user_id: str) -> str:
        """Build the Redis key holding one user's job index.

        Args:
            user_id: The owner id.

        Returns:
            The namespaced key.
        """
        return f"{_USER_KEY_PREFIX}{user_id}"

    def put(self, job: Job) -> Job:
        """Persist a job and push it onto the relevant indexes.

        Args:
            job: The job to persist.

        Returns:
            The stored job (returned even if the write failed, so the caller
            still has an object to hand back to the client).
        """
        payload = json.dumps(job.model_dump(mode="json"))
        try:
            pipe = self._redis.pipeline()
            pipe.set(self._key(job.id), payload, ex=REDIS_TTL_SECONDS)
            pipe.lrem(_ALL_JOBS_KEY, 0, job.id)
            pipe.lpush(_ALL_JOBS_KEY, job.id)
            pipe.ltrim(_ALL_JOBS_KEY, 0, _REDIS_INDEX_LIMIT - 1)
            pipe.expire(_ALL_JOBS_KEY, REDIS_TTL_SECONDS)
            if job.user_id:
                pipe.lrem(self._user_key(job.user_id), 0, job.id)
                pipe.lpush(self._user_key(job.user_id), job.id)
                pipe.ltrim(self._user_key(job.user_id), 0, _REDIS_INDEX_LIMIT - 1)
                pipe.expire(self._user_key(job.user_id), REDIS_TTL_SECONDS)
            pipe.execute()
        except Exception as exc:  # noqa: BLE001 - a cache must not break the API
            logger.warning("Redis put failed for job %s: %s", job.id, exc)
        return job

    def get(self, job_id: str) -> Job | None:
        """Fetch and decode a job.

        Args:
            job_id: The job identifier.

        Returns:
            The job, or None when missing, expired or undecodable.
        """
        try:
            raw = self._redis.get(self._key(job_id))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis get failed for job %s: %s", job_id, exc)
            return None
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            return Job.model_validate(json.loads(raw))
        except (ValueError, TypeError) as exc:
            logger.warning("Discarding corrupt job payload %s: %s", job_id, exc)
            return None

    def update(self, job_id: str, **fields: Any) -> Job | None:
        """Read-modify-write a job.

        This is not atomic against a concurrent writer, which is acceptable: a
        given job is only ever mutated by the single worker that owns it.

        Args:
            job_id: The job identifier.
            **fields: Field names and values to overwrite.

        Returns:
            The updated job, or None when unknown.
        """
        existing = self.get(job_id)
        if existing is None:
            return None
        updated = existing.model_copy(update=fields)
        self.put(updated)
        return updated

    def list(self, user_id: str | None = None, limit: int = 50) -> list[Job]:
        """List jobs newest-first from the appropriate index.

        Args:
            user_id: When given, read that user's index instead of the global one.
            limit: Maximum number of jobs to return.

        Returns:
            Up to ``limit`` jobs, most recently created first.
        """
        key = self._user_key(user_id) if user_id else _ALL_JOBS_KEY
        try:
            ids = self._redis.lrange(key, 0, max(0, limit) - 1)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis list failed for %s: %s", key, exc)
            return []
        jobs: list[Job] = []
        for raw_id in ids or []:
            job_id = raw_id.decode("utf-8") if isinstance(raw_id, bytes) else str(raw_id)
            job = self.get(job_id)
            if job is not None:
                jobs.append(job)
        jobs.sort(key=lambda job: job.created_at, reverse=True)
        return jobs

    def delete(self, job_id: str) -> bool:
        """Remove a job and drop it from the global index.

        Args:
            job_id: The job identifier.

        Returns:
            True when a key was removed.
        """
        try:
            removed = int(self._redis.delete(self._key(job_id)) or 0)
            self._redis.lrem(_ALL_JOBS_KEY, 0, job_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis delete failed for job %s: %s", job_id, exc)
            return False
        return removed > 0

    def count_active(self) -> int:
        """Count QUEUED and RUNNING jobs within the retained index window.

        Returns:
            The number of non-terminal jobs.
        """
        return sum(
            1
            for job in self.list(limit=_REDIS_INDEX_LIMIT)
            if job.status in (JobStatus.QUEUED, JobStatus.RUNNING)
        )

    def claim(self, job_id: str, owner: str) -> Job | None:
        """Atomically claim a QUEUED job across processes, using SET NX.

        Redis has no compare-and-swap over a JSON blob, so the claim is a
        separate key: ``qlab:claim:<id>``, written with NX (set only if absent).
        Exactly one caller's write succeeds no matter how many API processes and
        standalone workers race, and the key carries the same TTL as the job so
        a crashed claimer cannot block the id forever.

        The status check still happens, after the lock is held rather than
        before it, so a cancelled job is not resurrected by a stale drain pass.

        Args:
            job_id: The job to claim.
            owner: Identifier of the claiming worker, stored in the claim key
                so an operator can see who holds it.

        Returns:
            The RUNNING job, or None when it could not be claimed.
        """
        try:
            won = self._redis.set(
                f"{_CLAIM_KEY_PREFIX}{job_id}", owner, nx=True, ex=REDIS_TTL_SECONDS
            )
        except Exception as exc:  # noqa: BLE001
            # Fail closed. Running a job we could not claim risks running it
            # twice, and for a hardware backend that spends money twice.
            logger.warning("Redis claim failed for job %s: %s", job_id, exc)
            return None
        if not won:
            return None

        existing = self.get(job_id)
        if existing is None or existing.status is not JobStatus.QUEUED:
            return None
        return self.update(
            job_id,
            status=JobStatus.RUNNING,
            started_at=utc_now_iso(),
            progress=0.1,
            queue_position=None,
            worker=owner,
        )

    def reap_expired(self, lease_seconds: float) -> list[str]:
        """Fail jobs stuck in RUNNING past the lease, within the index window.

        Args:
            lease_seconds: Seconds a job may stay RUNNING.

        Returns:
            The ids moved to ERROR.
        """
        expired: list[str] = []
        for job in self.list(limit=_REDIS_INDEX_LIMIT):
            if not _lease_expired(job, lease_seconds):
                continue
            self.update(job.id, **_reaped_fields(job, lease_seconds))
            expired.append(job.id)
        return expired

    def reserve_idempotency_key(self, key: str, job_id: str) -> str:
        """Bind a key to a job id with SET NX, then read back the winner.

        Args:
            key: The namespaced idempotency key.
            job_id: The id to bind if the key is free.

        Returns:
            The id now bound to the key. On a Redis failure this returns
            ``job_id`` unchanged — deduplication is best-effort, and refusing a
            submission because a cache is down would be worse than running it
            twice for the simulator backends this queue serves.
        """
        redis_key = f"{_IDEMPOTENCY_KEY_PREFIX}{key}"
        try:
            if self._redis.set(redis_key, job_id, nx=True, ex=REDIS_TTL_SECONDS):
                return job_id
            existing = self._redis.get(redis_key)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis idempotency reservation failed for %s: %s", key, exc)
            return job_id
        if existing is None:
            return job_id
        return existing.decode("utf-8") if isinstance(existing, bytes) else str(existing)

    def queued_ids(self, limit: int = _REDIS_INDEX_LIMIT) -> list[str]:
        """List the ids of jobs still waiting to run, oldest first.

        Used by the standalone worker process to find work.

        Args:
            limit: How far back through the index to look.

        Returns:
            Job ids whose status is QUEUED, oldest first.
        """
        queued = [job for job in self.list(limit=limit) if job.status is JobStatus.QUEUED]
        queued.sort(key=lambda job: job.created_at)
        return [job.id for job in queued]


_store: JobStore | None = None
_store_lock = threading.Lock()


def _connect_redis() -> Any | None:
    """Try to build a live redis client from ``REDIS_URL``.

    Returns:
        A pinged ``redis.Redis`` client, or None when the URL is unset, the
        package is missing, or the server does not answer.
    """
    url = os.getenv("REDIS_URL")
    if not url:
        return None
    try:
        import redis  # noqa: PLC0415 - optional dependency, imported lazily
    except ImportError as exc:
        logger.info("REDIS_URL is set but the redis package is not installed (%s).", exc)
        return None
    try:
        client = redis.Redis.from_url(url, decode_responses=True, socket_timeout=2)
        client.ping()
    except Exception as exc:  # noqa: BLE001 - any connection failure means fallback
        logger.warning("Could not reach Redis at %s (%s); using the in-memory store.", url, exc)
        return None
    return client


def get_store() -> JobStore:
    """Return the process-wide job store, selecting the backend once.

    Redis is chosen only when ``REDIS_URL`` is set, the ``redis`` package
    imports, and a ping succeeds; anything else falls back to
    :class:`MemoryJobStore`. The choice is cached in a module-level singleton so
    the ping happens at most once per process.

    Returns:
        The shared :class:`JobStore` implementation.
    """
    global _store
    if _store is not None:
        return _store
    with _store_lock:
        if _store is None:
            client = _connect_redis()
            if client is not None:
                logger.info("Job store: Redis (%s).", os.getenv("REDIS_URL"))
                _store = RedisJobStore(client)
            else:
                logger.info("Job store: in-memory (bounded at %d jobs).", MAX_MEMORY_JOBS)
                _store = MemoryJobStore()
    return _store


def reset_store(store: JobStore | None = None) -> JobStore:
    """Replace the cached store, primarily so tests start from a clean slate.

    Args:
        store: The store to install; a fresh :class:`MemoryJobStore` when None.

    Returns:
        The newly installed store.
    """
    global _store
    with _store_lock:
        _store = store if store is not None else MemoryJobStore()
    return _store
