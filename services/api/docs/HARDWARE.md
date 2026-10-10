# Running on real quantum hardware

Quantum Lab runs on simulators out of the box. Real hardware is optional: install
one vendor SDK, set one credential, and the matching devices light up. Nothing in
this document is required to use the simulators.

Real devices are shared, queued machines. Submission is therefore **asynchronous
everywhere**: you POST a circuit, get a job id back immediately, and poll for the
result. There is deliberately no synchronous "run on hardware" endpoint — a
request that waited for a QPU queue would time out long before the job ran.

---

## 1. Pick a provider

| Provider | Devices exposed | pip extra | Credential |
| --- | --- | --- | --- |
| IBM Quantum | `ibm_brisbane`, `ibm_kyiv`, `ibm_sherbrooke` (127q Eagle r3) | `pip install qiskit-ibm-runtime` | `IBM_QUANTUM_TOKEN` |
| IonQ (via Amazon Braket) | `ionq_aria` (25q), `ionq_forte` (36q) | `pip install amazon-braket-sdk` | AWS credentials + `BRAKET_S3_BUCKET` |
| Rigetti (via Amazon Braket) | `rigetti_ankaa` (84q) | `pip install amazon-braket-sdk` | AWS credentials + `BRAKET_S3_BUCKET` |

Install everything at once if you want all three:

```bash
pip install qiskit-ibm-runtime amazon-braket-sdk
```

Every one of these imports is lazy. With none of them installed the API still
starts, and `GET /api/hardware/devices` returns the static device catalogue with
`available: false` and a `reason` naming exactly what is missing.

---

## 2. IBM Quantum: getting a token

1. Create a free account at <https://quantum.ibm.com>.
2. Copy the **API token** from the dashboard (top right, "API token").
3. Put it in the environment or in `services/api/.env`:

```bash
IBM_QUANTUM_TOKEN=your_token_here
```

4. Restart the API. `GET /api/circuits/backends` should now show `ibm_brisbane`
   with `"available": true`.

The open plan is free and gives you a monthly allowance of QPU time. It does not
bill in dollars — it meters QPU-seconds — which is why the cost model below
reports IBM as `is_free: true`.

---

## 3. Amazon Braket: AWS credentials

Braket is an AWS service, so it uses ordinary AWS credentials and an S3 bucket
that receives every task's results.

```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1        # us-west-1 for Rigetti Ankaa-3
BRAKET_S3_BUCKET=amazon-braket-my-bucket
BRAKET_S3_PREFIX=quantum-lab        # optional, this is the default
```

Requirements on the AWS side:

- The IAM principal needs the `AmazonBraketFullAccess` managed policy (or an
  equivalent least-privilege policy) plus `s3:PutObject`/`s3:GetObject` on the
  bucket.
- The bucket must exist and be in the same region as the device you target.
- Braket QPUs are region-bound: IonQ Aria-1/Forte-1 live in `us-east-1`,
  Rigetti Ankaa-3 in `us-west-1`.

`AWS_PROFILE` or an assumed role (`AWS_ROLE_ARN`) work too — the service only
checks that *some* credential source is configured before it calls the SDK.

---

## 4. The submit / poll flow

### Look at what is available

```bash
curl -s localhost:8000/api/hardware/devices | jq '.[] | {id, provider, qubits, available, source}'
```

`source` is `"live"` when the list came from the provider's API and
`"catalogue"` when it came from the shipped specification sheet because the SDK
or credential was missing.

### Inspect and price the circuit before spending anything

```bash
QASM='OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[2] c; h q[0]; cx q[0], q[1]; c = measure q;'

curl -s localhost:8000/api/hardware/analyse \
  -H 'content-type: application/json' \
  -d "{\"qasm\": \"$QASM\"}"
# {"num_qubits":2,"depth":3,"size":4,"gate_counts":{...},"two_qubit_gates":1,...}

curl -s localhost:8000/api/hardware/estimate \
  -H 'content-type: application/json' \
  -d "{\"qasm\": \"$QASM\", \"backend\": \"ionq_aria\", \"shots\": 1000}"
# {"estimated_total":0.33,"per_shot":0.00003,"task_fee":0.3,"is_free":false,...}
```

### See what the hardware will actually execute

```bash
curl -s localhost:8000/api/hardware/transpile \
  -H 'content-type: application/json' \
  -d "{\"qasm\": \"$QASM\", \"backend\": \"ibm_brisbane\", \"optimization_level\": 2}"
# depth_before/depth_after plus gate_counts_before/after, and the rewritten QASM
```

IBM's native basis is `sx / rz / cx / x`, so an `h` becomes `rz · sx · rz`.
IonQ's true native gates (`gpi`, `gpi2`, `ms`) cannot be targeted through
Qiskit's `basis_gates` argument, so the service transpiles to `u / cx` and says
so in `notes`; IonQ performs the final native translation server-side.

### Submit

```bash
curl -s -X POST localhost:8000/api/hardware/submit \
  -H 'content-type: application/json' \
  -d "{\"qasm\": \"$QASM\", \"backend\": \"ibm_brisbane\", \"shots\": 1024, \"provider\": \"ibm\"}"
```

```json
{
  "job_id": "cx2h8k9m1n0p",
  "backend": "ibm_brisbane",
  "status": "queued",
  "submitted_at": "2026-08-16T09:30:00+00:00",
  "provider": "ibm",
  "shots": 1024,
  "queue_position": 14
}
```

`queue_position` is `null` when the provider does not report one. `provider` may
be omitted — it is inferred from the backend id.

### Poll

```bash
curl -s localhost:8000/api/hardware/job/ibm/cx2h8k9m1n0p
# {"job_id":"cx2h8k9m1n0p","provider":"ibm","status":"running"}
```

`status` is one of `queued`, `running`, `done`, `error`, `cancelled`. `counts`
appears only when the status is `done`; `error` appears only on failure.

For Braket the job id is the full quantum task ARN, which contains slashes — the
route accepts it verbatim:

```bash
curl -s "localhost:8000/api/hardware/job/braket/arn:aws:braket:us-east-1:123456789012:quantum-task/abcd-efgh"
```

Poll every 10–30 seconds. Faster polling gets you rate-limited, not results.

### Error responses

| Status | Meaning |
| --- | --- |
| 400 | Bad input: unparseable QASM, unknown backend, shots out of range, transpilation failure. |
| 503 | The SDK or credential is missing. The message names the exact `pip install` command or environment variable. |

---

## 5. Realistic queue times

| Device | Typical wait | Notes |
| --- | --- | --- |
| IBM open plan (`ibm_brisbane` etc.) | minutes to several hours | Free tier is the busiest queue; overnight UTC is usually faster. |
| IBM paid/premium instance | seconds to minutes | Reserved capacity or dedicated sessions. |
| IonQ Aria-1 / Forte-1 | ~1 hour to a full day | Trapped-ion shots are slow and jobs are batched into availability windows. |
| Rigetti Ankaa-3 | minutes to a few hours | Fast gates; availability windows still apply. |

Treat any hardware job as something you check back on later, not something you
wait on. A queued job survives an API restart — the id is all you need.

---

## 6. Cost table

**These numbers are indicative published rates transcribed by hand, not a live
price feed and not a quote.** Vendors change pricing; the authoritative number is
on the provider's pricing page and, ultimately, on your invoice.

| Vendor | Per shot (USD) | Per task (USD) | 1,000 shots |
| --- | --- | --- | --- |
| Simulators (Aer, Cirq, Braket local) | 0.00000 | 0.00 | free |
| IBM open plan | 0.00000 | 0.00 | free (metered in QPU-seconds) |
| IonQ (Aria-1, Forte-1) | 0.00003 | 0.30 | ~$0.33 |
| Rigetti (Ankaa-3) | 0.00035 | 0.30 | ~$0.65 |

The model is deliberately simple: `total = per_shot × shots + task_fee`. It does
not model AWS free-tier credits, reservation/hourly pricing, error-mitigation
surcharges or per-qubit pricing tiers. Rates live in
`app/quantum/transpile.py` (`PER_SHOT_USD`, `TASK_FEE_USD`) — update them there
when a vendor changes its pricing.

---

## 7. Safety note: it is real money

Braket QPU jobs bill your AWS account the moment they run. There is no sandbox
and no undo.

- **The per-task fee dominates small jobs.** Ten 100-shot IonQ jobs cost $3.03;
  one 1,000-shot job costs $0.33. Batch your shots.
- **Call `/api/hardware/estimate` first.** It is free and it takes the shot count
  straight from the request you are about to send.
- **Debug on `aer_simulator` or `braket_local`.** Only move to a QPU once the
  circuit and the shot count are final.
- **Cap your spend in AWS.** Set an AWS Budget with an alert, and prefer an IAM
  user scoped to Braket rather than root credentials.
- **`max_shots` (default 20,000) is the service-side guard.** Lower it in
  `.env` if hardware access is shared with people who should not be able to spend
  $7 in a single request.
- **A cancelled task can still be billed** if it had already started executing.
