# ADR-0004 — Exact π fractions in QASM export

**Status:** accepted · **Applies to:** `formatAngle()` in `apps/web/lib/quantum.ts`

## Context

`toQasm()` serialises a circuit to OpenQASM 3. Rotation gates carry an angle, and the angle has to
become text. The obvious implementation is a fixed number of decimal places:

```ts
`ry(${theta.toFixed(6)}) q[0];`   // DO NOT DO THIS
```

Six decimals looks like plenty. Save/load, share links and the API path all round-trip through this
function, so a circuit can make the trip many times in one session.

## The failure

`toFixed(6)` is lossy. `(π/3).toFixed(6)` is `1.047198`, which is not π/3.

Measured: exporting and re-importing a teleportation circuit shifted its probabilities by **~5e-8
per round trip**. The verified result for that circuit is `P(1) = 0.25` exactly; after a handful of
save/load cycles the state inspector was reporting a number that was no longer the one the test
asserts, and nothing had changed except the file it had been written to and read back from.

It compounds, it is invisible in the UI, and it makes "QASM export → import round-trips without
changing the physics" — one of the four verified claims in the README — false.

## Decision

Emit angles as **exact π fractions** when they are ones, and as a **round-trip-safe decimal**
otherwise.

```ts
const ratio = theta / Math.PI
for (const d of [1, 2, 3, 4, 6, 8, 12, 16]) { … }   // → 'pi', '-pi', '3*pi', 'pi/4', '2*pi/3'
return String(theta)                                 // shortest decimal that parses back exactly
```

- The fraction test is a **snap, not an equality check**: an angle within `1e-12` of `n·π/d` is
  written as that fraction. So an angle that close but not equal moves by at most `π·1e-12 ≈
  3.2e-12` rad on the round trip. That is deliberate — it keeps `pi/3` readable when the angle was
  accumulated by dragging a slider — and it is four orders of magnitude below the ~1e-8 drift it
  replaced. For the fractions themselves the round trip is bit-exact.
- The fallback is `String(theta)`, not `toFixed(n)`: JavaScript's default number-to-string is the
  shortest decimal that parses back to exactly the same double.
- A non-finite angle **throws**. `String(NaN)` is `"NaN"`, which used to be written straight into
  the file, producing QASM no parser accepts and that this module's own `fromQasm()` silently read
  back as `0`.

## Consequences

- Exported QASM is more readable than a decimal dump, and it is the form Qiskit's own
  `qasm3.dumps` emits.
- **`services/api` cannot parse it today.** Qiskit's native OpenQASM 3 parser folds no arithmetic
  in a gate parameter, and `qiskit-qasm3-import` is not in `services/api/requirements.txt` — see
  `services/api/tests/test_js_crosscheck.py`. Emitting decimals from the browser would work around
  that at the cost of correctness and readability; the parser is the wrong side to fix. Installing
  `qiskit-qasm3-import` on the API is the real fix and it is one line in a file this workstream
  does not own.
- `fromQasm()` has to evaluate a small expression grammar (`pi`, `-pi`, `3*pi`, `pi/4`, `2*pi/3`,
  plus plain decimals from other toolchains). That parser exists and is tested.

## What must not be undone

Do not replace `formatAngle` with `toFixed`, and do not widen the `1e-12` snap tolerance to make
more angles "look nice". Widening it trades exactness for cosmetics in the one function whose
inexactness the round-trip tests are there to catch.
