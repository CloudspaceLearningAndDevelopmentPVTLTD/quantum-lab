"""Offline tests for the asynchronous job queue.

Everything here runs in-process against the bundled Aer simulator and the
in-memory job store: no Redis, no network, no optional vendor SDKs.
"""

from __future__ import annotations

import time

import pytest

from app.core.config import settings
from app.jobs import queue
from app.jobs.models import Job, JobRequest, JobStatus, utc_now_iso
from app.jobs.store import MemoryJobStore, reset_store
from app.quantum.presets import get_preset

TIMEOUT_SECONDS = 10.0
POLL_SECONDS = 0.05


@pytest.fixture(autouse=True)
def fresh_store() -> None:
    """Give every test an empty in-memory store."""
    reset_store(MemoryJobStore())


def _qasm(preset_id: str) -> str:
    """Fetch a preset's QASM source, failing loudly if the preset is missing.

    Args:
        preset_id: The preset key.

    Returns:
        The OpenQASM source string.
    """
    preset = get_preset(preset_id)
    assert preset is not None, f"preset {preset_id} should exist"
    return preset["qasm"]


def _wide_qasm(num_qubits: int) -> str:
    """Build a valid OpenQASM 2 circuit of the requested width.

    Args:
        num_qubits: How many qubits the register should hold.

    Returns:
        OpenQASM 2 source declaring ``num_qubits`` qubits with one H gate.
    """
    return (
        'OPENQASM 2.0;\ninclude "qelib1.inc";\n'
        f"qreg q[{num_qubits}];\ncreg c[{num_qubits}];\n"
        "h q[0];\nmeasure q -> c;\n"
    )


def wait_for(job_id: str, timeout: float = TIMEOUT_SECONDS) -> Job:
    """Poll a job until it reaches a terminal state.

    Args:
        job_id: The job identifier returned by :func:`app.jobs.queue.submit`.
        timeout: Hard upper bound in seconds before the test fails.

    Returns:
        The job in its terminal state.
    """
    deadline = time.monotonic() + timeout
    job = queue.get(job_id)
    while time.monotonic() < deadline:
        job = queue.get(job_id)
        assert job is not None, f"job {job_id} disappeared from the store"
        if job.status.is_terminal:
            return job
        time.sleep(POLL_SECONDS)
    pytest.fail(
        f"job {job_id} did not finish within {timeout}s "
        f"(last status: {job.status if job else 'missing'})"
    )


def test_submit_returns_queued_job_with_id() -> None:
    """Submission is synchronous and hands back an identified QUEUED job."""
    job = queue.submit(JobRequest(qasm=_qasm("bell"), shots=256))

    assert job.id
    assert job.status is JobStatus.QUEUED
    assert job.backend == "aer_simulator"
    assert job.shots == 256
    assert job.result is None
    assert job.duration_ms is None

    wait_for(job.id)


def test_bell_job_completes_with_correlated_counts() -> None:
    """Polling a Bell job to DONE yields counts containing only 00 and 11."""
    job = queue.submit(JobRequest(qasm=_qasm("bell"), shots=1000, label="bell"))
    finished = wait_for(job.id)

    assert finished.status is JobStatus.DONE, finished.error
    assert finished.error is None
    assert finished.result is not None
    assert set(finished.result["counts"]) <= {"00", "11"}
    assert sum(finished.result["counts"].values()) == 1000
    assert finished.progress == 1.0
    assert finished.duration_ms is not None and finished.duration_ms >= 0


def test_invalid_qasm_raises_at_submit_time() -> None:
    """Unparseable source is rejected synchronously, not asynchronously."""
    with pytest.raises(ValueError):
        queue.submit(JobRequest(qasm="this is not qasm"))

    assert queue.list_jobs() == []


def test_shots_out_of_range_raises() -> None:
    """Shot counts outside the configured window are rejected at submit time."""
    with pytest.raises(ValueError):
        queue.submit(JobRequest.model_construct(qasm=_qasm("bell"), shots=0, noise=0.0))
    with pytest.raises(ValueError):
        queue.submit(
            JobRequest.model_construct(
                qasm=_qasm("bell"), shots=settings.max_shots + 1, noise=0.0
            )
        )

    assert queue.list_jobs() == []


def test_too_many_qubits_raises_naming_the_limit() -> None:
    """An over-wide circuit is rejected with a message naming the qubit limit."""
    with pytest.raises(ValueError) as excinfo:
        queue.submit(JobRequest(qasm=_wide_qasm(settings.max_qubits + 6), shots=64))

    assert str(settings.max_qubits) in str(excinfo.value)


def test_cancel_queued_job_then_finished_job() -> None:
    """Cancelling works only before execution starts."""
    store = reset_store(MemoryJobStore())
    pending = Job(
        id="pending-job",
        status=JobStatus.QUEUED,
        backend="aer_simulator",
        shots=64,
        qasm=_qasm("bell"),
        created_at=utc_now_iso(),
    )
    store.put(pending)

    assert queue.cancel(pending.id) is True
    cancelled = queue.get(pending.id)
    assert cancelled is not None and cancelled.status is JobStatus.CANCELLED
    # A second attempt on a terminal job is a no-op.
    assert queue.cancel(pending.id) is False

    done = wait_for(queue.submit(JobRequest(qasm=_qasm("bell"), shots=64)).id)
    assert done.status is JobStatus.DONE
    assert queue.cancel(done.id) is False
    assert queue.cancel("no-such-job") is False


def test_cancelled_job_is_not_executed() -> None:
    """The worker body refuses to start a job that was cancelled while queued."""
    store = reset_store(MemoryJobStore())
    store.put(
        Job(
            id="cancelled-job",
            status=JobStatus.CANCELLED,
            backend="aer_simulator",
            shots=64,
            qasm=_qasm("bell"),
            created_at=utc_now_iso(),
        )
    )

    queue._execute("cancelled-job")

    job = queue.get("cancelled-job")
    assert job is not None
    assert job.status is JobStatus.CANCELLED
    assert job.result is None


def test_list_jobs_filters_by_user_id() -> None:
    """Listing with a user_id returns only that user's jobs."""
    alice = queue.submit(JobRequest(qasm=_qasm("bell"), shots=64, user_id="alice"))
    bob = queue.submit(JobRequest(qasm=_qasm("bell"), shots=64, user_id="bob"))
    anon = queue.submit(JobRequest(qasm=_qasm("bell"), shots=64))
    for job in (alice, bob, anon):
        wait_for(job.id)

    alice_jobs = queue.list_jobs(user_id="alice")
    assert [job.id for job in alice_jobs] == [alice.id]
    assert {job.id for job in queue.list_jobs(user_id="bob")} == {bob.id}
    assert len(queue.list_jobs()) == 3
    assert len(queue.list_jobs(limit=1)) == 1


def test_stats_reports_counts_and_pool_size() -> None:
    """stats() reflects the store contents and the worker pool size."""
    empty = queue.stats()
    assert empty["total"] == 0
    assert empty["counts"][JobStatus.DONE.value] == 0
    assert empty["workers"] == queue.MAX_WORKERS
    assert empty["store"] == "MemoryJobStore"

    first = queue.submit(JobRequest(qasm=_qasm("bell"), shots=64))
    second = queue.submit(JobRequest(qasm=_qasm("bell"), shots=64))
    wait_for(first.id)
    wait_for(second.id)

    after = queue.stats()
    assert after["total"] == 2
    assert after["counts"][JobStatus.DONE.value] == 2
    assert after["counts"][JobStatus.ERROR.value] == 0
    assert after["active"] == 0
    assert after["hardware_submitter"] is False


def test_error_job_records_message() -> None:
    """A failure discovered during execution lands in the job's error field."""
    store = reset_store(MemoryJobStore())
    store.put(
        Job(
            id="doomed-job",
            status=JobStatus.QUEUED,
            backend="aer_simulator",
            shots=64,
            qasm="not valid qasm at all",
            created_at=utc_now_iso(),
        )
    )

    queue._execute("doomed-job")

    job = queue.get("doomed-job")
    assert job is not None
    assert job.status is JobStatus.ERROR
    assert job.error and "parse" in job.error.lower()
    assert job.finished_at is not None


def _job(job_id: str, status: JobStatus) -> Job:
    """Build a bare job for store-level tests.

    Args:
        job_id: The identifier to use.
        status: The lifecycle state to start in.

    Returns:
        A minimal :class:`Job`.
    """
    return Job(
        id=job_id,
        status=status,
        backend="aer_simulator",
        shots=64,
        created_at=utc_now_iso(),
    )


def test_memory_store_evicts_finished_but_never_running() -> None:
    """The bounded store drops old finished jobs and keeps active ones."""
    store = MemoryJobStore(max_jobs=3)
    store.put(_job("running", JobStatus.RUNNING))
    store.put(_job("queued", JobStatus.QUEUED))
    for index in range(6):
        store.put(_job(f"done-{index}", JobStatus.DONE))

    assert len(store.list(limit=100)) == 3
    assert store.get("running") is not None
    assert store.get("queued") is not None
    assert store.get("done-0") is None
    assert store.get("done-5") is not None
    assert store.count_active() == 2


def test_memory_store_never_evicts_below_active_jobs() -> None:
    """When every retained job is active the bound yields rather than losing work."""
    store = MemoryJobStore(max_jobs=2)
    for index in range(5):
        store.put(_job(f"active-{index}", JobStatus.RUNNING))

    assert len(store.list(limit=100)) == 5
    assert store.count_active() == 5


def test_memory_store_update_and_delete() -> None:
    """update() patches fields in place and delete() reports what it removed."""
    store = MemoryJobStore()
    store.put(_job("patch-me", JobStatus.QUEUED))

    updated = store.update("patch-me", status=JobStatus.DONE, progress=1.0)
    assert updated is not None and updated.status is JobStatus.DONE
    assert store.update("missing", status=JobStatus.DONE) is None

    assert store.delete("patch-me") is True
    assert store.delete("patch-me") is False


def test_hardware_submitter_hook_routes_non_simulator_backends() -> None:
    """A hardware backend is refused by default and routed once the hook is set."""
    with pytest.raises(ValueError) as excinfo:
        queue.submit(JobRequest(qasm=_qasm("bell"), backend="ibm_quantum", shots=64))
    assert "hardware" in str(excinfo.value).lower()

    calls: list[str] = []

    def fake_submitter(job: Job) -> dict[str, object]:
        """Stand in for a real hardware submitter.

        Args:
            job: The job being executed.

        Returns:
            A runner-shaped result dictionary.
        """
        calls.append(job.id)
        return {"counts": {"00": job.shots}, "backend": job.backend, "shots": job.shots}

    queue.HARDWARE_SUBMITTER = fake_submitter
    try:
        job = queue.submit(JobRequest(qasm=_qasm("bell"), backend="ibm_quantum", shots=64))
        finished = wait_for(job.id)
    finally:
        queue.HARDWARE_SUBMITTER = None

    assert calls == [job.id]
    assert finished.status is JobStatus.DONE, finished.error
    assert finished.result is not None and finished.result["counts"] == {"00": 64}


def test_worker_drain_once_executes_queued_jobs() -> None:
    """The standalone worker's single-pass drain runs everything that is QUEUED."""
    from app.jobs import worker

    store = reset_store(MemoryJobStore())
    store.put(
        Job(
            id="drain-me",
            status=JobStatus.QUEUED,
            backend="aer_simulator",
            shots=128,
            qasm=_qasm("bell"),
            created_at=utc_now_iso(),
        )
    )

    assert worker.drain_once() == 1

    job = queue.get("drain-me")
    assert job is not None and job.status is JobStatus.DONE
    assert job.result is not None and set(job.result["counts"]) <= {"00", "11"}
