# Asynchronous Job Queue

## Why this exists

`POST /api/circuits/run` executes a circuit and returns the counts in the same
HTTP response. That works because an Aer simulation of a small circuit finishes
in milliseconds. It stops working the moment the target is real hardware: an IBM
Quantum job sits in a shared queue and can take **minutes to hours** before it
even starts. Holding an HTTP connection open for that is wrong in every
direction — the client times out, the reverse proxy times out, a worker thread
is pinned for the whole wait, and a dropped connection loses the result of a run
that already cost real money.

The queue replaces "run and wait" with **submit and poll**:

1. `POST /api/jobs` validates the circuit and returns a job id immediately
   (`202 Accepted`).
2. The client polls `GET /api/jobs/{id}` until `status` is terminal.
3. `DONE` carries the full `result` payload; `ERROR` carries an `error` message.

Long simulations benefit from the same shape: a 20-qubit, 20,000-shot run takes
tens of seconds and should not block a request handler either.

## Job lifecycle

```
QUEUED ──► RUNNING ──► DONE
   │           └─────► ERROR
   └─────────────────► CANCELLED
```

`QUEUED`, `RUNNING` are active states; `DONE`, `ERROR`, `CANCELLED` are terminal
and never transition again.

## Endpoints

| Method | Path                      | Purpose                                  |
| ------ | ------------------------- | ---------------------------------------- |
| POST   | `/api/jobs`               | Submit a circuit, returns `202` + a `Job` |
| GET    | `/api/jobs/{job_id}`      | Poll one job (`404` when unknown)         |
| GET    | `/api/jobs`               | List job summaries (`?user_id=&limit=`)   |
| DELETE | `/api/jobs/{job_id}`      | Cancel a queued job                       |
| GET    | `/api/jobs/stats/summary` | Counts by status plus worker pool size    |

The router lives in `app/routers/jobs.py`. It is registered with:

```python
from app.routers import jobs
app.include_router(jobs.router)
```

### Submit

```bash
curl -sS -X POST http://localhost:8000/api/jobs \
  -H 'content-type: application/json' \
  -d '{
        "qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc = measure q;\n",
        "backend": "aer_simulator",
        "shots": 4096,
        "user_id": "alice",
        "label": "bell pair"
      }'
```

```json
{
  "id": "9f1c0a7d2b4e4c8fa1d3e5b7c9d1f3a5",
  "status": "QUEUED",
  "backend": "aer_simulator",
  "shots": 4096,
  "created_at": "2026-08-16T09:12:44.118293+00:00",
  "progress": 0.0,
  "queue_position": 0,
  "duration_ms": null
}
```

Validation is **synchronous**. Bad shots, unparseable QASM, an unknown backend
or a circuit wider than `MAX_QUBITS` all come back as `400` from this call — you
never have to poll a job to discover the request itself was malformed.

### Poll

```bash
JOB=9f1c0a7d2b4e4c8fa1d3e5b7c9d1f3a5
until curl -sS "http://localhost:8000/api/jobs/$JOB" | tee /tmp/job.json \
      | grep -qE '"status":"(DONE|ERROR|CANCELLED)"'; do sleep 1; done
cat /tmp/job.json
```

A one-second poll interval is the right order of magnitude for simulator jobs;
use five to thirty seconds for hardware. There is no long-poll or websocket
endpoint — polling a cheap in-memory read is not worth the extra machinery.

### List and stats

```bash
curl -sS 'http://localhost:8000/api/jobs?user_id=alice&limit=20'
curl -sS 'http://localhost:8000/api/jobs/stats/summary'
```

The list endpoint returns `JobSummary` objects, which deliberately omit the
`result` payload — a hundred jobs with a hundred count dictionaries is a large
response nobody reads. Fetch the individual job to get its result.

### Cancel

```bash
curl -sS -X DELETE "http://localhost:8000/api/jobs/$JOB"
# {"cancelled": true}
```

## Cancellation semantics

**Only a `QUEUED` job can be cancelled.** `DELETE` on a job that is already
`RUNNING`, `DONE`, `ERROR` or `CANCELLED`, or on an unknown id, returns
`{"cancelled": false}`. This is honest rather than convenient:

- A running Aer simulation executes inside a compiled C++ extension with no
  cancellation point. Python cannot interrupt it, and killing the thread would
  corrupt the interpreter. The worker runs to completion; only the *result* is
  discarded.
- A cancelled job is marked terminal immediately, and the worker thread checks
  the status again before it starts work — so a job cancelled during the window
  between submission and pickup never executes at all.
- A future hardware submitter can implement real remote cancellation (vendor
  APIs do support cancelling a queued hardware job) on top of the same endpoint.

## Store: memory vs Redis

The queue persists jobs behind the `JobStore` protocol in `app/jobs/store.py`.

**`MemoryJobStore` (default).** A dict guarded by a `threading.Lock`. No
dependencies, no configuration, and the right choice for a single API process —
which is how the service is normally deployed. It retains at most **500 jobs**
and evicts the oldest *finished* job when it exceeds that: each finished job
holds a full counts dictionary, so an unbounded dict is a slow memory leak in a
long-lived process. Queued and running jobs are never evicted, because dropping
one would strand a client polling for a result that is still coming.

Its limits are inherent, not bugs: jobs die with the process, and a second API
process (a second uvicorn worker, a second container) has its own separate
queue, so a client that submits to one and polls the other gets a `404`.

**`RedisJobStore`.** Each job is one JSON blob at `qlab:job:<id>` with a 24-hour
TTL, plus a global and a per-user index list so listing does not need `SCAN`.
Redis failures are logged and degrade to empty answers rather than raising into
a request handler — the store is a cache, not a system of record.

**Switch to Redis when** you run more than one API process behind a load
balancer, you want jobs to survive a deploy or restart, or you want to run
dedicated worker processes (see below).

```bash
pip install redis
export REDIS_URL=redis://localhost:6379/0
```

`get_store()` picks Redis only when `REDIS_URL` is set **and** the `redis`
package imports **and** a ping succeeds; anything else falls back to memory with
a warning in the log. The choice is made once per process and cached, and the
selected store is reported in `GET /api/jobs/stats/summary` as `store`.

## Workers

Every API process runs a module-level `ThreadPoolExecutor(max_workers=4)` in
`app/jobs/queue.py`. Four is deliberate: local Aer simulation is CPU-bound, so
more threads just contend for cache and memory bandwidth and make every job
slower. The pool is shut down through an `atexit` hook so Ctrl-C on uvicorn does
not orphan running simulations.

There is **no Celery**. Celery would add a broker, a result backend, a separate
deployment and a large dependency tree in exchange for fan-out, routing and
retry policies this service does not use. A stdlib thread pool plus a pluggable
store gives the same submit-then-poll contract with zero required
infrastructure, and scales out via Redis when it needs to.

### Standalone worker process

Only needed once you scale beyond one API process, i.e. when you are already on
Redis. It lets the API stay a thin front end that only enqueues:

```bash
export REDIS_URL=redis://localhost:6379/0
python -m app.jobs.worker                 # poll forever
python -m app.jobs.worker --once          # one drain pass, then exit
python -m app.jobs.worker --poll-interval 2.0 --log-level DEBUG
python -m app.jobs.worker --once --allow-memory   # local smoke test only
```

`--once` performs a single drain pass over everything currently `QUEUED` and
exits, which makes it testable and useful from cron or a CI check. `SIGINT` and
`SIGTERM` set a stop flag: the worker finishes the job in hand and exits
cleanly instead of stranding it in `RUNNING`.

With the in-memory store a separate process shares no state with the API and
would find nothing to do, so the worker refuses to start unless you pass
`--allow-memory`.

## Hardware routing hook

`app/jobs/queue.py` exposes:

```python
HARDWARE_SUBMITTER: Callable[[Job], dict[str, Any]] | None = None
```

While it is `None`, every job runs locally through `runner.run_circuit`, and
submitting to a hardware backend is rejected at submit time with an actionable
`400`. A hardware module can set the hook to a callable taking the `Job` and
returning a runner-shaped result dict (or raising `ValueError` with an
actionable message); jobs whose backend is not a simulator are then routed to it
instead. This keeps the queue completely decoupled from any vendor SDK — nothing
in `app/jobs/` imports hardware code.

## Testing

```bash
.venv/bin/python -m pytest tests/test_jobs.py -q
```

The suite runs entirely offline: no Redis, no network, no vendor SDKs. Tests
poll through a `wait_for(job_id, timeout=10)` helper rather than sleeping a
fixed interval, so they are fast on a quick machine and still tolerant on a slow
one.
