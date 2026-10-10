# Gate set & OpenQASM 3

## The gate library

Gates were added in three waves, and `GATE_LIBRARY` is append-only because the MCP gate reference and the search index address it by position.

| Wave | Gates |
| --- | --- |
| Base | H, X, Y, Z, S, S†, T, T†, RX, RY, RZ, P, CX, CY, CZ, SWAP, CCX (Toffoli), MEASURE, BARRIER |
| Extended (the gap against Quirk) | √X, √X†, CSWAP (Fredkin), MCX (multi-controlled X, any number of controls), UNITARY (custom 2×2 or 4×4 matrix), ADDK (+k mod N), MULK (×k mod N), QFT, QFT† |
| Trajectory and universal | RESET, POSTSELECT, U3(θ, φ, λ) |

A `GateOp` names its gate and target qubits, with optional fields for angle(s), a classical bit to record into, a classical condition, a matrix, arithmetic constants, a count of leading control qubits (register blocks) and an array of extra controls (single-qubit gates). The last two are different shapes with different names on purpose: conflating a *count* with an *array* was identified as a dangerous bug class and designed out.

### Custom matrices

A UNITARY op carries a row-major 2×2 or 4×4 matrix. For two qubits, `qubits[0]` is the least significant bit of the matrix index, consistent with the engine. The matrix is checked for unitarity (`max |(U†U − I)ᵢⱼ| ≤ 10⁻⁶`) on **every** application and on every export, not only in the editor, because a matrix can arrive through a saved circuit, a share link or pasted QASM. The editor's entry grammar accepts `1`, `-0.5`, `i`, `0.5i`, `1/sqrt2`, `(1+i)/2` and decimal forms, with presets for √X, √Y, iSWAP, √SWAP, CZ and CS.

### Controls in any basis

Any single-qubit gate (and a 1-qubit UNITARY) can carry `extraControls`, each with a qubit, a basis (`Z` by default, or `X`, `Y`) and an `anti` flag. A control fires on the +1 eigenstate of its basis (|1⟩, |+⟩, |+i⟩) or, when negated, the −1 eigenstate (|0⟩, |−⟩, |−i⟩). The engine implements X- and Y-basis controls by a basis change on the control (H, or S†H), a Z-basis general-controlled application, and the inverse change, which is exact. Duplicate controls and a control that is also the target throw.

### Register blocks

ADDK, MULK, QFT and QFT† act on a run of qubits (least significant first), optionally behind leading control qubits, up to a block width of 10. The arithmetic gates are basis permutations: register values ≥ N pass through unchanged, which is what makes a controlled ×a mod N the U_a of Shor's algorithm. The QFT is the H plus controlled-phase ladder with bit reversal, and the test suite pins it against the dense DFT matrix.

### Initial states

A circuit may declare per-qubit initial states from {|0⟩, |1⟩, |+⟩, |−⟩, |+i⟩, |−i⟩}. On export these fold into literal preparation gates, so the exported circuit reproduces the exact state even though the "chosen from a picker" metadata does not survive.

## OpenQASM 3 export

`toQasm()` writes standard OpenQASM 3 that Qiskit's importer reads **unmodified**:

```qasm
OPENQASM 3.0;
include "stdgates.inc";
gate qb16_u0 a { gphase(0.7854); U(1.0472, 0.5236, -0.2618) a; }

qubit[3] q;
bit[3] c;

ry(pi/3) q[0];
h q[1];
cx q[1], q[2];
negctrl @ qb16_u0 q[1], q[0]; // qubit16 {"label":"V","matrix":[[0.7071,0],...]}
c[0] = measure q[0];
if (c[0] == true) { x q[2]; }

c = measure q;
```

The design decisions, each of which has a test and most of which have a story:

- **Exact π fractions** (ADR-0004). An angle within 10⁻¹² of `k·π/d` for `d ∈ {1,2,3,4,6,8,12,16}` is written as `pi/4`, `2*pi/3`, `5*pi/16`; anything else is written as JavaScript's shortest round-trip decimal. The earlier `toFixed(6)` drifted teleportation's probabilities by about 5×10⁻⁸ per round trip. The consequence is that the API service requires `qiskit-qasm3-import`, because Qiskit's native reader folds no arithmetic, not even bare `pi`, and a test guards that dependency.
- **Custom matrices become named gates.** Each distinct matrix is defined once as `qb16_uN` with a body of standard gates. The body carries `gphase(γ)`, which is what makes `ctrl @ qb16_uN` correct: under a control, a global phase is a relative phase. The call line carries a `// qubit16 {…}` annotation with the exact matrix so the importer can rebuild the op without reverse-engineering the decomposition.
- **Basis-aware controls compile down.** A Z-basis control is `ctrl @` or `negctrl @`; X and Y controls emit explicit basis-change lines before and after. Only all-Z controls round-trip as a single op; the high-level X/Y annotation is lost, by design, because standard OpenQASM has no way to say it.
- **Conditioned gates use the boolean form** `if (c[k] == true) { … }`, which is what `qiskit.qasm3.dumps` emits. The earlier `if (c[0] == 1) x q[2];` was rejected by every Qiskit parser, so every circuit with classical control had been unrunnable on the service until this was found.
- **Measurement.** A recorded measurement is `c[k] = measure q[j];`. The file always ends with `c = measure q;` so the service's runner, which needs every qubit measured to return counts, can run it. A legacy measurement with no classical bit is dropped on export (the state is identical; the op list is not).
- **POSTSELECT has no standard form** and is written as a clearly marked simulator-only comment that the importer recognises exactly.

## Import

`fromQasm()` is total: garbage in produces an empty circuit, never a throw, because share links, the circuits page and the save/load panel all parse at render time. It reads OpenQASM 3 and OpenQASM 2 (`qreg`, `creg`, `measure q[i] -> c[j]`, `u3`), evaluates angle expressions over `*`, `/`, numbers and `pi`, recognises `ctrl(k) @` and `negctrl(k) @` modifiers, rebuilds `qb16_*` blocks from their names and custom matrices from their annotations, and drops instructions the engine would reject (repeated qubits, wrong operand counts, unknown gates).

Round-trip guarantees are tested: every wave-2 gate round-trips to a deep-equal op list and identical amplitudes; every preset and 100 random circuits round-trip bit-for-bit; twenty export–import cycles show no drift.
