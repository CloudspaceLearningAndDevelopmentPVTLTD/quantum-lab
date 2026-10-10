# qubit16 for Qiskit

Run the Qiskit code you already have on IBM Quantum, IonQ and Rigetti, through
one credential, with every run recorded and every cost estimated before you
spend it.

The adoption cost is meant to be the two lines where you build the service.

```diff
- from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
- service = QiskitRuntimeService()
+ from qubit16 import Qubit16Provider, SamplerV2
+ service = Qubit16Provider(token="qb16_sk_…")

  backend = service.backend("ibm_brisbane")
  sampler = SamplerV2(mode=backend)
  job = sampler.run([circuit], shots=4096)
  counts = job.result()[0].data.meas.get_counts()
```

Everything below those two lines is Qiskit's own API, and the objects that come
back are Qiskit's own classes — a real `BitArray` you can call `get_counts()`
on, real `evs` / `stds` arrays from the Estimator.

---

## Install

```bash
pip install qubit16
```

Python 3.10+. Depends on `qiskit` and `requests`, and nothing else.

## A token

Create one at **Account → API keys**. It is shown once; only its SHA-256 hash
is stored, so nobody — including us — can show it to you again.

```bash
export QUBIT16_TOKEN=qb16_sk_…
```

Resolution order is the `token=` argument, then `QUBIT16_TOKEN`, then
`QUBIT16_API_KEY`, then `QUBIT16_KEY`. The argument wins, so a stale variable in
a shell cannot silently redirect your script to another account.

Two scopes. `hardware:read` sees devices, jobs and results. `hardware:submit`
enqueues jobs and opens sessions, which **spends your monthly allowance and, on
paid devices, real money**. Issue read-only keys for anything that only watches.

`Qubit16Provider(allow_anonymous=True)` works with no token at all, for the
public device catalogue and cost estimates.

---

## Sample a circuit

```python
from qiskit import QuantumCircuit
from qubit16 import Qubit16Provider, SamplerV2

service = Qubit16Provider()                      # QUBIT16_TOKEN
backend = service.backend("ibm_brisbane")        # or ionq_aria, rigetti_ankaa

circuit = QuantumCircuit(2)
circuit.h(0)
circuit.cx(0, 1)
circuit.measure_all()

sampler = SamplerV2(mode=backend, options={"optimization_level": 3})
job = sampler.run([circuit], shots=4096)
print(job.result()[0].data.meas.get_counts())
```

`meas` is the name of your circuit's classical register — `measure_all()` calls
it that — and the result field is named after it.

### The three settings worth knowing

| Option | Costs | Why |
|---|---|---|
| `optimization_level` (0–3) | compile time | Two-qubit gates dominate the error on every device here, and level 3 routinely removes a third of them. This is the setting that matters most. |
| `dynamical_decoupling` | nothing | Fills idle qubit time with an XY4 echo so a waiting qubit dephases less. Changes the pulse schedule, not the shot count. IBM only. |
| `measurement_twirling` | nothing | Randomises the Pauli frame around each measurement, turning a *biased* readout error into ordinary variance. Splits the shot budget rather than adding to it. IBM only. |

The last two default to **off**, matching the API, so a run is reproducible by
default: the person comparing two runs should be the one who decided they
differ.

---

## Measure an observable

```python
from qiskit.quantum_info import SparsePauliOp
from qubit16 import EstimatorV2

state = QuantumCircuit(2)     # NO measurements — see below
state.h(0)
state.cx(0, 1)

estimator = EstimatorV2(mode=backend, options={"resilience_level": 1})
job = estimator.run([(state, {"ZZ": SparsePauliOp("ZZ"), "XX": SparsePauliOp("XX")})])

print(job.result()[0].data.evs)        # array([0.947, 0.931])
print(job.expectation_values())        # [{'label': 'ZZ', 'value': 0.947, …}, …]
```

Four rules, all enforced before the request leaves your machine:

* **The circuit must have no measurements.** The observable is measured for
  you; a terminal measurement collapses the state first. Neither this package
  nor the service strips them — stripping would edit your circuit and hand back
  a number for something you did not submit.
* **One Pauli letter per qubit.** `"ZZ"` on a three-qubit circuit is an error;
  pad with `I` (`"ZZI"`). Ordering is Qiskit's: the rightmost letter acts on
  qubit 0.
* **Coefficients must be real.** An observable has to be Hermitian for its
  expectation value to be a real measurable quantity, so a complex coefficient
  is refused rather than truncated.
* **`value` can be `None`, and `0.0` is not `None`.** Zero is a real and common
  expectation value — it is what ⟨Z⟩ gives for a perfect superposition. A value
  that could not be read comes back as `None` from `job.expectation_values()`
  and as `NaN` in the `evs` array, never as zero.

`resilience_level` is `0` (none), `1` (readout mitigation, the default) or `2`
(readout mitigation plus zero-noise extrapolation). Level 2 costs substantially
more QPU time — it runs your circuit at several noise amplifications — and is
worth it for a number you intend to publish.

---

## Sessions, for variational loops

Without a session, every iteration re-enters the shared queue from the back and
a 200-iteration VQE takes days. With one, IBM reserves the device and runs your
jobs consecutively.

```python
from qubit16 import Session, EstimatorV2

with Session(backend=backend, max_time=3600) as session:
    estimator = EstimatorV2(mode=session)
    for theta in angles:
        job = estimator.run([(ansatz(theta), hamiltonian)], shots=4096)
        energy = job.result()[0].data.evs[0]
        optimiser.tell(theta, energy)
```

**A session bills for its whole open window, running jobs or idle.** `__exit__`
closes unconditionally — on success, on exception, on `KeyboardInterrupt` —
which is the reason to use the context manager rather than `open()` and
`close()`. Nothing is opened until the `with` is entered, so a `Session` built
in a function that raises two lines later costs nothing.

`max_time` (60 to 28,800 seconds) is the backstop for a process that dies
before `__exit__` can run. It is not a substitute for closing.

Closing does **not** cancel jobs already inside the session; they drain.
Closing to stop the meter will not lose your last iteration.

---

## Errors, and what to do about each

```python
from qubit16 import (
    AuthenticationError, PlanLimitError, ScopeError,
    RateLimitError, ServiceUnavailableError,
)
```

| Raised | Status | What it means | Retry? |
|---|---|---|---|
| `AuthenticationError` | 401 | No credential, or one the server rejects. | No |
| `PlanLimitError` | 402 | Plan has no hardware, or the monthly allowance is spent. | No — this is billing, not credentials |
| `ScopeError` | 403 | Key authenticated, lacks a scope. `.scope` names it. | No — issue a key with that scope |
| `RateLimitError` | 429 | Too many calls. `.retry_after` is set. | Yes |
| `ServiceUnavailableError` | 503 | **Not an auth failure.** The platform fails closed: when the usage meter or credential store cannot answer, a request that would spend money is refused rather than allowed. Your key is fine. | Yes, with backoff |
| `JobFailedError` | — | The job reached `error` or `cancelled` at the vendor. | No |
| `JobTimeoutError` | — | `result()` gave up waiting. **The job is unaffected** — it is still queued, already counted against your allowance, and will finish. `.job_ids` holds the handles. | Poll later |

Every exception carries `.status`, the server's own `.detail`, and a
`.retryable` flag, so you can branch on the flag instead of on prose.

Reads (`GET`, `DELETE`) retry 429 and 503 automatically. **Submissions never
do**, and that is deliberate: a 503 from the fail-closed branch does mean
nothing was submitted, but a 503 from a gateway does not — the job may already
be at the vendor — and a retry would bill twice for one circuit and return one
job id. You decide, not the client.

---

## What is faithful, and what is not

Being honest about this is the point of the package, so it is a list and not a
footnote.

**Faithful.** Pub shapes, `mode=` taking a backend or a session, `shots` per
run and per pub, `Options`, and the result containers — `BitArray`, `DataBin`,
`PrimitiveResult`, `evs` and `stds` are Qiskit's own classes, not lookalikes.

**One pub is one job.** The wire carries a single circuit per submission, so
`sampler.run([a, b, c])` is three submissions, three queue positions and
**three units of your monthly allowance**. Qiskit's local primitives batch pubs
for free; this cannot.

**This backend is not a local transpilation target.** The API serves a device's
name, width, vendor, availability, queue depth and median-error calibration —
and no coupling map and no basis gates. So `backend.target` carries the right
`num_qubits` and **no instructions**, and `transpile(qc, backend)` will not
produce a device-native circuit. It does not need to: your circuit is
transpiled server-side at the `optimization_level` you asked for, and the
submission tells you the resulting depth and two-qubit-gate count. Use the
public `POST /api/hardware/transpile` to see the compiled circuit before you
spend anything. Shipping a static table of coupling maps was rejected — IBM
recalibrates and retires devices continuously, and a stale coupling map is
indistinguishable from a fresh one at the call site.

**Parameter sweeps are refused, not expanded.** A single parameter set is bound
client-side and works normally. A pub carrying an *array* of parameter sets
raises, because expanding it would submit one job per point and spend one unit
of allowance per point from a call that looks like one job. Loop yourself, so
the cost is visible.

**`precision` is ignored** by the Estimator, with a warning. The API takes a
shot count; converting a precision into one would be inventing statistics.

**One classical register per sampler circuit.** The wire returns one flat
histogram, built from the first register on the vendor's result, so a second
register would be silently dropped. This refuses instead. `measure_all()` gives
you one register.

**Shot order is lost.** The histogram is aggregated on the wire, so the
`BitArray` is rebuilt with `BitArray.from_counts` and the order of individual
shots inside it is arbitrary. Counts are unaffected; per-shot time ordering is
not recoverable from what the API serves.

**Bit order on Braket devices is unverified.** Bitstrings are passed through
exactly as the API serves them. For IBM that is already a Qiskit result, so the
familiar convention holds — the rightmost character is classical bit 0. For a
Braket device (`ionq_*`, `rigetti_*`) the keys come from Braket's own
`measurement_counts`, in Braket's qubit order, and this package does **not**
reverse them: reversing on a convention nobody here has checked against a live
device would silently relabel every outcome. Until that round trip has been
run, verify the order yourself with a circuit whose answer you know — an `X` on
qubit 0 alone, measured, is the one-line check. Counts are exact either way;
which qubit each character belongs to is the open question.

**Expectation values are matched to your labels, not taken positionally.**
`data.evs[i]` is the i-th observable *you asked for*: the labels submitted with
the job are used to reorder the response if it ever comes back in another
order, and a response carrying a different number of values than observables is
refused rather than returned short. Labels are capped at 64 characters and a
longer one is refused — the service truncates at 64 and the proxy drops a
longer label from the poll entirely, either of which would re-pair values with
the wrong observables.

**No job cancellation.** The API exposes no cancel endpoint; cancel from the
vendor's console.

---

## Limits

| | |
|---|---|
| Shots | 20,000 per job |
| Observables | 32 per job, 512 Pauli terms each |
| Circuit source | 131,072 characters |
| Submissions | 5/min per account |
| Sessions opened | 3/min per account |
| Reads | 60/min |
| Monthly hardware jobs | Free 0 · Pro 50 · Team 500 · Edu 5,000 |

The monthly allowance runs on your **subscription** anniversary, not the
calendar month.

---

## Other things on the provider

```python
service.backends(min_num_qubits=20, provider="ionq", available_only=True)
service.least_busy(min_num_qubits=5)       # refuses if no queue depth is reported
service.estimate_cost(qasm, "ionq_aria", shots=1000)   # indicative, not a quote
service.jobs(limit=50, include_qasm=True)  # your recorded history
service.job_status("ibm", job_id, observable_labels=["ZZ", "XX"])
```

`service.jobs()` has one honest limitation worth repeating from the API docs: a
row's `status` is only written when something polls the job. A job submitted
and never polled reads `null`, which means "nobody has checked" — not "still
queued".

---

## Tests

```bash
pip install -e ".[test]"
pytest
```

Every test mocks HTTP; nothing in the suite touches the network or a QPU.

---

## Pointing at another deployment

```python
Qubit16Provider(token=…, base_url="https://staging.example")
# or export QUBIT16_BASE_URL
```

Use `https`. A plain-`http` base URL sends your key in clear text, so the client
warns about it — except for `localhost`, where it is the normal thing to do. If
a key has already travelled that way, revoke it.
