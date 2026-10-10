# Execution, measurement & classical control

A circuit without measurement is a unitary and has one final state. A circuit with mid-circuit measurement, feed-forward, reset or postselection has a *distribution* of final states. The engine handles both honestly, and one predicate decides which semantics apply.

## The switch

`hasClassicalControl(circuit)` is true when any op has a `condition`, is a MEASURE that records into a classical bit, or is RESET or POSTSELECT. Every circuit built before classical control existed takes the plain unitary path and behaves exactly as it always did; a MEASURE with no classical bit is a legacy no-op in `simulate()`, so the inspector shows the state before collapse.

## Three ways to execute

| Function | Semantics | Use |
| --- | --- | --- |
| `simulate(circuit)` | Unitary: apply every op, normalise. With classical control: **one seeded trajectory** | The editor's live state |
| `execute(circuit, { rng, forceOutcomes })` | One trajectory with an explicit RNG; returns the final state, the classical register, a record of every measurement (`outcome`, `p1`) and which conditioned ops were skipped | Sampling, tests |
| `outcomeBranches(circuit)` | **Exact enumeration** of every measurement branch with its probability and final state | Analytics, teaching, verification |

The seed for the editor's trajectory is an FNV-1a hash of the circuit's contents, so React re-renders of the same circuit show the same branch and the display does not flicker between outcomes. `simulateSteps()` uses the same seed and emits a frame for every op, including a skipped conditioned op, so step numbers stay aligned with the diagram.

## Exact branch enumeration

`outcomeBranches` walks the circuit keeping a list of partial branches `{ state, clbits, probability }`. A recorded MEASURE splits each branch into outcome 0 and outcome 1 with the Born probabilities (branches below 10⁻¹⁵ are dropped; order is stable, 0 before 1). RESET splits and then flips the 1-branch back to |0⟩ without writing a bit. POSTSELECT keeps one outcome and drops the other world; final probabilities are renormalised by the surviving weight and the function throws if nothing survives. Conditioned gates run only on branches whose register matches.

The cap is 4,096 branches (2¹²). Past that, enumeration stops being the cheap way to be exact and the function says so: *sample with execute() instead*. Every protocol on the site is far under the cap (teleportation has two recorded measurements).

Two derived views: `clbitDistribution(branches)` gives the probability of each classical-register value, keyed most-significant bit first; `outcomeProbabilities(circuit)` gives the exact per-basis-state probability averaged over every branch, which is the mixed state's diagonal.

## Shots and readout noise

`run(circuit, shots = 1024, noise = 0, seed?)` returns counts, probabilities, labels and a display statevector.

- Without classical control, probabilities come from the exact state.
- With classical control and at most 12 recorded measurements, probabilities come from exact enumeration.
- Beyond 12 recorded measurements, `max(256, shots)` trajectories are sampled and the result is marked approximate.
- Sampling is inverse-transform with a binary search over the cumulative distribution.
- Readout noise flips each measured bit independently with probability `noise`.

The RNG is `mulberry32` (a 32-bit PRNG) when a seed is given and `Math.random` otherwise; every test and every cross-check uses a seed. A `gaussian()` helper (Box–Muller) exists for the noise and physics modules.

## Verification of the dynamic path

Because a dynamic circuit has no single statevector, it is verified against the distribution. The Python cross-check runs classically controlled circuits on the service to prove the exported QASM is runnable, and the exact enumeration was checked branch-by-branch against an independent NumPy simulation on 63 random dynamic circuits of up to 16 qubits and 256 branches, matching both the final probability distribution and the classical-register distribution to 10⁻¹⁴. `lib/quantum.classical.test.ts` asserts hand-computed branch probabilities and corrected output states for the protocols in the course.
