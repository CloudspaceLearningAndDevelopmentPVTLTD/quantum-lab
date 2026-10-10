# Social posts — advanced simulations and developer tools

<!--
Seven posts, seven assets. Claims verified against this tree before writing:

  Wigner     — src/wigner.html computes W for the cat state from
               W = N[e^-(x-x0)^2-p^2 + e^-(x+x0)^2-p^2 + 2 e^-x^2-p^2 cos(2 x0 p)],
               alpha = 2. min W = -0.238 and the 18.9% negative weight are
               measured on a 1400x1400 grid at load.
  Orbitals   — exact R_nl and real Y_lm; <r> printed per frame lands on
               (1/2)(3n^2 - l(l+1)): 5.0, 12.5, 10.5, 18.0 a0.
  Workbench  — ten tools, kinds and copy from lib/workbench.ts; per-kind
               counts (2/2/1/3/2) are that array grouped.
  MCP        — seventeen tools: twelve in lib/mcp/server.ts plus the five in
               lib/workbench/toolNames.ts. Endpoint and transport: docs/MCP.md.
  Bell       — E(a,b) = -cos 2(a-b) for the singlet; S peaks at 2 sqrt 2 =
               2.828 with Bob at 22.5/67.5 deg. Exact, no sampling.
  Grover     — a_k = sin((2k+1) theta), sin theta = 1/sqrt(256). k_opt = 12,
               P = 99.996%; brute force (N+1)/2 = 128. Closed form.
  Papers     — thirteen entries in lib/workbench/papers.ts, 1969 to 2024.
               CORRECTION: an earlier draft of this file said 1984-2024. The
               earliest entry is CHSH 1969. The 2024 Google entry's own source
               comment states the simplified model CANNOT reproduce its
               Lambda = 2.14 and checks only the monotonic suppression — post 7
               leads with that rather than hiding it.

Re-check every number if the tree has moved. Assets in ./assets, the pages
that render them in ./src — re-render with src/render.mjs.
-->

Assets live in [`assets/`](assets). Each post names the file to attach.

| # | Post | Kind | Asset | Size |
| --- | --- | --- | --- | --- |
| 1 | Wigner negativity | Simulation | `01-wigner-negativity-640.gif` / `-800` | 2.2 / 3.7 MB |
| 2 | Hydrogen orbitals | Simulation | `02-hydrogen-orbitals-640.gif` / `-800` | 2.9 / 5.2 MB |
| 3 | The workbench | Dev tools | `03-workbench-rail-800.gif` | 1.3 MB |
| 4 | The MCP server | Dev tools | `04-mcp-endpoint-800.gif` | 0.3 MB |
| 5 | Bell / Tsirelson | Simulation | `05-bell-tsirelson-800.gif` | 0.5 MB |
| 6 | Grover overshoot | Simulation | `06-grover-overshoot-800.gif` | 0.3 MB |
| 7 | Run this paper | Dev tools | `07-run-this-paper-800.gif` | 0.5 MB |

LinkedIn rejects images over 5 MB, so posts 1 and 2 use the 640 px cut there;
everything else fits at 800. A `-cover.png` still sits beside each GIF.

Interactive versions, good as a first comment:

- Workbench — https://claude.ai/artifact/RsdACE3v1AymniE6dRkGiZ
- MCP endpoint — https://claude.ai/artifact/HQSqNRYvkXPk2TU7cBhsV1
- Bell test — https://claude.ai/artifact/WNzpLEVjQPQAThgAz7JsQx
- Grover — https://claude.ai/artifact/2jHtsvsxWfc8ktqmRXC2N9
- Run this paper — https://claude.ai/artifact/Xhd71pnGJDGwYfbxbXaVSZ

---

## Post 1 — Wigner negativity

**Attach:** `assets/01-wigner-negativity-640.gif`

A probability distribution is never negative. This one is.

That is the Wigner function of a Schrödinger-cat state — one superposition of
two coherent states — turning through a single period of its own harmonic
evolution. Gold is positive. Ice is below zero. The minimum sits at −0.238, and
18.9% of the landscape's total weight is under the floor.

The strip along the bottom is the part a detector can actually see: the state
projected onto one quadrature. Turn the detector and the same state reads as
two separate lumps at 0° and as an interference comb at 90°. Both of those are
ordinary, non-negative probability distributions. The landscape they are
shadows of is not — and that is the piece no classical model reproduces.

Nothing here is a rendered video. Every frame recomputes W on a 320×320 grid in
the browser, and the readouts are measured off the same grid.

Free, no account, no API key: qubit16.ai/visualizations/wigner-function

#QuantumComputing #Physics #DataVisualization #QuantumOptics

---

## Post 2 — Hydrogen orbitals

**Attach:** `assets/02-hydrogen-orbitals-640.gif`

An electron in a hydrogen atom does not go around anything.

Half a million points sampled from |ψ|² for four exact orbitals — 2p_z, 3p_z,
3d_xy, 4f_z³. Gold where ψ is positive, ice where ψ is negative, and the sign
is the half that |ψ|² throws away and chemistry then spends its whole career
on.

Watch 3p_z, the second one. There is a small pair of lobes sitting inside a
large pair, and the colours are swapped. That is a radial node: a sphere where
the wavefunction passes through zero, so the electron is never found there —
not because it crosses quickly, but because the amplitude is exactly nothing.

The mean-radius readout is computed from the points on screen, and it lands on
5.0, 12.5, 10.5 and 18.0 Bohr radii. That is ½(3n² − l(l+1)) — the textbook
result, recovered by counting dots.

Free, no account: qubit16.ai/visualizations/wavefunctions-3d

#Quantum #Chemistry #Physics #ScientificVisualization

---

## Post 3 — Ten AI tools for quantum developers

**Attach:** `assets/03-workbench-rail-800.gif`
**First comment:** https://claude.ai/artifact/RsdACE3v1AymniE6dRkGiZ

We shipped ten AI tools for quantum developers, and not one of them teaches you
anything.

That is deliberate. The visualizations on Qubit16 exist to be learned from. The
workbench exists to hand you a result you can keep, and it runs the same
from-scratch statevector simulator everything else on the site runs on.

**Generate** — Verified circuit generation: you write a spec (target histogram,
state or unitary, plus gate-set and depth limits), the model proposes OpenQASM,
an exact checker rejects it, and the rejection goes back in. Every failed
attempt stays on the record. Alongside it, an evolutionary loop that scores
MaxCut heuristics against the simulator and keeps the lineage of every survivor.

**Train** — Decoder Lab: a lookup table, an MLP and a transformer you train in
your own browser, racing exact MWPM at distance 3, 5 and 7. That is AlphaQubit
(Nature, 2024) at a scale you can actually watch. And a calibration agent
holding a drifting X gate above 99.5% fidelity from measurement counts alone.

**Optimise** — Routing Race: your circuit mapped onto a real coupling map twice,
by SABRE and by an eight-weight REINFORCE swap policy, with two-qubit count,
depth and added SWAPs side by side. IBM reported 24% and 36% over the default
heuristic on 100+ qubit circuits; this is that idea at 8–12 qubits.

**Run** — an experiment runner your agent writes into over MCP, a CPU-vs-GPU
statevector benchmark, and thirteen landmark papers from 1969 to 2024 executed
live and checked against the number each one published.

**Measure** — zero-noise extrapolation and readout mitigation with error bars,
and a QML reality check that prints a variational classifier's held-out accuracy
next to a tuned logistic regression's, with the training cost of each.

That last one is the tool I would start with. It is the one most likely to talk
you out of something.

All of it runs in the browser. No key, no account, no Python.

qubit16.ai/workbench

#QuantumComputing #AI #MachineLearning #DeveloperTools

---

## Post 4 — The MCP server

**Attach:** `assets/04-mcp-endpoint-800.gif`
**First comment:** https://claude.ai/artifact/HQSqNRYvkXPk2TU7cBhsV1

Your coding agent can run a quantum circuit without you.

Qubit16 speaks the Model Context Protocol, so Claude Code, Claude Desktop,
Cursor or anything else that speaks MCP gets seventeen tools over one endpoint —
the same engines and the same gates the web app uses.

Eleven core tools: run a circuit, halt mid-circuit and read the statevector back
(no hardware will ever do that for you), list and grade challenges, generate new
ones, read the free course, build a study plan, export a runnable notebook, and
— with a bearer token — submit to real hardware. One more runs the
generate → verify → repair loop against a spec. Five more let an agent open an
experiment record, run its steps, and write its own conclusion, which
/workbench/experiments then renders for you to audit.

The transport is the part I am quietest about and happiest with: stateless JSON
over a single POST, no SDK dependency, about 150 lines. GET returns 405, which
the spec defines as "no server-initiated stream offered". The registry is shaped
so it can be re-hosted on the official server the day it needs OAuth or
resumable streams.

    claude mcp add --transport http qubit16 https://qubit16.ai/api/mcp/mcp

Then ask your agent for a Bell state and watch it check its own answer.

qubit16.ai · docs/MCP.md

#MCP #AI #QuantumComputing #Agents #DeveloperTools

---

## Post 5 — Bell test: the number is 2.828

**Attach:** `assets/05-bell-tsirelson-800.gif`
**First comment:** https://claude.ai/artifact/WNzpLEVjQPQAThgAz7JsQx

Every theory in which the world has definite properties before you look is
bound by one number: 2.

That is the CHSH inequality. Take four correlation measurements on a pair of
particles, combine them as S = |E₁ − E₂ + E₃ + E₄|, and *any* local
hidden-variable account of the universe — however clever, however contrived —
gives you S ≤ 2. It is not a statement about apparatus. It is arithmetic about
what "the properties were already there" can possibly produce.

Quantum mechanics gives 2.828.

The animation sweeps Bob's analyser while Alice holds at 0° and 45°, and the
correlation climbs through the classical ceiling at 22.5°, touches 2√2, and
falls away again. Nothing is sampled: E(a,b) = −cos 2(a−b) for the singlet, and
the four terms at the peak are exactly ∓0.707.

Two things worth sitting with. The violation is not marginal — it is 41% past
the bound, which is why the experiments were decisive once the loopholes closed.
And quantum mechanics does not run away to 4, the algebraic maximum. It stops at
2√2, the Tsirelson bound, and nobody has a fully satisfying story for why the
universe is *exactly this* non-local and no more.

Free, in your browser: qubit16.ai/visualizations/bell-test

#QuantumComputing #Physics #BellTest #QuantumFoundations

---

## Post 6 — Grover, and the overshoot nobody shows you

**Attach:** `assets/06-grover-overshoot-800.gif`
**First comment:** https://claude.ai/artifact/2jHtsvsxWfc8ktqmRXC2N9

Grover's algorithm finds one item in 256 after 12 queries. Run it a thirteenth
time and it starts losing the answer.

Everyone teaches the first half: amplitude amplification, √N instead of N, 12
queries against the 128 a classical search expects. The half that gets left out
is that each iteration is a *rotation*, and rotations do not stop when they
arrive. Past the optimum the amplitude keeps turning — through the peak, back
down, and at step 25 the marked item is almost exactly as hidden as it was
before you started.

Which means Grover is not "run it until you find it". It is "run it exactly
⌊π/4 × √N⌋ times and then stop", and knowing N matters. If you do not know how
many marked items there are, you do not know when to stop — which is a real
problem with a real fix (quantum counting), and one of the many places where the
speed-up is narrower than the headline.

The bars are exact amplitudes, not samples: a_k = sin((2k+1)θ) with sin θ =
1/√256. Watch the sea of 255 unmarked states dip below zero on the way back
down.

Free, no install: qubit16.ai/visualizations/grover

#QuantumComputing #Algorithms #Grover #Physics

---

## Post 7 — Thirteen papers, run live

**Attach:** `assets/07-run-this-paper-800.gif`
**First comment:** https://claude.ai/artifact/Xhd71pnGJDGwYfbxbXaVSZ

Thirteen landmark quantum papers, each one executable in a browser tab.

From CHSH in 1969 to Google's below-threshold error correction in 2024 — not a
summary of the paper, the paper's own protocol.

Each one runs on the site's own simulator and is checked against the number it
published:

· **CHSH 1969** — bound S ≤ 2. We compute 2.828.
· **BB84 1984** — an intercept-resend attack should force ≈25% QBER. We measure
25% over 4,000 shots, with a clean channel as the control.
· **Grover 1996** — O(√N). One item in 256 in 12 queries against 128.
· **Teleportation 1993** — fidelity 1 once the two classical bits arrive.

And then there is the fourth card in that animation, which is the reason I am
posting this one.

**Google 2024** reported a logical error rate falling by Λ = 2.14 ± 0.02 per
step in code distance, reaching 0.143% per cycle at d = 7. Our page does **not**
reproduce that number, and says so on screen. The simplified surface-code model
behind it has its own ~10% threshold and a different noise model — uncorrelated,
not circuit-level, no repeated faulty syndrome rounds. What it honestly
reproduces is the qualitative signature the paper was first to demonstrate on
hardware: strictly monotonic suppression as distance grows.

That caveat is written into the source, not bolted on afterwards. I would rather
ship a tool that tells you where its model runs out than one that prints a
confident number it has not earned — and if you are evaluating anyone's quantum
demo, including ours, "what does this *not* reproduce" is the question worth
asking first.

qubit16.ai/workbench/run-paper

#QuantumComputing #QuantumErrorCorrection #OpenScience #Research

---

## Re-rendering the assets

```bash
cd launch/social/src
node render.mjs wigner.html    ../assets/01-wigner-negativity-800.gif  800 800 60 66
node render.mjs orbitals.html  ../assets/02-hydrogen-orbitals-800.gif  800 800 64 66
node render.mjs workbench.html ../assets/03-workbench-rail-800.gif     800 800 100 110
node render.mjs mcp.html       ../assets/04-mcp-endpoint-800.gif       800 800 90 110
node render.mjs bell.html      ../assets/05-bell-tsirelson-800.gif     800 800 72 70
node render.mjs grover.html    ../assets/06-grover-overshoot-800.gif   800 800 26 170
node render.mjs papers.html    ../assets/07-run-this-paper-800.gif     800 800 4 3000
```

`render.mjs` drives each page's `window.frame(k, total)` in headless Chromium,
screenshots every frame and stacks them into one animated GIF with sharp. A
seventh argument downscales on the way out — that is how the 640 px cuts are
made. Both dependencies are already in the repo's `node_modules` (Playwright for
the e2e suite, sharp via Next).

Two traps worth knowing if you edit these pages:

- `sharp`'s `.gif({ delay })` only applies a scalar to the **first** frame.
  `render.mjs` passes `Array(N).fill(delay)`; without it every frame after the
  first gets a 0 ms delay and the GIF plays at whatever speed the viewer picks.
- Do not name the per-frame function `frame` in a page. A top-level
  `function frame(){}` becomes `window.frame`, which the exporter then overwrites
  with a wrapper that calls `frame(...)` — i.e. itself. The pages use
  `drawFrame` / `render` for exactly this reason.

## Modern-CSS baseline

All seven pages share it, checked against `modern-web-guidance`:

- Gradients interpolate `in oklab`, so brand ramps (violet → teal → amber) pass
  through saturated mid-tones instead of the grey sRGB gives you.
- `text-wrap: balance` on headlines, `text-wrap: pretty` on body copy —
  deliberately, not on `*`, which carries a cost.
- `contain: layout style paint` on the repainting stage.
- Every page holds still under `prefers-reduced-motion: reduce`.
