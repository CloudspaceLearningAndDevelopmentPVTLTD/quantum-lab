# Quantum Lab API

FastAPI + Qiskit + PennyLane service that executes OpenQASM 3 circuits on simulators (and, when
configured, on real IBM, IonQ, Rigetti and Quantinuum hardware via IBM Quantum, AWS Braket and
Azure Quantum). It returns measurement counts, probabilities and exact statevectors, transpiles
and estimates cost for a target device, submits and polls asynchronous hardware jobs, and ships a
library of example circuits.

**The web app never calls this service directly.** The browser talks to
`apps/web/app/api/hardware/*`, which authenticates the caller, checks the entitlement, reserves
quota and only then forwards — see `docs/ARCHITECTURE.md` § 3.

## Requirements

- Python 3.11
- No network access needed for the default simulator backends

## Setup

```bash
cd services/api
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

The vendor hardware SDKs (IBM runtime, Braket, Azure Quantum) live in
`requirements-hardware.txt` and are installed by default; the Dockerfile's
`INCLUDE_HARDWARE_SDKS=0` build argument omits them for a simulator-only image.
They are imported lazily, so the service starts and runs fine without them — the
backends that need them simply report `available: false` with the reason.

## Configuration

Settings are read from the environment or a `.env` file next to the working directory.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | unset | Reserved for the agent service |
| `IBM_QUANTUM_TOKEN` | unset | Enables the `ibm_quantum` hardware backend |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins. **`*` is refused** — the service will not start (see below) |
| `API_SHARED_SECRET` | unset | Optional. When set, every request must carry `X-Quantum-Lab-Secret` |
| `DEFAULT_BACKEND` | `aer_simulator` | Backend used when a request omits one |
| `MAX_SHOTS` | `20000` | Upper bound on shots per run |
| `MAX_QUBITS` | `24` | Advisory ceiling on circuit width |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` | unset | Braket. A key id with no secret **refuses to start** |
| `BRAKET_S3_BUCKET` / `BRAKET_S3_PREFIX` | unset | Result destination for non-local Braket. Without them those submissions cannot run |
| `AZURE_QUANTUM_RESOURCE_ID` / `AZURE_QUANTUM_LOCATION` | unset | Azure Quantum targets; unset means those backends report unavailable |
| `REDIS_URL` | unset | Shared job store. Unset means a bounded in-process dict — jobs lost on restart, invisible to other replicas |
| `QUANTUM_LAB_SKIP_ENV_CHECK` | unset | Downgrades every startup **error** to a warning. For an incident where the validator is what is keeping you from booting, not a setting |

`app/core/env_check.py` holds the same rules and is also a CLI:
`python -m app.core.env_check` prints its findings and exits non-zero on an error. It runs at
import of `app.main`, and CI runs it against an empty environment so "starts with no configuration"
is tested rather than asserted.

### This service is unauthenticated by design

`POST /api/circuits/run` executes user-supplied circuits and
`POST /api/hardware/submit` spends real IBM/Braket credits, and neither asks for
a credential. That is acceptable **only** on a private network. Nothing in this
repository, the Dockerfile or `docker-compose.yml` enforces that.

Two supported ways to expose it safely, in full, are in
**`docs/SECURITY.md` § "Exposing services/api safely"**. The short version:

- **Preferred:** keep the port private and let only the Next server reach it.
- **If you cannot:** set `API_SHARED_SECRET` on this service *and* route the
  browser's calls through the Next server so the secret never enters a browser
  bundle. Setting the secret without doing that will break the hardware page.

`ALLOWED_ORIGINS=*` is refused outright at startup, because this service sends
CORS responses with `allow_credentials=true` and the combination is
credentialed any-origin access.

Example `.env`:

```
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
IBM_QUANTUM_TOKEN=your-token-here
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

Interactive docs are at <http://localhost:8000/docs>.

## Backends

Ten, not five — this table was written when there were five.

| id | Vendor | Kind | Max qubits | Needs |
| --- | --- | --- | --- | --- |
| `aer_simulator` | Qiskit | simulator | 24 | nothing — always available |
| `aer_noisy` | Qiskit | simulator | **12** | nothing — depolarising + thermal relaxation + readout error |
| `cirq_simulator` | Google | simulator | 20 | `pip install cirq` |
| `braket_local` | Amazon | simulator | 20 | `pip install amazon-braket-sdk` |
| `ibm_quantum` | IBM | hardware | 127 | `pip install qiskit-ibm-runtime` **and** `IBM_QUANTUM_TOKEN` |
| `ibm_brisbane` | IBM | hardware | 127 | as above — Eagle r3, open-plan queue in minutes to hours |
| `ionq_aria` | IonQ | hardware | 25 | Braket SDK + AWS credentials — trapped ion, all-to-all |
| `rigetti_ankaa` | Rigetti | hardware | 84 | Braket SDK + AWS credentials — superconducting, square lattice |
| `azure_quantinuum_h1` | Quantinuum | hardware | 20 | Azure Quantum workspace — trapped ion, mid-circuit measurement |
| `azure_ionq_aria` | IonQ | hardware | 25 | Azure Quantum workspace |

**`aer_noisy` is capped at 12 qubits and that is not a typo.** A noisy simulation samples a fresh
trajectory per shot, so it costs `shots × 2ⁿ` rather than `2ⁿ`: measured here at 0.83 s for 12
qubits and 13.7 s for 16, both at 1024 shots. Advertising 24 told the device picker that a
20-qubit noisy run was fine; it is minutes of CPU. `MAX_NOISY_QUBITS` in `app/quantum/limits.py`
enforces the same number server-side.

`aer_noisy` applies a depolarising error to one-qubit gates at the requested `noise`
strength (default `0.02`) and to two-qubit gates at `min(noise * 2, 0.75)`. Passing
`noise > 0` to `aer_simulator` enables the same model there.

Every hardware backend is asynchronous: `POST /api/hardware/submit` returns a job handle and you
poll `GET /api/hardware/job/{provider}/{job_id}`. Vendor SDKs are imported lazily, so an
uninstalled one degrades to `available: false` with the pip command in `requires` rather than
crashing at startup.

`cirq_simulator` and `braket_local` convert the circuit through the vendor's QASM
importer; if that conversion is not possible for a given circuit, the run transparently
falls back to Aer and says so in the response's `notes` field.

`ibm_quantum` rejects synchronous `/run` calls: real-hardware jobs are queued and
asynchronous, so the error directs you to `submit_hardware_job`.

## PennyLane is the middleware layer

`app/quantum/pennylane_runner.py` is the single integration point the architecture calls for:
instead of a hand-written adapter per SDK, it translates the already-parsed OpenQASM into PennyLane
gate calls, executes on whichever PennyLane device a backend id maps to, and normalises the answer
into the exact result dict `app.quantum.runner.run_circuit` has always returned.

Two properties are load-bearing. **Every import is lazy**, so a missing device plugin degrades into
a message naming the pip package rather than an import crash at startup. And **translation fails
loudly**: an unsupported gate raises `ValueError` during translation, before anything executes, so
the caller can fall back to the Qiskit path rather than silently returning a wrong distribution.

See `docs/PENNYLANE.md` in this directory.

## Endpoints

Four routers, all mounted in `app/main.py`:

| Prefix | Router | What it is |
| --- | --- | --- |
| — | `health` | `GET /api/health` — runs a real one-qubit circuit end to end |
| `/api/circuits` | `circuits` | `run`, `statevector` (≤ 12 qubits), `resources` (fault-tolerant estimate), `backends`, `presets`, `presets/{id}` |
| `/api/hardware` | `hardware` | `devices`, `analyse`, `estimate`, `recommend`, `transpile`, `submit` (sampler/estimator, observables, sweeps), `job/{provider}/{job_id}`, `session` (POST open / DELETE close an IBM runtime session) |
| `/api/jobs` | `jobs` | `POST` → `202 {job_id}`, `GET` list, `GET /{id}`, `DELETE /{id}`, `GET /stats/summary` |

`docs/HARDWARE.md` and `docs/JOBS.md` in this directory cover the last two in detail.

### Health

```bash
curl http://localhost:8000/api/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "backends_available": ["aer_simulator", "aer_noisy"],
  "qiskit_version": "2.5.2"
}
```

### List backends

```bash
curl http://localhost:8000/api/circuits/backends
```

### List presets

```bash
curl http://localhost:8000/api/circuits/presets
curl http://localhost:8000/api/circuits/presets/bell
```

Available preset ids: `bell`, `ghz`, `superposition`, `grover2`, `interference`,
`teleport`.

### Run a circuit

```bash
curl -X POST http://localhost:8000/api/circuits/run \
  -H 'Content-Type: application/json' \
  -d '{
    "qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc = measure q;\n",
    "backend": "aer_simulator",
    "shots": 1024,
    "noise": 0.0
  }'
```

```json
{
  "counts": { "00": 508, "11": 516 },
  "probabilities": [0.496, 0.504],
  "labels": ["00", "11"],
  "shots": 1024,
  "backend": "aer_simulator",
  "duration_ms": 12.41,
  "num_qubits": 2,
  "depth": 3,
  "notes": null
}
```

A noisy three-qubit GHZ run:

```bash
curl -X POST http://localhost:8000/api/circuits/run \
  -H 'Content-Type: application/json' \
  -d '{
    "qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[3] q;\nbit[3] c;\nh q[0];\ncx q[0], q[1];\ncx q[1], q[2];\nc = measure q;\n",
    "backend": "aer_noisy",
    "shots": 4096,
    "noise": 0.05
  }'
```

### Statevector

Measurements, barriers and resets are stripped before the state is computed. Limited to
12 qubits.

```bash
curl -X POST http://localhost:8000/api/circuits/statevector \
  -H 'Content-Type: application/json' \
  -d '{
    "qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc = measure q;\n"
  }'
```

```json
{
  "amplitudes": [
    { "re": 0.7071067812, "im": 0.0 },
    { "re": 0.0, "im": 0.0 },
    { "re": 0.0, "im": 0.0 },
    { "re": 0.7071067812, "im": 0.0 }
  ],
  "probabilities": [0.5, 0.0, 0.0, 0.5],
  "labels": ["00", "01", "10", "11"],
  "num_qubits": 2
}
```

## Errors

Bad input returns `400` with a human-readable `detail` — unknown or unavailable
backends, unparseable QASM, out-of-range noise, or a circuit too wide for the target.
Schema violations caught by Pydantic (for example `shots` above 20000) return `422`.

```json
{ "detail": "Unknown backend 'nope'. Valid backends are: aer_noisy, aer_simulator, braket_local, cirq_simulator, ibm_quantum." }
```

## A note on OpenQASM

Circuits are parsed with `qiskit.qasm3.loads` when the optional `qiskit-qasm3-import`
package is present, then with Qiskit's built-in native OpenQASM 3 importer, and finally
with the OpenQASM 2 reader — so both dialects are accepted out of the box. The native
importer only understands **numeric literals** in gate parameters, so write
`p(1.0471975512) q[0];` rather than `p(pi/3) q[0];` unless you install
`qiskit-qasm3-import`.

Circuits with no classical bits are measured automatically (`measure_all`), and the
register separators Qiskit puts in count keys are stripped so labels are plain
bitstrings such as `"0110"`.

## Tests

```bash
.venv/bin/python -m pytest -q     # 447 passed, measured 2026-10-09
```

Note the interpreter. A bare `pytest` or `python -m pytest` uses whatever is on `PATH`, which does
not have qiskit — `pip install -r requirements.txt` populated `.venv`, not your system Python.
On Windows it is `.\.venv\Scripts\python.exe -m pytest`.

The suite needs no network access and no optional SDKs — everything runs on Aer. One of its tests,
`test_js_crosscheck.py`, reads a fixture written by the browser simulator's own vitest suite and
asserts Qiskit and PennyLane agree with it; that fixture is what keeps the two execution paths
from drifting.

## Docker

```bash
docker build -t quantum-lab-api .
docker run -p 8000:8000 --env-file .env quantum-lab-api
```
