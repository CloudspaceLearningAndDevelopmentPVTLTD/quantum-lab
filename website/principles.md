# Engineering principles

Qubit16 is built by a small team at Cloudspace Learning and Development Private Limited. A small team cannot afford a large surface of half-working features, so the codebase is organised around a handful of principles that are enforced by tests and CI rather than by convention alone.

## 1. The browser does the work

The statevector simulator, every visualization, the circuit editor, the course and the offline tutor run entirely in the visitor's browser. No request leaves the device to simulate a circuit. This is why the full 16-qubit simulator is free on every plan with no account: it costs the deployment nothing to serve, and a learner on a train with no signal still has a working product.

The server exists for the things a browser genuinely cannot do: hold an account, meter a paid quota, call a real quantum computer, or run a large language model.

## 2. Every physics claim is cross-checked

A simulator that is subtly wrong is worse than no simulator: it teaches the wrong thing with confidence. The browser engine is a hand-written TypeScript implementation with zero runtime dependencies, and it is checked against two independent implementations, Qiskit and PennyLane, by tests that execute the real module. Random circuits of up to 16 qubits across the whole gate set must agree with Qiskit to 10⁻⁹ on every amplitude, global phase included. See [Verification against Qiskit](simulator/verification.md).

## 3. Nothing is claimed that is not shipped

Plan copy, the public `llms.txt`, search-result descriptions and the pricing page all read their numbers from `lib/plans.ts` rather than typing them. A test fails if a plan advertises a qubit ceiling other than the one its limits enforce. Documentation in `docs/` marks anything that has not been executed end-to-end as **[UNVERIFIED]** rather than describing it as done.

## 4. Authorisation happens where the data is

There is no global authentication middleware. Each API route handler verifies the caller's Supabase access token itself and decides what that caller may do. A proxy that half-enforces authorisation is worse than one that does not try, because it invites the assumption that routes behind it are protected. The paywall follows the same rule: the server never serves paid lesson content to a request it cannot identify, regardless of what the client claims.

## 5. Comments explain *why*

Code comments in this repository record the reasoning and the measurements behind a decision: the pixel widths that overflowed, the contrast ratio that failed, the exact floating-point value that broke a test. A reader should be able to tell whether a line is load-bearing without reverting it to find out. Architectural decisions with longer-term consequences are written up as ADRs in `docs/adr/`.

## 6. Fail loudly, degrade honestly

Rate limiting falls back to an in-process store when Redis is unavailable, and says so at startup. A hardware provider with no credentials is listed as *unavailable, with the reason attached*, not hidden. A test suite that cannot run in CI fails the job rather than silently skipping. The product would rather tell the operator something is degraded than pretend it is not.

## 7. Accessibility and responsiveness are correctness

A control that cannot be reached by keyboard, a button a screen reader cannot name, or a navigation bar that is off-screen on a phone are treated as bugs with the same priority as a wrong amplitude. The circuit editor is an ARIA grid navigable entirely by keyboard; automated axe scans and a responsive matrix across phone and tablet viewports run in the end-to-end suite.

## 8. Reproducibility outlives the website

A result a researcher cites must be reproducible a year later without this site existing. Circuits export as standard OpenQASM 3 that Qiskit reads unmodified, with exact π fractions preserved. The reproducibility bundle records what was run, with what settings, and when, with no clock call inside the module so the same inputs always produce the same bytes.
