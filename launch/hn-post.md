# Show HN post

<!--
Written against the repo at the time of writing. Every claim below was checked
against code before it went in: the viz catalogue is lib/visualizations.ts (12
entries), the simulator is apps/web/lib/quantum.ts (zero-dependency, cross-
checked against Qiskit and PennyLane via lib/quantum.crosscheck.test.ts), the
MCP server is lib/mcp/server.ts + docs/MCP.md, the challenge generator's
verified-by-execution property is lib/challenges/generate.ts, the privacy
stance is docs/ANALYTICS.md, and the Bell/barren-plateau corrections are
documented in docs/TUTOR.md and components/viz/vqe/landscape.ts. Re-verify
before posting if the tree has moved.
-->

**Title:** Show HN: Quantum Lab – learn quantum mechanics from simulations computed live in your browser

**Body:**

I built an interactive quantum mechanics course where nothing is a video or a
pre-rendered animation. The double-slit page computes its own interference
pattern and samples individual particle impacts from it. The tunneling page
integrates the time-dependent Schrödinger equation while you watch. The circuit
editor runs a statevector simulator I wrote from scratch in TypeScript — zero
dependencies, and a test suite that cross-checks its output against Qiskit and
PennyLane through shared fixtures, so if my gate conventions drift from theirs,
CI fails.

What's in it: 12 interactive visualizations (double-slit through Grover, QFT,
VQE, the surface code), a 14-lesson course, 30 circuit challenges plus a
generator that produces new ones — each generated challenge is verified
solvable by actually executing its reference solution before it's shown to
you — two server-graded exams, and an AI tutor that runs circuits to check its
own answers and tells you which of its three fallback tiers actually replied.

A few decisions I'd defend:

*The physics is tested, not asserted.* A Bell state gives exactly 50/50 on
|00⟩ and |11⟩ with entanglement entropy 1.0, two-qubit Grover finds |11⟩ with
probability 1.0, teleportation moves an RY(π/3) state — these are vitest
assertions, not marketing copy. Building this way caught real errors in my own
content. The tutor's Bell-state answer originally said the qubits are perfectly
correlated in every matched basis; false for Y, where matched measurements
always disagree (⟨YY⟩ = −1 on |Φ+⟩), and that sign pattern is exactly what a
Bell test measures. The barren-plateau panel was worse: the first ansatz was
RY + CZ only, which produces only real amplitudes, so the ensemble can't
approach a 2-design and the "plateau" it showed was mostly the 1/n² of a
normalization, not physics. Measured, found to be a power law instead of an
exponential, fixed. Both corrections are written up in the repo rather than
quietly patched.

*The prose hunts misconceptions instead of repeating them.* No "0 and 1 at the
same time" — a superposed qubit is in one definite state, it's just not either
of the two you expected. No faster-than-light anything — each side of a Bell
pair sees pure noise until the result lists are compared over an ordinary
channel. No "tries every answer simultaneously" — Grover is a rotation you
must stop at the right moment, and the sim lets you over-rotate and watch the
answer get worse.

*Local-first by default.* No analytics vendor, no pixel, no fingerprinting.
Progress and usage events live in localStorage; the insights page computes
every number in your browser; export and delete buttons are one click. The one
cookie in the app is an httpOnly exam-resume identity, documented as such.

*An MCP server.* The simulator, challenge grader, challenge generator, lesson
content and notebook export are exposed over Streamable HTTP, so Claude,
Cursor or any MCP client can run QASM, inspect per-step statevectors, and
grade circuits with the same engine the site uses.

Honest state: the foundations track — seven lessons, the simulator, all the
visualizations, the challenges — is free, permanently, no account. There's a
paid advanced track and Pro tiers (bigger simulators, real hardware submission
to IBM/Braket/Azure through an entitlement-checked proxy); that side is the
newest and least battle-tested part, and the hardware path in particular has
had far fewer miles put on it than the free product. The stack is Next.js,
a FastAPI execution service, and a LangChain agent; MIT licensed.

What I'd love feedback on: (1) whether the "no both-at-once" framing of
superposition actually lands for people meeting it for the first time, or just
trades one confusion for another; (2) the statevector simulator's API — qubit 0
is the LSB with MSB-first labels to match Qiskit's display convention, and I'm
curious whether that reads as sane or cursed; (3) anything the physics gets
wrong. The whole premise is that the sims are checkable, so if you can produce
a state where the numbers are off, I want the reproduction.
