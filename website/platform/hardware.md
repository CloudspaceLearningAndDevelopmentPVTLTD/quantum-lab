# Real quantum hardware

`services/api` runs circuits on Qiskit Aer and PennyLane Lightning, and submits them to real quantum computers on three clouds. It is the one component that can spend money, so its design is dominated by bounds, honest availability reporting and credential isolation.

## Backends

Ten backend identifiers, each carrying `available` and, when not, a `requires` string a human can act on:

| Backend | Vendor | Kind | Max qubits | Available when |
| --- | --- | --- | --- | --- |
| `aer_simulator` | Qiskit | simulator | 24 | always |
| `aer_noisy` | Qiskit | noisy simulator | 12 | always |
| `cirq_simulator` | Google | simulator | 20 | `cirq` installed |
| `braket_local` | Amazon | simulator | 20 | Braket SDK installed |
| `ibm_quantum`, `ibm_brisbane` | IBM | hardware | 127 | runtime SDK + `IBM_QUANTUM_TOKEN` |
| `ionq_aria` | IonQ via Braket | hardware | 25 | SDK + AWS credentials |
| `rigetti_ankaa` | Rigetti via Braket | hardware | 84 | SDK + AWS credentials |
| `azure_quantinuum_h1` | Quantinuum via Azure | hardware | 20 | SDK + workspace configured |
| `azure_ionq_aria` | IonQ via Azure | hardware | 25 | SDK + workspace configured |

Availability is recomputed on every call from SDK presence (`importlib.util.find_spec`, no import) and credential presence, with **no vendor network calls**; the health endpoint says so with `checked: false`. Vendor SDKs are imported lazily inside the functions that need them, and a missing one raises `MissingDependency` with a remedy that the router maps to 503. Live device lists from IBM, Braket and Azure are merged with a static catalogue, which stands in, marked unavailable with a reason, when a provider cannot be reached.

## Bounds, measured

`app/quantum/limits.py` sets the ideal simulator ceiling at 24 qubits (20,000 shots) and caps both the noisy simulator and exact statevector readout at **12 qubits**. The noisy cap is not arbitrary: a noisy shot is an independent trajectory, so cost scales as shots × 2ⁿ. The module records the measurements behind the numbers on an eight-core machine at 1,024 shots:

| Engine | 20 qubits | 22 | 24 | 26 |
| --- | --- | --- | --- | --- |
| Aer ideal | 0.58 s | 1.14 s | 4.49 s | 18.9 s |
| Lightning ideal | 0.25 s | 1.74 s | 7.43 s | 33.7 s |

Aer noisy takes 0.83 s at 12 qubits and 13.7 s at 16. PennyLane's `default.mixed` holds a full density matrix (16 × 4ⁿ bytes, 4 GB at 14 qubits) and measured about 100× slower than Aer, so noisy circuits always go to Aer. The limits exist because of an audit finding in which `qreg q[3000000]` allocated 669 MB before any cap ran; the comment says to re-measure before changing them.

## Parsing

`parse_qasm` tries Qiskit's `qasm3.loads` (which delegates to `qiskit-qasm3-import`), then the native experimental loader, then the OpenQASM 2 reader. `qiskit-qasm3-import` is a required dependency, guarded by a test, because the web app exports exact π fractions such as `ry(pi/3)` and Qiskit's native reader folds no arithmetic. The runner catches `BaseException` because the native importer surfaces Rust panics as `PanicException`. Circuits without classical bits get `measure_all` so counts can be returned.

## Submitting a job

Submission supports sampler and estimator modes (IBM's `SamplerV2` and `EstimatorV2`), named observables as weighted sums of Pauli terms (up to 32 observables of 512 terms, with the layout applied so Paulis map onto the transpiled physical qubits), resilience levels, and parameter sweeps that run N points in one job. IBM runtime sessions can be opened for up to eight hours and are billed for their window, so the minimum is 60 s and ownership is recorded. Submission is fire-and-forget: the route returns a job handle and the client polls `GET /api/hardware/job/{provider}/{id}`.

Cost estimates use hand-transcribed per-shot and per-task prices for IonQ and Rigetti, zero for IBM's included allocation, and an explicit "cannot price" for Quantinuum, which bills in credits. A test asserts that every hardware backend has a price entry, because an earlier version defaulted unknown ids to a free simulator. Device recommendation ranks by projected cost per successful shot or by success probability using calibration data, and every projection carries a disclaimer.

## Credentials

Operator credentials come from the environment. **Bring-your-own-key** credentials arrive per request in a base64 header (transport safety only, the docstring says, not secrecy), parsed into immutable dataclasses with redacting `__repr__`s. The invariant is that a presented credential is never written to settings or the process environment, because concurrent requests would leak one user's account to another; each provider call constructs its own session or client. At rest, the web app seals the secret fields with AES-256-GCM ([Data & accounts](../architecture/data.md)) and a credential-store failure refuses the submission rather than falling back to the operator's account.

## The job queue

Local simulations run on a four-worker thread pool with a 900 s lease (a job older than that is presumed dead; the widest sanctioned job takes about 20 s), idempotency scopes, and a store that is an in-memory bounded dictionary by default, Redis when `REDIS_URL` is set (24 h TTL, claim via `SET NX`), and Postgres history when `DATABASE_URL` is set. A standalone worker can drain the queue.

## The Python client

`packages/qubit16-python` is a Qiskit-style provider, sampler and estimator over the public API, with sessions and job objects, documented in `docs/API.md`. It is how a notebook user submits to hardware through their own scoped API key without touching the web interface.

## What the browser is never allowed to do

The browser never calls this service. Every request passes through a web route handler that has rate-limited, authenticated, checked the plan and reserved quota, and forwards with a shared secret the browser never sees. The proxy republishes only the endpoints the product needs; `/api/circuits/run` and `/api/jobs` are deliberately not exposed. See [Trust boundaries](../architecture/trust-boundaries.md).
