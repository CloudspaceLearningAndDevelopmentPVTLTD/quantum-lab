# ADR-0003 — Qubit 0 is the least significant bit; bitstring labels print MSB-first

**Status:** accepted · **Applies to:** `apps/web/lib/quantum.ts` and everything that reads it

## Context

An *n*-qubit state is 2ⁿ complex amplitudes in a flat `Float64Array` of `[re, im]` pairs. Two
independent conventions have to be chosen:

1. **Which bit of the basis index is qubit 0.**
2. **Which end of the printed bitstring is qubit 0.**

They are genuinely independent, and picking them to agree — qubit 0 as the LSB *and* printed
rightmost, or qubit 0 as the MSB *and* printed leftmost — feels like the tidy choice. It is the
wrong one here.

## The failure this avoids

The circuit editor has two execution paths that render through the **same** `Histogram` component:
`lib/quantum.ts` in the browser, and `services/api` (Qiskit + Aer, or a vendor SDK) over HTTP. A
learner switches backends to compare a noisy run against an ideal one.

If the browser's labels disagree with Qiskit's, that comparison silently becomes a lie. A Bell
pair looks identical either way — `00`/`11` is symmetric — so the defect does not appear until a
learner runs something asymmetric, at which point the two bars have swapped and the product has
made a false claim about physics. That is the single worst failure mode this codebase has: not a
crash, not a 500, but a plausible wrong answer presented as a measurement.

Teleportation is the case where it bites: the circuit's whole point is that the state ends up on
qubit 2, and "which bar is qubit 2" is exactly the question the convention answers.

## Decision

- **Qubit 0 is the least significant bit.** Basis index `i` has qubit `q` set when
  `(i >> q) & 1 === 1`. This is the natural indexing for the in-place gate application loop and it
  is what Qiskit uses internally.
- **Bitstring labels print MSB-first** — `q_{n-1} … q_1 q_0` — which is Qiskit's display
  convention, so a circuit exported to QASM and run through Aer produces the same key strings the
  browser does.

The two conventions therefore *disagree* about which end qubit 0 is on, and that is correct.

## Consequences

- Reading `lib/quantum.ts` requires holding both conventions at once. Every function that converts
  between an index and a label is the place a bug would live, and the module header states the rule
  in its first ten lines so nobody has to infer it.
- Anything added to `quantum.ts` inherits the rule. A helper that reverses a label "to make it
  read naturally" breaks the cross-path guarantee.
- The guarantee is tested, not asserted: `lib/quantum.crosscheck.test.ts` pins this module's output
  against a fixture at `services/api/tests/data/js_statevectors.json`, and
  `services/api/tests/test_js_crosscheck.py` reads the same fixture and checks Qiskit and PennyLane
  agree. Regenerate it with
  `cd apps/web && QUANTUM_FIXTURE_WRITE=1 npx vitest run lib/quantum.crosscheck.test.ts` — and if
  you do, look at the diff, because a fixture you regenerate without reading is a test you deleted.

## What must not be undone

Do not "fix" the apparent inconsistency by flipping either convention. Both were chosen to match
Qiskit, which is the convention the rest of the field already reads; matching it is worth more than
internal symmetry.
