"""The asynchronous job queue: submit, poll, cancel and inspect.

Why a ThreadPoolExecutor and not Celery
---------------------------------------
Celery would bring a broker, a result backend, a separate worker deployment and
a large dependency tree in exchange for features this service does not need:
there is exactly one queue, no fan-out, no retries with exponential backoff, and
no cross-language producers. The actual work — an Aer simulation — releases the
GIL inside compiled C++ and finishes in milliseconds to seconds, so a stdlib
:class:`~concurrent.futures.ThreadPoolExecutor` behind a pluggable store gives
the same submit-then-poll semantics in a few hundred lines with zero required
infrastructure. When a deployment genuinely outgrows one process, the store
switches to Redis (``REDIS_URL``) and :mod:`app.jobs.worker` runs as many extra
worker processes as needed — no rewrite of this module.

Hardware decoupling
-------------------
``HARDWARE_SUBMITTER`` is a module-level hook. While it is None every job runs
locally through :func:`app.quantum.runner.run_circuit`. A hardware module can
set it to a callable and jobs targeting non-simulator backends are routed there
instead, without this module importing anything hardware-specific.
"""

from __future__ import annotations

import atexit
import logging
import os
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from app.core.config import settings
from app.jobs import archive
from app.jobs.models import Job, JobRequest, JobStatus, utc_now_iso
from app.jobs.store import get_store
from app.quantum import runner
from app.quantum.backends import list_backends

logger = logging.getLogger(__name__)

# Local Aer simulation is CPU-bound, so worker count should track cores, not
# connections: past a handful of threads the simulators simply contend for cache
# and memory bandwidth and every job gets slower. Four is a sane default for the
# 2-8 core boxes this API is deployed on, and leaves headroom for the event loop.
MAX_WORKERS = 4

# How long a job may stay RUNNING before it is presumed dead and failed.
#
# The bound is set by the slowest job this service will accept, not by a guess.
# The widest simulation it allows is 24 qubits ideal, measured at 4.5 s (Aer) to
# 7.4 s (lightning) at 1024 shots, and the widest noisy one is 12 qubits at
# 0.83 s; at the 20 000-shot maximum the noisy case scales to roughly 20 s. 900 s
# is two orders of magnitude above that, so a legitimate job cannot be reaped by
# a slow box, while a job whose worker was killed stops being polled forever.
#
# A HARDWARE_SUBMITTER that blocks on a provider would change this calculation
# completely — QPU queues run to hours. It does not block today (submission is
# fire-and-forget, see app/quantum/hardware.py), and if that changes this
# constant has to change with it.
JOB_LEASE_SECONDS = 900.0

_executor = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="qlab-job")

# Hook for routing hardware backends elsewhere. Signature:
#     (job: Job) -> dict[str, Any]
# It must return a runner-shaped result dict or raise ValueError with an
# actionable message. Left as None, every backend runs locally.
HARDWARE_SUBMITTER: Callable[[Job], dict[str, Any]] | None = None


def _shutdown_executor() -> None:
    """Drain and shut down the worker pool at interpreter exit.

    Registered with :mod:`atexit` so a Ctrl-C on uvicorn does not leave running
    simulations orphaned behind non-daemon threads.
    """
    _executor.shutdown(wait=False, cancel_futures=True)


atexit.register(_shutdown_executor)


def _backend_kind(backend_id: str) -> str:
    """Look up whether a backend is a simulator or hardware.

    Args:
        backend_id: The backend identifier.

    Returns:
        The backend's ``kind``, e.g. ``"simulator"`` or ``"hardware"``.

    Raises:
        ValueError: When the id is not in the registry.
    """
    by_id = {backend.id: backend for backend in list_backends()}
    backend = by_id.get(backend_id)
    if backend is None:
        valid = ", ".join(sorted(by_id))
        raise ValueError(f"Unknown backend '{backend_id}'. Valid backends are: {valid}.")
    return backend.kind


def _validate(req: JobRequest) -> int:
    """Validate a submission synchronously, before anything is queued.

    Rejecting bad input here means the client gets a 400 immediately instead of
    polling a job that was doomed from the start.

    Args:
        req: The submission to check.

    Returns:
        The circuit's qubit count.

    Raises:
        ValueError: On out-of-range shots or noise, an unknown backend, a circuit
            that cannot be parsed, a circuit wider than ``settings.max_qubits``,
            or a hardware backend with no submitter installed.
    """
    if not isinstance(req.shots, int) or req.shots < 1 or req.shots > settings.max_shots:
        raise ValueError(f"shots must be between 1 and {settings.max_shots}, got {req.shots}.")
    if req.noise < 0.0 or req.noise > 0.5:
        raise ValueError(f"noise must be between 0.0 and 0.5, got {req.noise}.")

    kind = _backend_kind(req.backend)
    if kind != "simulator" and HARDWARE_SUBMITTER is None:
        raise ValueError(
            f"Backend '{req.backend}' is real hardware and no hardware submitter is "
            "configured on this deployment. Submit to a simulator backend "
            "(e.g. 'aer_simulator') instead."
        )

    circuit = runner.parse_qasm(req.qasm)
    if circuit.num_qubits > settings.max_qubits:
        raise ValueError(
            f"Circuit uses {circuit.num_qubits} qubits but this service accepts at most "
            f"{settings.max_qubits}. Reduce the circuit width or raise MAX_QUBITS."
        )
    # The backend-specific bound on top of the service-wide one. A 16-qubit
    # noisy job is 13.7 s of measured CPU and would hold one of four worker
    # threads for that long; refusing at submit time gives the caller a 400 now
    # instead of a job that starves the queue. See app/quantum/limits.py.
    runner.assert_width_is_affordable(circuit.num_qubits, req.backend, req.noise)
    return circuit.num_qubits


def _idempotency_scope(req: JobRequest) -> str | None:
    """Namespace an idempotency key so it cannot collide across users.

    A bare client-chosen key is a shared namespace: two users both sending
    ``"retry-1"`` would be handed each other's jobs, complete with each other's
    circuits and results. Scoping by ``user_id`` closes that. Anonymous
    submissions (no ``user_id``) share the ``anon`` scope, which is why the key
    is documented as client-generated and expected to be random.

    Args:
        req: The submission.

    Returns:
        The namespaced key, or None when the caller supplied none.
    """
    if not req.idempotency_key:
        return None
    return f"{req.user_id or 'anon'}:{req.idempotency_key}"


def submit(req: JobRequest) -> Job:
    """Validate a request, enqueue it, and hand it to the worker pool.

    Duplicate submission: when ``req.idempotency_key`` is set, the first
    submission to use that key (within the caller's scope) creates the job and
    every later one returns that same job untouched — including while it is
    still running, and including after it has finished. Without a key, two
    identical submissions create two jobs, which is the correct default: a
    learner re-running the same circuit to see a different sample is not making
    a mistake.

    Args:
        req: The circuit, backend, shots, noise and optional owner/label/key.

    Returns:
        The accepted :class:`Job` in state QUEUED, or the previously accepted
        job when the idempotency key has been seen before.

    Raises:
        ValueError: When the request is invalid; nothing is stored in that case.
    """
    _validate(req)

    store = get_store()
    scoped_key = _idempotency_scope(req)
    job_id = uuid.uuid4().hex

    if scoped_key is not None:
        # Reserve BEFORE storing the job. The reverse order — store, then
        # reserve — leaves an orphan job behind on every losing race.
        winner = store.reserve_idempotency_key(scoped_key, job_id)
        if winner != job_id:
            existing = store.get(winner)
            if existing is not None:
                logger.info(
                    "Idempotency key already used; returning existing job %s.", winner
                )
                return existing
            # The key outlived the job it named (evicted, or past its TTL).
            # Fall through and create a new one rather than 404-ing a caller
            # who is doing exactly what we asked them to do.
            logger.info("Idempotency key pointed at expired job %s; creating a new one.", winner)

    job = Job(
        id=job_id,
        status=JobStatus.QUEUED,
        backend=req.backend,
        shots=req.shots,
        noise=req.noise,
        label=req.label,
        user_id=req.user_id,
        qasm=req.qasm,
        idempotency_key=scoped_key,
        created_at=utc_now_iso(),
        progress=0.0,
        queue_position=max(0, store.count_active()),
    )
    store.put(job)
    _executor.submit(_execute, job.id)
    logger.info("Queued job %s on backend %s (%d shots).", job.id, job.backend, job.shots)
    return job


def _worker_identity() -> str:
    """Name this executor for the claim record.

    Returns:
        ``"<hostname>/<pid>/<thread>"``, enough to find the process holding a
        job that is stuck in RUNNING.
    """
    return f"{socket.gethostname()}/{os.getpid()}/{threading.current_thread().name}"


def _archive(job_id: str) -> None:
    """Best-effort mirror of a just-finished job into durable Postgres history.

    Re-reads the job from the live store rather than threading the just-built
    fields through every call site, and swallows every failure: a slow or
    unreachable archive database must never delay a poll response or fail a
    job. See app/jobs/archive.py — this is a no-op entirely when
    ``DATABASE_URL`` is unset.

    Args:
        job_id: The identifier of the job that just reached a terminal state.
    """
    try:
        job = get_store().get(job_id)
        if job is not None:
            archive.record(job)
    except Exception:  # noqa: BLE001 - archiving must never break the queue
        logger.warning("Job history archive failed for %s.", job_id, exc_info=True)


def _execute(job_id: str) -> None:
    """Run one job to completion inside a worker thread.

    Claims the job, dispatches to the hardware hook or the local runner, and
    records the outcome. Every exception is caught and stored: a worker thread
    must never die silently and leave a job stuck in RUNNING forever.

    Args:
        job_id: The identifier of the job to run.
    """
    store = get_store()
    # ATOMIC CLAIM. This used to be get-check-update, which is a read, a
    # decision and a write with two gaps: with a Redis store shared between the
    # API's thread pool and one or more app.jobs.worker processes, two drainers
    # both saw QUEUED and both ran the job. See JobStore.claim.
    job = store.claim(job_id, _worker_identity())
    if job is None:
        # Unknown, cancelled, already claimed, or already finished. All four are
        # normal and none of them is this caller's problem.
        logger.debug("Job %s was not claimable; another worker has it or it is done.", job_id)
        return

    try:
        submitter = HARDWARE_SUBMITTER
        if submitter is not None and _backend_kind(job.backend) != "simulator":
            result = submitter(job)
        else:
            result = runner.run_circuit(
                job.qasm,
                backend_id=job.backend,
                shots=job.shots,
                noise=job.noise,
            )
        store.update(
            job_id,
            status=JobStatus.DONE,
            result=result,
            finished_at=utc_now_iso(),
            progress=1.0,
            error=None,
        )
        _archive(job_id)
        logger.info("Job %s finished.", job_id)
    except ValueError as exc:
        store.update(
            job_id,
            status=JobStatus.ERROR,
            error=str(exc),
            finished_at=utc_now_iso(),
            progress=1.0,
        )
        _archive(job_id)
        logger.info("Job %s rejected: %s", job_id, exc)
    except BaseException as exc:  # noqa: BLE001 - Qiskit can raise Rust panics
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            store.update(
                job_id,
                status=JobStatus.ERROR,
                error="The worker was shut down before this job completed.",
                finished_at=utc_now_iso(),
                progress=1.0,
            )
            _archive(job_id)
            raise
        store.update(
            job_id,
            status=JobStatus.ERROR,
            error=(
                "The job failed while executing on the backend "
                f"({type(exc).__name__}). Check the server logs for details."
            ),
            finished_at=utc_now_iso(),
            progress=1.0,
        )
        _archive(job_id)
        logger.exception("Job %s crashed.", job_id)


def cancel(job_id: str) -> bool:
    """Cancel a job that has not started yet.

    Only a QUEUED job can be cancelled. A RUNNING local simulation cannot be
    interrupted mid-flight: Aer executes inside a compiled extension with no
    cancellation point, so the worker thread runs to completion and the result is
    simply discarded by the client. (A hardware submitter is free to implement
    real remote cancellation on top of this.)

    Args:
        job_id: The identifier of the job to cancel.

    Returns:
        True when the job moved to CANCELLED; False when it is unknown, already
        running, or already finished.
    """
    store = get_store()
    job = store.get(job_id)
    if job is None or job.status is not JobStatus.QUEUED:
        return False
    store.update(
        job_id,
        status=JobStatus.CANCELLED,
        finished_at=utc_now_iso(),
        queue_position=None,
        error="Cancelled before execution started.",
    )
    _archive(job_id)
    logger.info("Cancelled job %s.", job_id)
    return True


#: Minimum seconds between reaper passes. The pass is a scan over at most 500
#: jobs, so it is cheap, but there is no reason to repeat it per poll when the
#: lease it enforces is 900 s.
_REAP_INTERVAL_SECONDS = 30.0

_last_reap = 0.0
_reap_lock = threading.Lock()


def reap_stale_jobs(force: bool = False) -> list[str]:
    """Fail any job whose worker has stopped responding.

    This is called on every read path below rather than from a background
    thread, deliberately: a background thread in an ASGI app has to be started,
    stopped and kept alive across reloads, and this queue has a read on every
    poll anyway. The consequence is that a stuck job is cleaned up the next time
    ANYONE looks at the queue, not on a timer — good enough, since the only
    observer that cares is the client polling it.

    Args:
        force: Skip the throttle. Tests use this; nothing else needs to.

    Returns:
        The ids of the jobs that were failed.
    """
    global _last_reap

    now = time.monotonic()
    if not force:
        with _reap_lock:
            if now - _last_reap < _REAP_INTERVAL_SECONDS:
                return []
            _last_reap = now

    expired = get_store().reap_expired(JOB_LEASE_SECONDS)
    if expired:
        logger.warning(
            "Failed %d job(s) whose worker stopped responding: %s",
            len(expired),
            ", ".join(expired),
        )
    return expired


def get(job_id: str) -> Job | None:
    """Fetch a single job.

    Args:
        job_id: The job identifier.

    Returns:
        The job, or None when it is unknown or has expired.
    """
    reap_stale_jobs()
    return get_store().get(job_id)


def list_jobs(user_id: str | None = None, limit: int = 50) -> list[Job]:
    """List jobs newest-first, optionally restricted to one owner.

    Args:
        user_id: When given, only jobs submitted with this ``user_id``.
        limit: Maximum number of jobs to return.

    Returns:
        Up to ``limit`` jobs.
    """
    reap_stale_jobs()
    return get_store().list(user_id=user_id, limit=limit)


def stats() -> dict[str, Any]:
    """Summarise the queue for dashboards and health checks.

    Returns:
        A dictionary with per-status counts, the total, the number of active
        jobs, the worker pool size and whether a hardware submitter is installed.
    """
    reap_stale_jobs()
    jobs = get_store().list(limit=500)
    counts = {status.value: 0 for status in JobStatus}
    for job in jobs:
        counts[job.status.value] += 1
    return {
        "counts": counts,
        "total": len(jobs),
        "active": counts[JobStatus.QUEUED.value] + counts[JobStatus.RUNNING.value],
        "workers": MAX_WORKERS,
        "store": type(get_store()).__name__,
        "hardware_submitter": HARDWARE_SUBMITTER is not None,
    }
