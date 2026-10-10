# PennyLane: the unified execution layer

## Why this exists

The platform's infrastructure design makes one architectural recommendation above all others:

> Use PennyLane as your unified quantum middleware — it wraps Qiskit, Cirq, Braket, and
> others under one API. Your platform talks to PennyLane; PennyLane routes to whichever
> backend the user picks... Best for backend-agnostic platform design — let users choose
> their hardware, you only write one integration.

That is the whole argument: **one integration instead of N.** Before this layer existed,
`runner.py` hand-coded a `_run_on_*` function per vendor — one for Aer, one for Cirq, one
for Braket — each with its own conversion, its own bitstring quirks, and its own failure
modes. Every new simulator meant another such function. That is exactly the coupling the
design doc set out to prevent.

`app/quantum/pennylane_runner.py` is the middleware. The service now talks to PennyLane,
and PennyLane routes to the device the user picked.

## Device mapping

`PENNYLANE_DEVICES` in `app/quantum/pennylane_runner.py` maps this project's backend ids
onto PennyLane device strings:

| Backend id       | PennyLane device     | Plugin (pip)                      | Why |
| ---------------- | -------------------- | --------------------------------- | --- |
| `aer_simulator`  | `lightning.qubit`    | `pennylane-lightning`             | PennyLane's fast C++ statevector simulator |
| `aer_noisy`      | `default.mixed`      | `pennylane` (built in)            | Density-matrix device; the only one that accepts noise channels |
| `cirq_simulator` | `cirq.simulator`     | `pennylane-cirq`                  | Google's reference simulator |
| `braket_local`   | `braket.local.qubit` | `amazon-braket-pennylane-plugin`  | Amazon's local simulator |

Hardware ids (`ibm_brisbane`, `ionq_aria`, `azure_quantinuum_h1`, ...) are deliberately
**absent** from this map. Real QPUs are queued resources and go through the asynchronous
submit/poll path in `app/quantum/hardware.py` and `app/quantum/azure.py`, not through a
synchronous QNode.

## Adding a new simulator backend

One line in `PENNYLANE_DEVICES`, plus one line in `_DEVICE_PLUGINS` naming the module and
pip package so an uninstalled plugin produces an actionable message:

```python
PENNYLANE_DEVICES["qulacs_simulator"] = "qulacs.simulator"
_DEVICE_PLUGINS["qulacs.simulator"] = ("pennylane_qulacs", "pennylane-qulacs")
```

Then add the matching `BackendInfo` entry in `app/quantum/backends.py` so it appears in the
registry. Nothing in `runner.py` changes — that is the point of the middleware.

## Bit order: the trap

**PennyLane wire 0 is the leftmost character of its bitstring. This project labels qubit 0
as the least significant bit — the rightmost character.**

The two conventions are mirror images, and the mirror is invisible on symmetric states.
A Bell pair looks identical under both (`00`/`11`), and so does GHZ — which is precisely why
a wrong conversion can survive a whole test suite. It only shows up on an asymmetric state:

| Circuit                          | PennyLane raw | Correct project label |
| -------------------------------- | ------------- | --------------------- |
| `x q[0]` on a 2-qubit register   | `"10"`        | `"01"`                |
| `x q[1]` on a 2-qubit register   | `"01"`        | `"10"`                |

The conversion is a single explicit reversal in `_to_project_bitstring()`, applied to every
counts key before it leaves the module. The same reversal, applied to amplitude *indices*
rather than labels, appears in `statevector_with_pennylane()`.

`tests/test_pennylane.py::test_pennylane_bit_order_qubit_zero_is_least_significant` asserts
the asymmetric case directly. That test is the reason the file exists — do not weaken it.

## When the Qiskit fallback triggers

PennyLane is the default for simulator backends, but it is never allowed to turn a runnable
circuit into a user-visible error. `runner._try_pennylane()` returns `None` — not an
exception — and `run_circuit` falls through to the original Qiskit path whenever:

* **The backend has no PennyLane device.** Hardware ids, or any id absent from `PENNYLANE_DEVICES`.
* **The device plugin is not installed.** e.g. `cirq_simulator` with `pennylane-cirq` missing.
* **The circuit uses an untranslatable gate.** The translator supports `h, x, y, z, s, sdg,
  t, tdg, rx, ry, rz, p/u1, cx, cy, cz, swap, ccx` plus `barrier`/`measure` as no-ops.
  Anything else — `u3`, `crx`, a custom opaque gate — raises `ValueError` naming the gate
  **before execution**, so a wrong distribution is never returned in place of a right one.
* **The measurement map is not the identity,** or the classical register is narrower than the
  quantum one. PennyLane samples the whole register; Qiskit reproduces partial measurement
  faithfully, so those circuits go to Qiskit.
* **Any execution failure at all.** Device construction, plugin registration, empty results.

Every fallback is logged (`logging.getLogger("app.quantum.runner")`) at DEBUG for a missing
device and INFO for a translation or execution failure.

## Telling which engine ran

`run_circuit()` returns an additive `engine` key on every response:

```json
{ "counts": {"00": 512, "11": 512}, "engine": "pennylane", "notes": "Executed through PennyLane on the 'lightning.qubit' device." }
```

* `"pennylane"` — the middleware ran it; `notes` names the device.
* `"qiskit"` — the legacy path ran it, either as a fallback or because the backend has no
  PennyLane mapping.

Adding this key is backwards compatible: `counts`, `probabilities`, `labels`, `shots`,
`backend`, `duration_ms`, `num_qubits`, `depth` and `notes` are unchanged in name, shape and
meaning, so `routers/circuits.py`, `jobs/queue.py` and the TypeScript client in
`apps/web/lib/hardware/` keep working untouched.

## Azure Quantum

`app/quantum/azure.py` was added alongside this work because `AZURE_QUANTUM_RESOURCE_ID`
was advertised in `.env.example` with no backend behind it. It mirrors `hardware.py`
exactly — `azure_available()`, `list_azure_targets()`, `submit_azure_job()`,
`poll_azure_job()` — with the same record shapes, so no router or client change was needed.
It requires `pip install azure-quantum` plus `AZURE_QUANTUM_RESOURCE_ID` and
`AZURE_QUANTUM_LOCATION`; without them the targets are still listed, from the static
catalogue, with `available: false` and a `reason` naming what is missing.
