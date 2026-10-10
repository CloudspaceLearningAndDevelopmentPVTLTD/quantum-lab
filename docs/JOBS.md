# The job queue

`services/api/app/jobs/` — what it guarantees, what it does not, and what
happens in each of the four ways it can go wrong.

Everything below is enforced by `services/api/tests/test_jobs_semantics.py`.
If a claim here is not backed by a test there, treat it as aspiration.

---

## 1. The delivery guarantee, stated

**At-most-once.** A submitted job runs zero or one times. It is never retried
automatically, and a job whose worker died is reported as failed rather than
re-queued.

That is a choice, and it has a cost: a job lost to a machine failure is lost,
and the user resubmits. The alternative — at-least-once — would re-run a job
whose worker died at an unknown point, and `HARDWARE_SUBMITTER` in
`app/jobs/queue.py` routes non-simulator backends to a real QPU. Re-running
after an ambiguous crash means submitting the same circuit to a paid device
twice, discovered on an invoice. Making a learner press the button again is
worse for them and cheaper for everyone.

If a future deployment wants at-least-once for simulator backends only, the
place to do it is `_reaped_fields` in `app/jobs/store.py`: it currently writes
`ERROR`, and would write `QUEUED` with an attempt counter. Do not make it
unconditional.

## 2. The four failure modes

### The worker dies mid-job

The job was claimed and moved to `RUNNING`. Nothing else in the process can
move it, because the thread that owned it is gone.

Before August 2026 that job stayed `RUNNING` forever: the client's JobMonitor
polled it indefinitely, `count_active` never dropped, and `/api/jobs/stats` told
an operator the queue was busy when it was idle.

Now every job carries a **lease**. `JobStore.reap_expired` fails any job that
has been `RUNNING` longer than `JOB_LEASE_SECONDS` (900 s), with an error that
says the worker stopped responding, that the job was *not* retried, and that the
user should resubmit.

900 s is derived, not guessed. The slowest job this service accepts is a
24-qubit ideal simulation, measured at 4.5 s (Aer) to 7.4 s (PennyLane
lightning) at 1024 shots; the noisy path is capped at 12 qubits and scales to
roughly 20 s at the 20 000-shot maximum. The lease is two orders of magnitude
above that, so no legitimate job can be reaped by a slow box.

The reaper runs on the **read path** — `queue.get`, `queue.list_jobs` and
`queue.stats` each call it, throttled to one pass per 30 s — and at the top of
the standalone worker's drain loop. There is no background thread. The
consequence is that a stuck job is cleaned up the next time anyone looks at the
queue rather than on a timer, which is sufficient because the only observer that
cares is the client polling it.

A `RUNNING` job with no `started_at` is also reaped. It cannot be aged, so
leaving it would make it immortal.

### A provider times out

Only relevant when `HARDWARE_SUBMITTER` is installed, and **it is not installed
by anything in this repository today** — the hook is `None`, and `_validate`
refuses a hardware backend at submit time with a message saying so. What follows
is the contract a future implementation must honour.

Submission to a QPU is fire-and-forget by design (`app/quantum/hardware.py`):
`submit_*_job` transpiles, enqueues and returns a handle without waiting, so a
provider that is slow to *accept* a job blocks a worker thread and a provider
that is slow to *run* one does not. Results are collected by polling
`/api/hardware/job/{provider}/{id}`, which is a separate path that does not
involve this queue at all.

The exposure is therefore the accept call. It is bounded by the vendor SDK's own
HTTP timeout, which this service does not configure and cannot assume. With four
worker threads (`MAX_WORKERS`), four simultaneously hung submissions stall the
queue until the SDK gives up, and the lease then fails those jobs at 900 s.
**Anything that makes `HARDWARE_SUBMITTER` block for the duration of a QPU queue
— minutes to hours — breaks the lease calculation in §2 and must raise
`JOB_LEASE_SECONDS` with it.**

### The same job is submitted twice

By default, two identical submissions are two jobs. That is deliberate: re-running
a circuit to see a different sample is a normal thing for a learner to do, and
silently returning the first run's counts would be wrong.

When a caller cannot tolerate that — a retry after a network timeout, where it
cannot know whether the first request landed — it sends an `idempotency_key`.
The first submission to use that key creates the job; every later one returns
**that same job**, including while it is still running and including after it
has finished. Deduplication that expired on completion would be a race, since a
retry is most likely to arrive exactly in that window.

Keys are namespaced by `user_id` (`app/jobs/queue.py::_idempotency_scope`). A
bare client-chosen key is a shared namespace: two users both sending `retry-1`
would otherwise be handed each other's circuits and measurement results.
Anonymous submissions share an `anon` scope, which is why the field is
documented as client-generated and expected to be random.

The reservation is written **before** the job is stored. The reverse order
leaves an orphan job behind on every losing race.

Keys expire — with the job's 24 h Redis TTL, or when the in-memory map is
trimmed at 500 entries. An expired key means a resubmission creates a second job
instead of being deduplicated. That is the safe direction: this is a
convenience, not a ledger.

### The store is restarted

Depends entirely on which store.

`MemoryJobStore` (the default) **loses everything**. A restart drops every job,
queued, running and finished; polling any of them returns 404. This is asserted
by a test rather than only written down, so that nobody adds partial persistence
and leaves this document claiming otherwise. If you need jobs to survive a
restart, set `REDIS_URL`.

`RedisJobStore` keeps jobs for 24 h. A restart of the API does not lose them.
What it does lose is the *executor*: a job that was `QUEUED` when the process
died is still `QUEUED` in Redis and nothing in the new process knows to pick it
up, because `submit` hands work to the thread pool in-process. A standalone
`python -m app.jobs.worker` polls Redis for `QUEUED` jobs and is the supported
answer to that — with one running, a restarted API's orphaned queue drains.
Jobs that were `RUNNING` are handled by the lease.

## 3. Double execution, and the claim that prevents it

Two things can execute a job: the API's own `ThreadPoolExecutor`, and any number
of `app.jobs.worker` processes sharing a Redis store. Both call `_execute`.

`_execute` used to begin with:

```python
job = store.get(job_id)
if job.status is not JobStatus.QUEUED: return
store.update(job_id, status=RUNNING)
```

which is a read, a decision and a write with two gaps in between. Two drainers
both saw `QUEUED` and both ran the circuit. On a simulator that is wasted CPU.
Through `HARDWARE_SUBMITTER` it is the same circuit submitted to a paid QPU
twice — the same class of bug as the unauthenticated `/submit` route the last
audit found, reached from inside instead of outside.

It is now `JobStore.claim(job_id, owner)`, a compare-and-swap that exactly one
caller can win:

* `MemoryJobStore` does the check and the write under the same lock.
* `RedisJobStore` writes `qlab:claim:<id>` with `SET NX EX`, which is atomic
  across processes, then verifies the status. A Redis failure returns "not
  claimed" — **fail closed**, because running a job we could not claim risks
  running it twice.

The claim also records **who** holds the job (`worker`, as
`hostname/pid/thread`), so a job stuck in `RUNNING` names the process to go and
look at.

Cancellation depends on this too. A drain pass that read the id list before a
cancellation landed still calls `_execute`; the claim is what stops the circuit
from running.

## 4. What is still open

* **A `RUNNING` job has no timeout, only a lease.** The lease reports the job as
  failed at 900 s; it does not stop the work. Aer executes inside a compiled
  extension with no cancellation point, so the thread runs to completion and its
  result is discarded. The bound that actually protects the process is the
  width cap in `app/quantum/limits.py`, which refuses jobs that would run long
  in the first place. Killing a running simulation needs a subprocess per job,
  which is a much larger change.
* **`cancel()` cannot stop a running job**, for the same reason. Only a `QUEUED`
  job can be cancelled.
* **The lease is not a heartbeat.** A worker that is alive but wedged — blocked
  on a socket, say — is indistinguishable from a dead one after 900 s, and its
  job is failed while it may still be running. With at-most-once semantics that
  is the harmless direction (we under-report success, we do not double-execute),
  but a client can in principle see `ERROR` for a job that later completes
  in a worker nobody is watching. A real heartbeat would have the worker renew
  the claim key periodically.
* **`queued_ids` and `count_active` only see the last 500 jobs** on Redis, the
  bound on the index lists. A queue deeper than that is not a shape this service
  is built for.
* **These routes are not proxied.** `docs/HARDWARE.md` §2 lists the five that
  the Next server republishes; `/api/jobs/*` is not among them. They are
  reachable only by whoever can reach the Python port directly, which is the
  whole argument for keeping that port private (`docs/SECURITY.md` §4). There is
  no per-user authorisation on them: `user_id` is an opaque *filter*, not an
  identity, and anyone who can reach the port can list and read anyone's jobs by
  passing their id. Do not proxy these without adding one.
