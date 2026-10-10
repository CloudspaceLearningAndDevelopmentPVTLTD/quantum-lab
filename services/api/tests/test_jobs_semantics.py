"""The job queue's delivery guarantees, tested rather than assumed.

docs/JOBS.md states the semantics in prose: **at-most-once**, with an optional
idempotency key for duplicate submission and a lease that fails jobs whose
worker died. This file is the executable half of that document. Every test here
corresponds to a paragraph there, and any of them failing means the doc is now
a lie.

Each test starts from the failure it is preventing, because the old code passed
its own suite while having all three of these bugs:

* ``_execute`` was get-check-update, so two drainers both ran the same job.
* nothing deduplicated submissions, so a client retry after a timeout ran the
  circuit twice — through ``HARDWARE_SUBMITTER``, twice on a paid QPU.
* nothing moved a job out of RUNNING, so a killed worker left it there forever.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.jobs import queue
from app.jobs.models import Job, JobRequest, JobStatus, utc_now_iso
from app.jobs.store import MemoryJobStore, reset_store
from app.quantum.presets import get_preset

BELL = get_preset("bell")["qasm"]


@pytest.fixture(autouse=True)
def fresh_store() -> Any:
    """Give every test an empty store and an un-throttled reaper."""
    reset_store(MemoryJobStore())
    queue._last_reap = 0.0
    yield
    reset_store(MemoryJobStore())


def _wait_for(job_id: str, timeout: float = 20.0) -> Job:
    """Poll a job until it is terminal.

    Args:
        job_id: The job to wait for.
        timeout: Seconds to wait before failing.

    Returns:
        The terminal job.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = queue.get(job_id)
        assert job is not None
        if job.status.is_terminal:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def _queued_job(**overrides: Any) -> Job:
    """Build and store a QUEUED job without handing it to the executor.

    Letting the pool run it would race every assertion about claiming.

    Args:
        **overrides: Field overrides.

    Returns:
        The stored job.
    """
    fields: dict[str, Any] = {
        "id": "test-job",
        "status": JobStatus.QUEUED,
        "backend": "aer_simulator",
        "shots": 16,
        "qasm": BELL,
        "created_at": utc_now_iso(),
    }
    fields.update(overrides)
    return queue.get_store().put(Job(**fields))


# ---------------------------------------------------------------------------
# At-most-once: a job is claimed by exactly one executor
# ---------------------------------------------------------------------------


def test_only_one_caller_can_claim_a_queued_job() -> None:
    """The claim is a compare-and-swap, not a read followed by a write.

    Without this, an API process and a standalone worker sharing a store both
    saw QUEUED and both executed. On a simulator that is wasted CPU; through
    HARDWARE_SUBMITTER it is the same circuit submitted to a paid QPU twice.
    """
    store = queue.get_store()
    _queued_job()

    first = store.claim("test-job", "worker-a")
    second = store.claim("test-job", "worker-b")

    assert first is not None and first.status is JobStatus.RUNNING
    assert first.worker == "worker-a"
    assert second is None, "a second worker claimed a job that was already RUNNING"


def test_concurrent_claims_produce_exactly_one_winner() -> None:
    """Hammer the claim from many threads at once and count the winners.

    The sequential test above passes even against the old get-check-update code
    if the two calls do not interleave. This one is the version that fails
    against it, because the whole point is the interleaving.
    """
    store = queue.get_store()
    _queued_job()

    winners: list[str] = []
    lock = threading.Lock()
    barrier = threading.Barrier(16)

    def attempt(index: int) -> None:
        """Try to claim the shared job at the same moment as everyone else."""
        barrier.wait()
        claimed = store.claim("test-job", f"worker-{index}")
        if claimed is not None:
            with lock:
                winners.append(claimed.worker or "?")

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(16)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(winners) == 1, f"{len(winners)} workers claimed the same job: {winners}"


def test_a_cancelled_job_cannot_be_claimed() -> None:
    """Cancellation is only meaningful if the claim respects it.

    A drain pass that read the id list before the cancellation landed will still
    call _execute on it; the claim is what stops the circuit from running.
    """
    store = queue.get_store()
    _queued_job(status=JobStatus.CANCELLED)
    assert store.claim("test-job", "worker-a") is None


def test_executing_an_already_claimed_job_is_a_no_op() -> None:
    """_execute must not overwrite the result of the worker that owns the job."""
    store = queue.get_store()
    _queued_job()
    store.claim("test-job", "the-real-worker")

    queue._execute("test-job")

    job = store.get("test-job")
    assert job is not None
    assert job.status is JobStatus.RUNNING, "a second executor took over a running job"
    assert job.worker == "the-real-worker"


# ---------------------------------------------------------------------------
# Duplicate submission
# ---------------------------------------------------------------------------


def test_the_same_idempotency_key_returns_the_same_job() -> None:
    """A client retry after a timeout must not run the circuit twice."""
    request = JobRequest(qasm=BELL, shots=16, user_id="u1", idempotency_key="retry-1")
    first = queue.submit(request)
    second = queue.submit(request)

    assert first.id == second.id
    _wait_for(first.id)
    assert len(queue.list_jobs(user_id="u1")) == 1


def test_the_key_still_dedupes_after_the_job_has_finished() -> None:
    """Deduplication that expires on completion is a race, not a guarantee.

    A client whose request timed out cannot know whether the job finished; if
    the key stopped working the moment it did, the retry would run it again —
    which is precisely the window a retry is most likely to land in.
    """
    request = JobRequest(qasm=BELL, shots=16, user_id="u1", idempotency_key="retry-2")
    first = queue.submit(request)
    finished = _wait_for(first.id)
    assert finished.status is JobStatus.DONE

    again = queue.submit(request)
    assert again.id == first.id
    assert again.status is JobStatus.DONE


def test_different_users_do_not_share_an_idempotency_namespace() -> None:
    """A bare client-chosen key is a shared namespace, which leaks results.

    Two users both sending "retry-1" must not be handed each other's job — that
    would return one user's circuit and measurement results to the other.
    """
    first = queue.submit(
        JobRequest(qasm=BELL, shots=16, user_id="alice", idempotency_key="retry-1")
    )
    second = queue.submit(
        JobRequest(qasm=BELL, shots=16, user_id="bob", idempotency_key="retry-1")
    )
    assert first.id != second.id
    assert first.user_id == "alice" and second.user_id == "bob"


def test_without_a_key_two_identical_submissions_are_two_jobs() -> None:
    """The default is NOT deduplication, and that is deliberate.

    Re-running the same circuit to see a different sample is a normal thing for
    a learner to do, so silently returning the first run's counts would be
    wrong. Duplicate suppression is opt-in.
    """
    request = JobRequest(qasm=BELL, shots=16, user_id="u2")
    first = queue.submit(request)
    second = queue.submit(request)
    assert first.id != second.id


# ---------------------------------------------------------------------------
# A dead worker
# ---------------------------------------------------------------------------


def _age_running_job(job_id: str, seconds: float) -> None:
    """Backdate a RUNNING job's start time to simulate a long-dead worker.

    Args:
        job_id: The job to backdate.
        seconds: How far into the past to move ``started_at``.
    """
    past = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
    queue.get_store().update(job_id, started_at=past)


def test_a_job_whose_worker_died_is_failed_not_left_running() -> None:
    """The failure mode: a SIGKILLed worker strands its job in RUNNING forever.

    Nothing else in the system moves it. The client polls it until the user
    gives up, count_active never drops, and the queue looks permanently busy.
    """
    store = queue.get_store()
    _queued_job()
    store.claim("test-job", "worker-that-will-die")
    _age_running_job("test-job", queue.JOB_LEASE_SECONDS + 60)

    reaped = queue.reap_stale_jobs(force=True)

    assert reaped == ["test-job"]
    job = store.get("test-job")
    assert job is not None
    assert job.status is JobStatus.ERROR
    assert "stopped responding" in (job.error or "")
    # The user must be told to resubmit, because we will not do it for them.
    assert "Resubmit" in (job.error or "")


def test_a_job_still_within_its_lease_is_untouched() -> None:
    """A slow job is not a dead job. Reaping one would be worse than the bug."""
    store = queue.get_store()
    _queued_job()
    store.claim("test-job", "worker-a")

    assert queue.reap_stale_jobs(force=True) == []
    job = store.get("test-job")
    assert job is not None and job.status is JobStatus.RUNNING


def test_a_reaped_job_is_not_retried() -> None:
    """At-most-once, stated as a test.

    This is the guarantee, and it is a choice with a cost: a job lost to a
    machine failure is lost, and the user resubmits. The alternative —
    at-least-once — would re-run a job whose worker died at an unknown point,
    and the same code path can submit to a paid QPU through
    HARDWARE_SUBMITTER. Double-spending somebody's money on an ambiguous crash
    is worse than making them press the button again.
    """
    store = queue.get_store()
    _queued_job()
    store.claim("test-job", "worker-a")
    _age_running_job("test-job", queue.JOB_LEASE_SECONDS + 60)
    queue.reap_stale_jobs(force=True)

    # No re-queue, and nothing re-claims it: the state is terminal.
    job = store.get("test-job")
    assert job is not None and job.status.is_terminal
    assert store.claim("test-job", "worker-b") is None
    assert queue.reap_stale_jobs(force=True) == [], "a reaped job was reaped twice"


def test_a_running_job_with_no_start_time_is_reaped() -> None:
    """An unagable job would otherwise be immortal.

    ``started_at`` is written by the claim, so a RUNNING job without one means
    the store was written by something that did not claim properly — a partial
    write, or an older format. It cannot be aged, so it is presumed dead rather
    than left to sit in RUNNING for the lifetime of the process.
    """
    store = queue.get_store()
    _queued_job(status=JobStatus.RUNNING, started_at=None)
    assert queue.reap_stale_jobs(force=True) == ["test-job"]


def test_the_reaper_actually_runs_on_the_normal_read_path() -> None:
    """The reaper has real callers, not just a test.

    A cleanup function nobody calls is the exact failure this codebase has been
    bitten by before. queue.get(), list_jobs() and stats() each invoke it, so a
    stuck job is cleaned up by the next poll from any client.
    """
    store = queue.get_store()
    _queued_job()
    store.claim("test-job", "worker-a")
    _age_running_job("test-job", queue.JOB_LEASE_SECONDS + 60)

    queue._last_reap = 0.0
    observed = queue.get("test-job")

    assert observed is not None
    assert observed.status is JobStatus.ERROR, (
        "polling a job whose worker died still reported RUNNING; reap_stale_jobs "
        "is not wired into the read path"
    )


def test_stats_does_not_count_a_dead_job_as_active() -> None:
    """The operator-facing number has to reflect the reaping too."""
    store = queue.get_store()
    _queued_job()
    store.claim("test-job", "worker-a")
    _age_running_job("test-job", queue.JOB_LEASE_SECONDS + 60)

    queue._last_reap = 0.0
    assert queue.stats()["active"] == 0


# ---------------------------------------------------------------------------
# Restart
# ---------------------------------------------------------------------------


def test_restarting_the_in_memory_store_loses_every_job() -> None:
    """Documented, not fixed: MemoryJobStore is not durable.

    This is asserted rather than merely written down so that nobody adds
    persistence on the quiet and leaves docs/JOBS.md claiming otherwise — and so
    that a reader who wants durability is pointed at REDIS_URL by a failure
    rather than by a surprise in production.
    """
    submitted = queue.submit(JobRequest(qasm=BELL, shots=16))
    _wait_for(submitted.id)

    reset_store(MemoryJobStore())  # stands in for a process restart

    assert queue.get(submitted.id) is None
