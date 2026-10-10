# Research tools

The simulator page carries a **Research tools** panel that answers the question a researcher actually has after building a circuit: *what number did the simulator compute?* Both tools are exact. There is no sampling, no shot noise, and nothing is re-run elsewhere.

## Exact expectation values

Type a Pauli-sum observable and the panel reports ⟨ψ|H|ψ⟩ for the final state, together with each term's own ⟨P⟩. The grammar accepts the forms people actually write:

| Input | Meaning |
| --- | --- |
| `Z0 Z1` | Z on qubit 0 times Z on qubit 1 |
| `0.5*X0X1 - 0.3 Y2` | coefficients, `+`/`−`, optional `*` |
| `ZZI` | a full-width label, **rightmost letter = qubit 0** (Qiskit order) |
| `I` or `1` | the identity |
| `1e-1 X0X1` | scientific notation |

Parsing lives in `apps/web/lib/quantum/pauli.ts` and refuses with a message the user can act on: a qubit that does not exist, a qubit used twice in one term, a full-width label of the wrong length (with the sparse form suggested instead), and a cap of 256 terms so a pasted input cannot stall the page.

### How it is computed

A Pauli string P is encoded as two bit masks, `xMask` and `zMask`, with Y contributing to both. For a basis state |i⟩:

```
P|i⟩ = i^{nY} · (−1)^{popcount(i & zMask)} · |i ⊕ xMask⟩
```

so ⟨ψ|P|ψ⟩ is a single pass over the amplitudes with no matrix ever formed. At 16 qubits that is 65,536 complex multiply-adds per term, which is instantaneous. The result is exactly real for a Pauli, and the implementation returns the real part after the i^{nY} rotation.

Against Qiskit's `SparsePauliOp.expectation_value` on random states of 1 to 16 qubits and random eight-term sums, the worst disagreement measured is 4.4 × 10⁻¹⁶.

## Download the exact final state

Two buttons export every amplitude at full double precision:

- **CSV** — `index, bitstring, re, im, probability` for every basis state, with the bit-order convention written into a header comment. Loads straight into pandas or NumPy.
- **JSON** — `format: qubit16-statevector/v1`, the qubit count, the convention, the circuit's OpenQASM 3 source, the amplitude pairs and the probabilities. The QASM travelling with the numbers means the file carries its own provenance; `Statevector(qasm3.loads(...))` in Qiskit reproduces the amplitudes.

## When the state is one branch

A circuit with mid-circuit measurement or classical control does not have a single final state; its result is a mixture over measurement outcomes. The display shows one seeded trajectory. The panel detects this (`hasClassicalControl`) and says so above the tools, and the JSON export carries the same note, so a downloaded file cannot be mistaken for an average. The exact branch probabilities are available through the step inspector's outcome enumeration.
