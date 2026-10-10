# Reddit launch posts

<!--
Two posts, two audiences. Claims verified against the repo before writing:
viz catalogue = lib/visualizations.ts (12 entries); cross-check test =
lib/quantum.crosscheck.test.ts + services/api/tests/test_js_crosscheck.py;
Bell-state correction = docs/TUTOR.md "What the harness exposed";
barren-plateau correction = components/viz/vqe/landscape.ts header comment
(measured numbers quoted from it verbatim); classroom features =
docs/CLASSROOM.md; privacy = docs/ANALYTICS.md; simulator entropy readout =
lib/quantum.ts entanglementEntropy. Re-check numbers before posting if the
tree has moved.

The physics-educators post is written for r/PhysicsTeaching-style communities
(r/AskPhysics and r/Physics ban self-promotion in top-level posts — check the
target sub's rules the week of launch, and prefer a sub with an explicit
resources/self-post allowance).
-->

---

## Post 1 — r/QuantumComputing

**Title:** I built a browser statevector simulator cross-checked against Qiskit and PennyLane, plus 12 live visualizations — and the test harness caught two physics errors in my own teaching content

**Body:**

I've spent the last while building Quantum Lab, an interactive course where
every visualization computes its physics live — the tunneling page integrates
the time-dependent Schrödinger equation (staggered leapfrog, absorbing
boundaries), the double-slit page samples individual impacts from a
sinc²·cos² intensity pattern it computes itself, and the circuit editor runs
a from-scratch TypeScript statevector simulator with zero dependencies.

The part this sub will care about: the simulator is pinned against Qiskit and
PennyLane by a cross-check test. A Python script runs the same circuits
through Aer and PennyLane and emits fixtures; the TypeScript test suite
asserts my amplitudes match. Qubit 0 is the LSB, labels print MSB-first, so
histogram keys line up with Qiskit's display convention. Bell state: exactly
50/50 on |00⟩/|11⟩, entanglement entropy 1.0 (computed from the reduced
density matrix, shown live in the inspector). Two-qubit Grover: |11⟩ with
probability 1.0. Teleportation, QASM round-tripping, and a pile of randomized
adversarial properties are all CI assertions.

Building it this way caught two errors in my own content that I'd have
otherwise shipped:

1. **The Bell-state answer was wrong about bases.** It claimed the two qubits
   are perfectly correlated "in every measurement basis you can choose in a
   matched way." False for Y: (Y⊗Y)|Φ+⟩ = −|Φ+⟩, so ⟨YY⟩ = −1 and matched Y
   measurements always disagree — which follows from YY = −XX·ZZ. Not
   pedantry: that sign pattern is what a Bell test measures, and stating it
   wrong makes "they were secretly labelled all along" look viable.

2. **The barren-plateau demo showed a plateau that wasn't there.** The first
   version of the ansatz was RY + CZ only. Starting from |0…0⟩ that produces
   only real amplitudes, so the sampled ensemble lives in SO(2ⁿ) and can't
   approach a unitary 2-design at any depth — the hypothesis the
   barren-plateau result rests on. Measured over 2500 samples per width,
   Var[∂E/∂θ] fell as ≈ n^−1.04 — a power law, not exponential concentration;
   most of the visible collapse was the 1/n² of a per-site normalization.
   Adding the RX sublayer gives the real thing: ×0.65 per qubit, genuinely
   exponential. The gradient is taken by the parameter-shift rule, not finite
   differences, precisely because the claim is that the number gets tiny and
   a finite-difference estimate would end up measuring its own truncation
   error.

Both write-ups live in the repo, in the open, next to the code they correct.

Please fact-check it. That's not a rhetorical flourish — the entire premise
is that the sims are checkable, so if you can produce a circuit where my
amplitudes disagree with Aer, or a place where the prose states the physics
wrong, I want the reproduction and I'll credit the fix.

Free tier is the whole foundations track — simulator, all visualizations, 22
challenges — permanently, no account. MIT licensed. There's a paid advanced
track (Shor, QEC, VQE/NISQ) and real hardware submission (IBM/Braket/Azure)
behind a quota-checked proxy; that path is newer and has fewer miles on it,
which I'd rather say here than have you discover.

**First comment (FAQ):**

**Is this a real simulator or a lookup table?** Real. 2ⁿ complex amplitudes
in a flat Float64Array, every standard gate plus controlled gates, SWAP,
Toffoli, measurement collapse, seeded shot sampling, OpenQASM 3 import/export
with exact π fractions. Free tier simulates 5 qubits, paid tiers 12–16.

**Why write yet another simulator instead of compiling Qiskit to WASM?** Load
time and pedagogy. The module is small, dependency-free, and readable — it's
course material as much as infrastructure. The cross-check test is the
insurance that "readable" didn't come at the price of "wrong."

**What's under the tunneling sim?** Direct integration of the time-dependent
Schrödinger equation with absorbing boundary conditions. The page reports the
measured transmission next to the analytic e^(−2κw) estimate so you can see
them agree — and see where the thin-barrier approximation starts to strain.

**Does the AI tutor hallucinate?** It's three tiers and the UI names the one
that answered: a tool-calling agent that runs circuits to check its own
answers, a direct model call, and a fixed offline answer set that works with
no API key. The offline set is where the Bell-basis error above was found —
by an eval harness, before a user hit it.

**Can my agent use the simulator?** Yes — there's an MCP server (Streamable
HTTP) exposing circuit execution, per-step statevectors, challenge
generation/grading, lesson content, and notebook export (runnable
Qiskit/PennyLane .ipynb).

**Roadmap?** Deeper QEC content (there's already a surface-code sim and a
repetition-code decoder duel where a neural decoder trains in your browser),
and hardware submission over MCP. Suggestions welcome.

---

## Post 2 — physics educators community

**Title:** I built a free set of live quantum simulations for teaching — no accounts, no tracking, and student progress stays on the student's device

**Body:**

I teach quantum concepts the way I wish I'd been taught them: by handing
someone the actual system and letting them break it. Quantum Lab is the
result — 12 interactive simulations, each computing its physics in the
browser in real time, wrapped in a free 7-lesson foundations course with
inline quizzes.

What's in the free tier, permanently, with no account: the double-slit
experiment (single-particle mode, a which-path detector toggle that destroys
the fringes, live fringe-spacing readout), a draggable Bloch sphere, an
entanglement lab where students measure each qubit themselves and tally 500
pairs, quantum tunneling with live Schrödinger integration, Grover's search,
QFT, decoherence, and a drag-and-drop circuit simulator with a state
inspector. Plus 30 circuit challenges with staged hints and par scores.

Why an educator might care specifically:

- **The misconceptions are targeted, not repeated.** The course never says a
  qubit is "0 and 1 at the same time" (it teaches amplitudes and definite
  superposed states instead), never implies entanglement sends signals (the
  sim shows each side's marginal is a fair coin — the correlation only
  appears when the tally sheets meet), and never lets "measurement is magic"
  stand (the double-slit page explains which-path information, not detector
  nudges).
- **Classroom tooling exists.** With a Team/University licence you can
  publish assignments (any ordered list of lessons, challenges, exams with a
  due date), watch completion, and export a CSV for your gradebook.
- **The privacy stance is unusual and deliberate.** There is no analytics
  vendor, no pixel, no fingerprinting, and no tracking cookie anywhere in the
  app. Progress lives in the student's browser. A student's progress reaches
  their instructor only through an explicit, revocable, per-student opt-in —
  the coursework page asks them, it isn't defaulted on. If your institution
  has a review process for student-data tools, the entire data-flow
  documentation is public and short, because there's very little flow to
  document.
- **It's checkable.** The circuit engine is cross-validated against Qiskit
  and PennyLane in CI, and the numbers on screen (entanglement entropy,
  transmission coefficients, fringe spacing) are computed, not illustrated —
  so a student who asks "is this real?" can be answered with "yes, and here's
  the test."

The free foundations tier is the whole teaching core and will stay free.
Paid tiers exist (an advanced track — Shor, error correction, VQE — larger
simulators, and real hardware submission), but nothing above assumes them.

**First comment (FAQ):**

**What level is it pitched at?** The foundations track assumes no linear
algebra beyond "vectors have components" and builds amplitudes from the
double-slit up. The advanced track assumes comfort with matrices. Several
lessons have a per-section "explain this differently" toggle (simpler / more
mathematical).

**Does it work on school hardware/networks?** It's a website; the free tier
needs no account, no install, and no third-party scripts, so it tends to pass
strict school filters. It's a PWA with an offline fallback. It's designed for
laptops — it works on phones, but the circuit editor wants horizontal room.

**Can I embed a simulation in my own course page?** Yes — there's an
unauthenticated, locally-simulating circuit widget for third-party pages, and
share links carry the whole circuit in the URL, so you can link students
directly to a prepared circuit.

**What does a licence cost / what's actually gated?** The seven foundation
lessons, all 12 visualizations, the simulator (up to 5 qubits) and all
challenges are free forever. Licences add the advanced lessons, bigger
circuits, hardware access, and the assignment/gradebook tooling. One licence
is one cohort — a department running four classes can't yet separate them,
which is a documented limitation, not a surprise.

**Is there a certificate?** Two timed, server-graded exams with per-question
review and publicly verifiable certificates at a /verify URL.
