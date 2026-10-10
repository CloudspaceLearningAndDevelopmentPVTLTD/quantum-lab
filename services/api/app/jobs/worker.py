"""Standalone queue worker: ``python -m app.jobs.worker``.

You do NOT need this to use the queue. A single API process already runs jobs in
its own :class:`~concurrent.futures.ThreadPoolExecutor` (see :mod:`app.jobs.queue`),
and with the default in-memory store that is the whole system.

This process only becomes useful once you scale past one API process, which
means you are running with ``REDIS_URL`` set and a shared
:class:`~app.jobs.store.RedisJobStore`. Then the API can stay a thin, fast
front end that only enqueues, while one or more of these workers poll Redis for
QUEUED jobs and burn the CPU. With the in-memory store a separate process shares
no state with the API and would find nothing to do, so the worker warns and
exits unless ``--allow-memory`` is passed (handy for a local smoke test).

Usage::

    REDIS_URL=redis://localhost:6379/0 python -m app.jobs.worker
    REDIS_URL=redis://localhost:6379/0 python -m app.jobs.worker --once
    python -m app.jobs.worker --once --allow-memory   # local smoke test

SIGINT (Ctrl-C) sets a stop flag: the worker finishes the job in hand and exits
cleanly rather than stranding it in RUNNING.
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
import time
from types import FrameType

from app.jobs.models import JobStatus
from app.jobs.queue import _execute, reap_stale_jobs
from app.jobs.store import MemoryJobStore, get_store

logger = logging.getLogger("app.jobs.worker")

_stop = threading.Event()


def request_stop(signum: int, frame: FrameType | None) -> None:
    """Signal handler that asks the polling loop to finish and exit.

    Args:
        signum: The received signal number.
        frame: The interrupted stack frame, unused.
    """
    logger.info("Received signal %s; finishing the current job and stopping.", signum)
    _stop.set()


def drain_once(limit: int = 100) -> int:
    """Execute every job that is currently QUEUED, then return.

    Args:
        limit: How many jobs to look at in this pass.

    Returns:
        The number of jobs executed.
    """
    # Reap before draining. A worker that was killed mid-job left that job in
    # RUNNING; a replacement worker starting up is exactly the moment somebody
    # should notice. The API's read paths also reap, so this is belt and braces
    # for a deployment where nobody is polling.
    reap_stale_jobs()

    store = get_store()
    queued_ids = getattr(store, "queued_ids", None)
    if callable(queued_ids):
        job_ids = list(queued_ids(limit))
    else:
        jobs = [job for job in store.list(limit=limit) if job.status is JobStatus.QUEUED]
        jobs.sort(key=lambda job: job.created_at)
        job_ids = [job.id for job in jobs]

    executed = 0
    for job_id in job_ids:
        if _stop.is_set():
            break
        _execute(job_id)
        executed += 1
    return executed


def run_forever(poll_interval: float = 1.0) -> None:
    """Poll the store for queued work until a stop signal arrives.

    Args:
        poll_interval: Seconds to sleep when a pass finds nothing to do.
    """
    logger.info("Worker started; polling every %.1fs. Ctrl-C to stop.", poll_interval)
    while not _stop.is_set():
        try:
            executed = drain_once()
        except Exception:  # noqa: BLE001 - a bad pass must not kill the worker
            logger.exception("Drain pass failed; retrying after the poll interval.")
            executed = 0
        if executed == 0:
            _stop.wait(poll_interval)
    logger.info("Worker stopped.")


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and run the worker.

    Args:
        argv: Command line arguments; ``sys.argv[1:]`` when None.

    Returns:
        A process exit code: 0 on success, 1 when refusing to run.
    """
    parser = argparse.ArgumentParser(
        prog="python -m app.jobs.worker",
        description="Execute queued Qubit16 jobs from a shared store.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single drain pass over the queued jobs and exit.",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=1.0,
        help="Seconds between polls when the queue is empty (default: 1.0).",
    )
    parser.add_argument(
        "--allow-memory",
        action="store_true",
        help="Run even with the in-process store, which shares no state with the API.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Logging level name (default: INFO).",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    store = get_store()
    if isinstance(store, MemoryJobStore) and not args.allow_memory:
        logger.error(
            "The job store is in-memory, so this process shares no queue with the API. "
            "Set REDIS_URL to a reachable Redis instance, or pass --allow-memory to "
            "run against this process's own store anyway."
        )
        return 1

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    if args.once:
        started = time.perf_counter()
        executed = drain_once()
        logger.info(
            "Drained %d job(s) in %.2fs.", executed, time.perf_counter() - started
        )
        return 0

    run_forever(args.poll_interval)
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point
    sys.exit(main())
