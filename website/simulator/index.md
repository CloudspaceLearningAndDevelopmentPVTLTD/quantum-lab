# The simulator engine

`apps/web/lib/quantum.ts` is a statevector simulator written from scratch in TypeScript with **zero runtime dependencies**. It is the engine behind the circuit editor, the step inspector, the research tools, the MCP server's `run_circuit` and `get_statevector_at_step`, the challenges grader and the visualizations that build circuits. Its output is checked against Qiskit and PennyLane on every CI run ([Verification](verification.md)).

## State representation

A `StateVector` holds `2^n` complex amplitudes in a single interleaved `Float64Array` of length `2 × 2^n`: `[re₀, im₀, re₁, im₁, …]`. The constructor sets `data[0] = 1`, so every circuit starts in |0…0⟩.

**Qubit 0 is the least significant bit.** Basis index `i` has qubit `q` set when `(i >> q) & 1 === 1`. Labels print most-significant qubit first (`i.toString(2).padStart(n, '0')`), which is Qiskit's display convention, so the browser and the Qiskit-backed service render through the same histogram without reordering. This is ADR-0003, and it exists because a convention mismatch would silently swap bars on asymmetric circuits (teleportation's target is qubit 2) rather than crash.

**The ceiling is 16 qubits.** `2^16` complex doubles is 1 MiB, the largest allocation that stays interactive on every edit in a browser tab: `simulateSteps()` on 16 qubits and 20 gates takes about 50 ms (median 51.5 ms over ten runs), so the editor re-simulates synchronously on each placement with no debounce. The constructor rejects a non-integer count (`1 << 1.5` is 2) and anything outside 1–16. Larger registers are the job of the [GPU and CPU reference backends](engines.md), which go to 27 and 30 qubits respectively.

The class exposes exact reads (`amplitude`, `probability`, `qubitProbability`, `blochVector`, `entanglementEntropy` as the von Neumann entropy in bits of the one-qubit reduced state), gate application (`apply(op)` for any `GateOp`, plus the lower-level `applySingleMatrix`, `applyControlledMatrix`, `applyGeneralControlled`, `applySwap`), and measurement (`measureQubit(q, rng)`, `collapseQubit(q, outcome)`).

Every qubit and basis index is validated once per gate, not once per amplitude; the guards exist because out-of-range indices once produced `NaN` statevectors silently. Invalid input throws; the only total function in the module is `fromQasm`, which drops what it cannot accept, because three render-time callers must never crash on a shared link.

## One pass feeds every view

The simulator page calls `simulateSteps(circuit)` once per edit and keeps every intermediate frame: `frames[0]` is the initial state and `frames[i + 1]` is the state after op `i`. The final frame **is** the full-circuit state, so the amplitude table, the per-qubit phase disks, the Q-sphere, the column probe (hover any column to see each qubit's P(1) after it), the step inspector's before/after view and the research panel all read from one computation. Everything is memoised on the circuit object.

## What the engine does not do

- It does not model noise itself; `lib/quantum/noise.ts` layers Monte-Carlo trajectory noise on top of it.
- It does not go past 16 qubits; the backends do.
- It does not evaluate anything from a language model. Workbench tools that take model output parse it into a small DSL or a `Circuit` first.

## Pages in this section

| Page | Covers |
| --- | --- |
| [Gate set & OpenQASM 3](gates-and-qasm.md) | Every gate, custom matrices, basis-aware controls, the exporter and importer, exact π fractions |
| [Execution, measurement & classical control](execution.md) | Seeded trajectories, exact branch enumeration, shots and readout noise |
| [Verification against Qiskit](verification.md) | The three-layer test strategy and what it has caught |
| [GPU, stabilizer & other engines](engines.md) | WebGPU backend, 27-qubit CPU reference, 4,096-qubit Clifford tableau, routing, noise, tomography, physics modules |
| [Research tools](research-tools.md) | Exact Pauli expectation values and statevector downloads |
