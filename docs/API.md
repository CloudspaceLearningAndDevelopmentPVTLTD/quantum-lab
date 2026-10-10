# The qubit16 API

Everything `/hardware` does, from a script.

This exists because until it did, every capability on this platform was
reachable only by hand. You could submit a circuit to a real QPU by clicking,
and you could not put that submission in a loop, in a CI job, or in a paper's
reproduction instructions — which is the difference between a tool somebody
looks at and a tool somebody uses.

---

## 1. Get a key

**Account → API keys → Create key.** Choose a name you will recognise later and
the scopes it needs.

The key is shown **once**. Only its SHA-256 hash is stored, so nobody —
including us — can show it to you a second time. If you lose it, revoke it and
issue another.

```
qb16_sk_3nQ8vK2mR7pL9wX4cF6tY1hJ5bN0dS8gA2zE4uI7oP
```

Two scopes:

| Scope | What it allows |
|---|---|
| `hardware:read` | Devices, cost estimates, transpiled circuits, job status, your own job history. |
| `hardware:submit` | Enqueue jobs and open sessions. **Spends your monthly allowance and, on paid devices, real money.** |

Issue read-only keys for anything that only needs to watch. A key with
`hardware:read` cannot be made to spend, whatever else goes wrong around it.

**What a key can never do:** mint another key, touch billing, change an
organisation, or take an exam. Key management requires a signed-in session, so
a leaked key cannot grant itself a successor that survives revocation.

---

## 2. Authenticate

```
Authorization: Bearer qb16_sk_...
```

Same header the browser uses for its session token; the server tells them apart
by the `qb16_sk_` prefix.

```bash
curl -s https://qubit16.ai/api/hardware/devices \
  -H "Authorization: Bearer $QUBIT16_KEY"
```

`/api/hardware/devices`, `/estimate` and `/transpile` are public and need no
key at all. Everything else does.

---

## 3. Endpoints

| Method | Path | Scope | Notes |
|---|---|---|---|
| `GET` | `/api/hardware/devices` | — | Live where credentials allow, catalogue otherwise. |
| `POST` | `/api/hardware/estimate` | — | Indicative price. Not a quote. |
| `POST` | `/api/hardware/transpile` | — | What the device would actually run. |
| `POST` | `/api/hardware/submit` | `hardware:submit` | Sampler or estimator. |
| `GET` | `/api/hardware/job/{provider}/{id}` | `hardware:read` | Your own jobs only. |
| `GET` | `/api/hardware/jobs` | `hardware:read` | Stored history, with results. |
| `POST` | `/api/hardware/session` | `hardware:submit` | Reserves a device. **Bills while open.** |
| `DELETE` | `/api/hardware/session/{id}` | `hardware:read` | Stops the meter. |
| `GET`/`POST` | `/api/keys` | session only | Never reachable with a key. |

Status codes worth handling:

* **401** — no credential, or one that is not valid. Do not retry.
* **402** — your plan does not include hardware, or the monthly allowance is
  spent. Do not retry.
* **403** — the key authenticated but lacks the scope. The body names it. Do
  not retry.
* **429** — rate limited. `Retry-After` is set.
* **503** — a meter or a credential store could not answer. **This service
  fails closed on purpose**: an unknown answer on a spending path is a refusal,
  not permission. Retry with backoff.

---

## 4. Sample a circuit

The familiar path: run the circuit, get a histogram.

```bash
curl -s https://qubit16.ai/api/hardware/submit \
  -H "Authorization: Bearer $QUBIT16_KEY" \
  -H "content-type: application/json" \
  -d '{
        "qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc = measure q;\n",
        "backend": "ibm_brisbane",
        "shots": 4096,
        "optimization_level": 3,
        "dynamical_decoupling": true,
        "measurement_twirling": true
      }'
```

```json
{
  "job_id": "d1abc...",
  "backend": "ibm_brisbane",
  "status": "queued",
  "provider": "ibm",
  "shots": 4096,
  "primitive": "sampler",
  "transpiled_depth": 11,
  "transpiled_two_qubit_gates": 1,
  "optimization_level": 3,
  "estimated_qpu_seconds": 1.4
}
```

Then poll until `status` is `done`:

```bash
curl -s "https://qubit16.ai/api/hardware/job/ibm/d1abc..." \
  -H "Authorization: Bearer $QUBIT16_KEY"
```

**Two settings that cost nothing and change your results.**
`dynamical_decoupling` fills idle qubit time with an XY4 echo so a waiting
qubit dephases less. `measurement_twirling` randomises a Pauli frame around
each measurement, turning a *biased* readout error — a device that mistakes 1
for 0 more often than the reverse — into ordinary variance. Neither adds shots.
Both default to **off**, because a run should be reproducible by default and
the person comparing two runs should be the one who decided they differ.

**`optimization_level` is the setting that matters most.** Two-qubit gates
dominate the error on every device here, and level 3 routinely removes a third
of them. It costs compile time, not shots and not money.

---

## 5. Measure an observable

The path that makes variational algorithms possible. Send `observables` and the
device measures ⟨ψ|H|ψ⟩ instead of returning a histogram.

```bash
curl -s https://qubit16.ai/api/hardware/submit \
  -H "Authorization: Bearer $QUBIT16_KEY" \
  -H "content-type: application/json" \
  -d '{
        "qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n",
        "backend": "ibm_brisbane",
        "shots": 4096,
        "resilience_level": 1,
        "observables": [
          {"label": "ZZ", "terms": [{"pauli": "ZZ", "coefficient": 1.0}]},
          {"label": "XX", "terms": [{"pauli": "XX", "coefficient": 1.0}]},
          {"label": "energy", "terms": [["ZI", 0.5], ["IZ", 0.5]]}
        ]
      }'
```

Poll with the labels, in submission order:

```bash
curl -s "https://qubit16.ai/api/hardware/job/ibm/d1abc...?observables=ZZ,XX,energy" \
  -H "Authorization: Bearer $QUBIT16_KEY"
```

```json
{
  "status": "done",
  "primitive": "estimator",
  "expectation_values": [
    {"label": "ZZ",     "value":  0.947, "std_error": 0.006},
    {"label": "XX",     "value":  0.931, "std_error": 0.007},
    {"label": "energy", "value": -0.002, "std_error": 0.009}
  ],
  "qpu_seconds": 2.1
}
```

### Four rules, and why

**The circuit must have no measurements.** The observable is measured for you;
a terminal measurement collapses the state before that happens. A circuit with
measurements is **refused**, not silently stripped — stripping would edit your
circuit and hand back a number for something you did not submit.

**One Pauli letter per qubit.** `ZZ` on a 3-qubit circuit is an error. Pad with
`I` for the qubits a term does not act on: `ZZI`.

**Keep the labels.** IBM stores the observables but not our names for them, so
the label array from the submission response is the only thing that can turn
the result's floats back into ⟨ZZ⟩, ⟨XX⟩ and ⟨energy⟩. Poll without them and
you get `obs0`, `obs1`, `obs2`.

**`value` can be `null`, and `0.0` is not null.** An expectation value of zero
is a real and common answer — it is what ⟨Z⟩ gives for a perfect superposition.
`null` means the number could not be read. Do not conflate them.

### Mitigation

`resilience_level` is `0` (none), `1` (readout error mitigation, the default)
or `2` (readout mitigation plus zero-noise extrapolation). Level 1 is close to
free and is the default because an unmitigated expectation value on current
hardware is biased in a way that is easy to mistake for physics. Level 2 costs
substantially more QPU time — it runs your circuit at several noise
amplifications — and is worth it when you are extracting a number you intend
to publish.

---

## 6. Sessions: make a variational loop practical

Without a session, every iteration of an optimisation re-enters the shared
queue from the back. A 200-iteration VQE takes days. With one, IBM reserves the
device and runs your jobs consecutively.

```python
import os, time, requests

BASE = "https://qubit16.ai"
H = {"Authorization": f"Bearer {os.environ['QUBIT16_KEY']}",
     "content-type": "application/json"}

session = requests.post(
    f"{BASE}/api/hardware/session",
    headers=H,
    json={"backend": "ibm_brisbane", "max_time_seconds": 3600},
).json()

try:
    for theta in angles:
        job = requests.post(
            f"{BASE}/api/hardware/submit",
            headers=H,
            json={
                "qasm": ansatz(theta),
                "backend": "ibm_brisbane",
                "shots": 4096,
                "session_id": session["session_id"],
                "observables": [{"label": "H", "terms": hamiltonian}],
            },
        ).json()
        # poll job["job_id"] until done, feed the value back to the optimiser
finally:
    # ALWAYS. A session bills for its whole window whether or not jobs run.
    requests.delete(
        f"{BASE}/api/hardware/session/{session['session_id']}", headers=H
    )
```

**A session bills for as long as it is open**, running or idle. Close it in a
`finally`. `max_time_seconds` (60 to 28,800) is the backstop for when your
process dies before the `finally` runs — it is not a substitute for closing.

Closing does **not** cancel jobs already submitted into the session; they
drain. Closing to stop the meter will not lose your last iteration.

---

## 7. Read your results back

Every submission is recorded with its circuit, its counts or expectation
values, its compilation settings and its metered QPU time.

```bash
curl -s "https://qubit16.ai/api/hardware/jobs?limit=50&include_qasm=1" \
  -H "Authorization: Bearer $QUBIT16_KEY"
```

`include_qasm=1` returns the circuit source with each row, which is what makes
the export reproducible — without it you have histograms with no provenance.
It is off by default because it is the largest field.

**One honest limitation.** A job's status is only written when something polls
it. Submit a job, never poll it, and its row says `"status": null` however long
ago it finished — that is "nobody has checked", not "still queued", and the
field is null rather than a guess. Poll your jobs to completion, or poll them
later; the vendor keeps the job either way.

---

## 8. Limits

| | |
|---|---|
| Submissions | 5/min per IP **and** 5/min per account |
| Sessions opened | 3/min per account |
| Reads | 60/min |
| Key operations | 20/min |
| Shots | 20,000 per job |
| Observables | 32 per job, 512 Pauli terms each |
| Circuit source | 131,072 characters |
| Monthly hardware jobs | Free 0 · Pro 50 · Team 500 · Edu 5,000 |

The monthly allowance runs on your **subscription** anniversary, not the
calendar month.

---

## 9. Rotate and revoke

Revoke from **Account → API keys**. The key stops working immediately.

Revocation is a timestamp, not a deletion: the row survives so an incident can
still answer "was this key active when that job was submitted?". Revoked keys
stay in your listing, marked, because a key that simply vanished would look
the same as one you never created.

To rotate: issue the new key, deploy it, then revoke the old one. Both work in
between, so there is no gap.

If a key leaks, revoke it first and ask questions afterwards. Issuing another
takes ten seconds.
