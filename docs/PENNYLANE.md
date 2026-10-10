# PennyLane, and which engine actually ran your circuit

`services/api/app/quantum/pennylane_runner.py` — what the middleware layer
does, where the bit order flips, why noise no longer goes through it, and how
we know it agrees with Qiskit.

---

## 1. Two engines, one result shape

The architecture calls for a single quantum middleware layer rather than one
hand-written adapter per SDK. This module is that layer: it parses OpenQASM with
the service's existing `parse_qasm` (it never re-implements parsing),
translates the resulting Qiskit instructions into PennyLane operations, runs
them on whichever device a backend id maps to, and returns the exact dictionary
`run_circuit` has always returned.

`run_circuit` tries PennyLane first for simulator backends and falls back to
Qiskit. The fallback is total: `_try_pennylane` catches **every** exception and
returns `None`, so a translation gap, a missing plugin or an execution failure
never becomes a user-visible error — it becomes a Qiskit run. That is why an
unsupported gate raises during translation, before anything executes, rather
than being skipped: skipping would return a wrong distribution silently.

The response says which engine ran, in `engine`. It is not cosmetic. The two
engines have different gate coverage, so the same circuit can take different
paths on different deployments, and a support question that starts "the numbers
changed" is answered by that field.

| backend id       | PennyLane device   | plugin needed                     |
|------------------|--------------------|-----------------------------------|
| `aer_simulator`  | `lightning.qubit`  | `pennylane-lightning` (required)   |
| `cirq_simulator` | `cirq.simulator`   | `pennylane-cirq` (optional)        |
| `braket_local`   | `braket.local.qubit` | `amazon-braket-pennylane-plugin` (optional) |
| `aer_noisy`      | **none — see §3**  |                                    |

Hardware ids are absent on purpose: real QPUs are queued and go through the
asynchronous submit/poll path in `app/quantum/hardware.py` and
`app/quantum/azure.py`.

## 2. The bit-order trap

This project follows Qiskit: **qubit 0 is the least significant bit**, basis
index `i` has qubit `q` set when `(i >> q) & 1`, and labels print MSB-first.
`apps/web/lib/quantum.ts` uses the same convention, which is what lets the
browser's amplitudes and the service's be compared element by element with no
reordering.

PennyLane does the opposite. Wire 0 is the **most significant** position, in two
separate places, and both need undoing:

* **Amplitudes.** `statevector_with_pennylane` reverses the bits of every index
  before writing it into the output array.
* **Counts keys.** `_to_project_bitstring` reverses every counts string. An X on
  qubit 0 of a two-qubit register comes back from PennyLane as `"10"` and must
  be reported as `"01"`.

Miss either one and every asymmetric multi-qubit result in the product is
mirrored, silently and plausibly. Bell and GHZ still look perfect, because they
are symmetric — which is exactly why a test suite built on Bell and GHZ would
not notice.

Both reversals are covered by mutation-tested assertions: deleting the amplitude
reversal fails
`test_js_random_crosscheck.py::test_js_and_pennylane_agree_on_every_circuit` plus
four fixture cases, and deleting the counts reversal fails
`test_measured_counts_match_the_js_distribution`. Both were confirmed to fail by
actually removing them, not by inspection.

## 3. Noise does not go through PennyLane, on purpose

`aer_noisy` used to map to PennyLane's `default.mixed` density-matrix device,
which applied one `DepolarizingChannel` per wire **after the whole circuit**.
Aer models noise **per gate**, with thermal relaxation and readout error. Those
are different physics: a 20-gate circuit got 3 channels on one engine and 20-odd
on the other.

Which engine ran was decided by whether a plugin happened to be installed. So
the same request, on the same backend id, returned materially different
distributions on two deployments, and nothing told the learner which one they
had. For a backend whose entire purpose is to stand in for hardware, that is the
worst possible kind of disagreement.

`run_with_pennylane` now refuses any noisy request. The refusal is a `ValueError`,
which `_try_pennylane` treats as "fall back to Qiskit", so a noisy circuit still
runs — on the engine that owns the model. There is exactly one noise model in
the service, in `app/quantum/runner.py`.

Two things fell out of removing it. `default.mixed` stores `16 * 4^n` bytes and
was measured at ~100x slower than Aer at the same width (12 qubits: 87.4 s
versus 0.83 s; 14 qubits is 4 GB), so a whole cost curve disappeared with it.
And the `pennylane` entry in `_DEVICE_PLUGINS` went with it.

### What the noise model actually models

`build_device_noise_model()` composes three error sources from the `DEVICE_*`
constants:

| term                 | value                | what it does |
|----------------------|----------------------|--------------|
| T1 (energy decay)    | 230 µs               | excited state leaks to ground over gate time |
| T2 (dephasing)       | 130 µs               | phase coherence decays; physically must be ≤ 2·T1 |
| 1-qubit gate         | 60 ns, error 2.5e-4  | applied to h/x/y/z/s/t/rx/ry/rz/p/u/sx |
| 2-qubit gate         | 660 ns, error 7.5e-3 | applied to cx/cy/cz/swap/ecr |
| readout              | 1.5e-2               | symmetric bit flip at measurement |

**Where they came from:** IBM's published median calibration figures for the
Eagle r3 family — `ibm_brisbane`, `ibm_kyiv`, `ibm_sherbrooke`, the three
devices this service lists. They are a **specification sheet, not a
measurement**. Nothing is read from a live backend, per-qubit variation on a
real device spans roughly a factor of five around each median, and calibration
moves daily. The model is right to about an order of magnitude and that is the
claim it makes. The `notes` field on every noisy result says so in those words.

**To make it real:** with `qiskit-ibm-runtime` installed and `IBM_QUANTUM_TOKEN`
set, `NoiseModel.from_backend(service.backend(name))` builds the same object
from that device's current calibration, per qubit and per gate. That is a
network call on the request path, so it is not the default and is not wired up.

**What it replaced:** a flat depolarising probability of 0.02 for 1-qubit gates
and 0.04 for 2-qubit ones, with no decoherence and no readout error at all. 0.02
has no source. It is roughly 80x IBM's median 1-qubit error and 3x its median
2-qubit error — so it got the absolute size wrong in one direction and the ratio
between one- and two-qubit gates wrong in the other. On real hardware a CX is
~30x worse than an X, not 2x, and a learner tuning a circuit against the old
model would draw the wrong conclusion about where depth costs them.

**Measured behaviour of the new model** (`tests/test_noise.py`, and these are
the numbers the tests assert against):

```
X gates   gate time    P(1) measured    exp(-t/T1) + readout floor
      1      0.1 us         0.983            0.985
    401     24.1 us         0.896            0.889
   1601     96.1 us         0.722            0.654
   3833    230.0 us         0.573            0.372
  11499    690.0 us         0.502            0.063
```

Short depth follows T1. Long depth saturates at 0.5, not 0 — the composed
depolarising term destroys the state faster than relaxation empties it, so the
endpoint is the maximally mixed state rather than the ground state. That is
correct for this channel and is asserted separately.

A Bell pair shows 3.6% weight on the forbidden `01`/`10` outcomes at 20 000
shots, which is the range published two-qubit Bell fidelities on Eagle devices
sit in. The ideal backend gives exactly 0.

> **If you write another decoherence probe, put a `barrier` between the gates.**
> Aer transpiles before simulating and cancels adjacent inverse gates: a chain
> of 11 499 X gates becomes one X. The first version of the T1 test measured a
> flat line and would have passed with thermal relaxation switched off entirely.

### The `noise` parameter is a separate thing

`noise` in the API is the teaching dial and keeps its documented meaning: the
flat depolarising probability applied to a 1-qubit gate, 2x that for 2-qubit
gates. Ask for 0.3 and a Bell peak visibly collapses. It is not a hardware
model and does not pretend to be — supplying it explicitly bypasses the device
model entirely, and the `notes` field changes accordingly.

Note that `noise` means a third thing again in the browser: `run()` in
`apps/web/lib/quantum.ts` flips each *measured bit* with that probability, which
is a readout model, not a gate model. Same word, same slider range, three
different physics. That is a web-side concern and is listed as such in the
handover notes.

## 4. How we know the engines agree

Two suites, both live, neither able to pass vacuously.

**`tests/test_js_crosscheck.py`** compares against
`tests/data/js_statevectors.json` — twelve hand-picked circuits generated by
`apps/web/lib/quantum.crosscheck.test.ts`, covering all six web presets plus
cases chosen for what differs between implementations (operand order on
controlled gates, the RY/RZ sign convention, RZ's global phase, the three-qubit
gate, an angle that is not a nice fraction). Fast, no Node required.

**`tests/test_js_random_crosscheck.py`** transpiles `apps/web/lib/quantum.ts`
with esbuild on every run, executes the real module in Node, and compares 60
seeded random circuits plus every preset — read through the module, so a preset
added in the web app is picked up without editing the test. Three engines are
compared, not two: JS vs Qiskit vs PennyLane. Two agreeing and one outlier tells
you immediately which is wrong.

Measured worst-case disagreement across all 66 circuits: **6.71e-16** (JS vs
Qiskit, on `random-q2-00`) and **6.66e-16** (JS vs PennyLane, on
`preset:grover2`) — i.e. a few units in the last place of a double, against a
1e-9 tolerance. Global
phase is not modded out — the engines agree on it exactly, which pins `rz` to
Qiskit's `e^{-iθ/2}` convention rather than `u1`'s.

The suite skips when Node or `node_modules` is absent, so a Python-only checkout
still runs everything else — and the fixture-based file always runs, so the
cross-check is never entirely absent.

Three guards stop these from passing without proving anything:

* `test_the_batch_is_the_size_it_claims` fails if generation broke and produced
  an empty list, and requires at least one Toffoli and one exact pi fraction.
* `test_an_inverted_bit_order_would_be_caught` mirrors the JS amplitudes on
  purpose and asserts that at least half the batch then *disagrees* with Qiskit.
  If it fails, the circuit set has become too symmetric to detect a mirrored
  register and every agreement assertion above it is toothless.
* The counts comparison requires at least five circuits with a genuinely
  impossible outcome, or it reports itself as toothless.

## 5. Gate coverage, and what falls back

Translated: `h x y z s sdg t tdg rx ry rz p u1 cx cy cz swap ccx`, plus
`barrier`, `measure`, `delay` and `id` as no-ops.

Anything else — including `u`, `crx`, `rzz` and every custom gate — raises during
translation and the circuit runs on Qiskit instead. This is invisible to the
caller except through the `engine` field, and it is the intended behaviour: the
gate set is deliberately explicit so that a gate PennyLane would interpret
differently cannot be silently mistranslated.

Two more cases hand the circuit back to Qiskit:

* a circuit whose classical bit count is neither 0 nor equal to its qubit count
  (PennyLane samples the whole register, so a partial measurement cannot be
  reproduced faithfully);
* a measurement whose qubit→clbit map is not the identity, for the same reason.

## 6. Open

* **`u` does not parse at all.** `qiskit-qasm3-import` rejects `u(...)` as an
  undefined gate against `stdgates.inc`, so it fails before either engine sees
  it. Nothing in this repo emits it — `apps/web/lib/quantum.ts` has no U gate —
  but a circuit pasted from Qiskit's own `qasm3.dumps` of a transpiled circuit
  can contain one.
* **The noise model is a spec sheet, not a calibration.** §3. Wiring
  `NoiseModel.from_backend` behind a cache is the upgrade.
* **Only `lightning.qubit` is exercised.** The Cirq and Braket device mappings
  have never run in this environment; neither plugin is installed. They degrade
  to "install this package", which is honest, but they are untested paths.
