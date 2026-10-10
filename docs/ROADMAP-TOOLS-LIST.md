# Roadmap — becoming the strongest entry on the QCR Tools list

Written 18 September 2026 against <https://quantumcomputingreport.com/tools/>.
Every "we lack it" below was checked against the code, not against the older
plan docs. Every competitor claim was checked against the competitor's live
site or repository on the same day; anything that could not be confirmed is
marked UNVERIFIED.

`docs/PLAN-BEST-IN-CLASS.md` and `docs/COMPETITIVE-GAPS.md` are **stale**: the
provider, reconciler, run comparison, sweeps, recommender, permalinks, spend
controls and resource estimator they list as open have all shipped.
`docs/HANDOFF.md` is the accurate operational state. This file supersedes the
"what next" sections of the other two.

---

## 1. What "no. 1" can honestly mean

**The list is not ranked.** It is a flat, editorially ordered page of ~74
tools with no scores, no dates and no submission form. Qubit16 is already on
it (anchor `#QUBIT16`, roughly 16th in page order, between Coda and QFlow
Studio). There is no first place to win by position.

So the goal is restated as three things that *are* achievable and measurable:

1. **Capability:** no other single entry on the list covers as much of what
   the list as a whole covers. (§3, §4)
2. **Proof:** the claims are verified on real hardware and published — a
   benchmark, a paper, package downloads, stars. (§5)
3. **Visibility:** the entry text, and ideally a QCR news item, say so. (§6)

Of the 74 entries, roughly a third are dead or archived (Paddle Quantum,
ScaffCC/TriQ, FermiLib, OpenFermion-Cirq, QCircuits, PyQLab/Qlab, qbsolv,
Strawberry Fields, XACC, LIQUi|>, Google Playground, the Alibaba and Bristol
cloud services). Nothing should be built to match those.

## 2. Who the real competition on the list is

| Tool | Why it matters | Where it beats us today |
|---|---|---|
| **Coda** (Conductor Quantum) | Natural language → verified QPU run; MCP server; 5 hardware vendors; GPU sim to 29–34 qubits; QPU leaderboard; transpiles across 6 SDKs | More vendors (AQT, IQM), bigger simulation, SDK transpilation, leaderboard |
| **QFlow Studio** | Two-way code↔canvas sync with op-level tracing; versioned "run records"; preflight + approval; AI edits as diffs; Stim/qsim/Aer | Two-way sync, reviewable AI diffs, Stim, Cirq |
| **Quirk** | The editor everyone measures against; 1.1k stars; frozen since 2022 | Drag-and-drop, undo/redo, custom gates from circuit slices, X/Y-basis controls, postselection |
| **IBM Composer** | Step debugger, editable QASM beside the diagram, SVG/PNG export | Live editable QASM pane, circuit image export |
| **Quantum Programming Studio** | Widest code-export matrix on the list (Quil, Q#, TFQ, CUDA-Q, Braket, Cirq…) | Code export breadth; npm simulator library |
| **PsiQuantum Circuit Designer** | Publication-quality diagrams, collapsible subroutines, LaTeX labels | Diagram export; hierarchical routines |
| **MQT** | QCEC equivalence checking, Bench, Predictor, DDSIM, QECC | Equivalence checking, benchmark library, DD simulation |
| **Mitiq** | ZNE, PEC, CDR, DDD, REM, LRE, twirling | We have ZNE + readout only |
| **Metriq** | Public reproducible cross-device benchmark | We have no quantum benchmark at all |
| **QCR (Circuit Repository)** | Citable versioned IDs, auto-translation across 6 frameworks | Community gallery; framework translation |

What nobody on the list combines, and we already have: 40 live physics
simulations + a graded course + certification + multi-vendor hardware with
BYOK + a Qiskit provider + resource estimation + an MCP server + an on-device
LLM tutor + run-this-paper + offline PWA/Android. **The breadth lead is real.
The gaps are depth gaps in the editor, interop, and proof.**

---

## 3. Missing implementations — verified against code

Effort: S ≤ 2 days, M ≤ 1 week, L > 1 week. "Who has it" names list entries.

### 3.1 Circuit editor (the first thing every visitor touches)

| # | Missing | Who has it | Evidence it is missing | Effort |
|---|---|---|---|---|
| E1 | **Drag-and-drop placement, move, insert-in-middle** | Quirk, IBM, Qniverse, QFlow | `components/circuit/CircuitGrid.tsx` has no drag handlers; click-to-place only | M |
| E2 | **Undo / redo** | Quirk, IBM | no undo stack anywhere in `components/circuit` | S |
| E3 | **Live two-way QASM ↔ diagram editor** | IBM, QFlow | `app/simulator/page.tsx:545-583` is a read-only pane plus a one-shot import textarea | M |
| E4 | **Circuit image export: SVG, PNG, LaTeX (quantikz)** | IBM, PsiQuantum, QPS | no emitter; only certificate/OG images render | S |
| E5 | `RESET`, `U3`/`U`, native iSWAP / √SWAP / ECR, **generic controlled-anything**, X/Y-basis controls | Quirk, IBM, QPS | `lib/quantum.ts:73-197`; controls exist only for X/Y/Z/SWAP/blocks | M |
| E6 | Custom gate from a **circuit slice** / collapsible named subroutine | Quirk, IBM, PsiQuantum | `UNITARY` takes a pasted matrix only | M |
| E7 | Algorithm **presets in the simulator**: Deutsch–Jozsa, Bernstein–Vazirani, Simon, QFT, QPE, HHL, VQE, QAOA ansätze | IBM, QPS, Qniverse | `PRESETS` has 9; the rest exist only as visualisation pages | S |
| E8 | Postselection, multiple initial states per wire | Quirk | not present | S |

### 3.2 Interoperability (the cheapest route to "most complete entry")

| # | Missing | Who defines it | Approach | Effort |
|---|---|---|---|---|
| I1 | **Code export: Cirq, Q#, CUDA-Q, Braket, Quil, OpenQASM 2** (have: QASM 3, Qiskit/PennyLane `.ipynb`) | QPS, staq, qBraid, Coda | TS emitters off the existing IR, next to `lib/export/notebook.ts` | S–M |
| I2 | **Code import** from Qiskit / Cirq / PennyLane / Quil | QPS, QFlow | server-side → OpenQASM 3 in `services/api` | S |
| I3 | **QIR export** | QDK, CUDA-Q | server-side PyQIR, base profile | M |
| I4 | **Stim import/export** for the decoder lab | Stim, CUDA-QX, MQT QECC | `.stim` + detector error model; PyMatching server-side | M |
| I5 | **npm package** for the simulator (`lib/quantum.ts` is already zero-dependency) | QPS `quantum-circuit` | extract to `packages/qubit16-js` | M |
| I6 | CLI + checked-in **OpenAPI spec** for the Python package | — | `[project.scripts]` is absent in `pyproject.toml` | S |

### 3.3 Simulation methods

| # | Missing | Who has it | Approach | Effort |
|---|---|---|---|---|
| S1 | **Stabilizer / Clifford** simulator | Stim, Aer, QFlow | browser tableau sim (hundreds of qubits) — a genuine browser first | M |
| S2 | **MPS / tensor-network** and DD methods on the server path | Aer, MQT DDSIM, Qniverse | method selector on the existing Aer backend | S |
| S3 | Server simulation **above 16 qubits** exposed to users | Coda (34), QFlow (31), Qniverse | lift the plan cap on the Aer path only; keep the browser at 16 | S |
| S4 | True **density-matrix** evolution + custom noise-channel editor | Aer, QuTiP, Atos QLM | today noise is trajectory-based with fixed channels (`lib/quantum/noise.ts`) | M |
| S5 | **Open-system (Lindblad) dynamics** lab | QuTiP | 1–3 qubit browser solver; pairs with the decoherence viz | M |

### 3.4 Compilation and verification

| # | Missing | Who has it | Approach | Effort |
|---|---|---|---|---|
| C1 | **Circuit-vs-circuit equivalence checking** | MQT QCEC | `lib/workbench/verify.ts` is circuit-vs-spec only; add browser unitary compare ≤ 10q + server QCEC | S |
| C2 | **ZX-calculus** optimisation + diagram view | PyZX, QCEC | server `full_reduce`, render the spider graph | M |
| C3 | In-browser **optimisation passes** (cancellation, commutation, rotation merge) | Qiskit, BQSKit, staq | today only SABRE routing runs client-side | M |
| C4 | **Synthesis** from a unitary | BQSKit | async server job, ≤ 6 qubits | M |

### 3.5 Error mitigation and QEC

| # | Missing | Who has it | Effort |
|---|---|---|---|
| M1 | **Pauli twirling, DDD, REM** via Mitiq on the hardware path | Mitiq | S–M |
| M2 | **PEC, CDR, LRE** | Mitiq | M |
| M3 | Gate twirling (`enable_gates`) on IBM — already noted open in COMPETITIVE-GAPS §3.5 | IBM runtime | S |
| M4 | Named DD sequences (CPMG, UDD, XY8) | Q-CTRL Open Controls | S |
| Q1 | More codes: **repetition (in the lab), Steane, colour**, d = 7 | Error Correction Zoo, MQT QECC | M |
| Q2 | **Union-find decoder** | — | S |
| Q3 | Deep links from each code/algorithm to the **EC Zoo / Algorithm Zoo** entry | both Zoos | S |

### 3.6 Benchmarks — currently zero

| # | Missing | Who has it | Approach | Effort |
|---|---|---|---|---|
| B1 | **Any quantum benchmark.** `/benchmark` is an AI-agent benchmark and renders empty | Metriq, Coda leaderboard | GHZ ladder, mirror circuits, QV, RB across reachable devices; publish raw data | M + QPU cost |
| B2 | **MQT Bench** circuit library as loadable presets | MQT Bench (MIT) | pre-generate QASM, ship static, credit the source | S |
| B3 | **Metriq-gym**-compatible results | Metriq | schema-valid JSON; submission is by PR (no API evident — UNVERIFIED) | M |
| B4 | **Simulator benchmark**: our statevector vs Aer vs Quirk, gates/sec, correctness | — | cheap, publishable, feeds §5 | S |

### 3.7 Applications

| # | Missing | Who has it | Effort |
|---|---|---|---|
| A1 | **Chemistry:** molecule → qubit Hamiltonian (Jordan–Wigner) → VQE | OpenFermion, Tequila | M |
| A2 | **Pauli-sum observable UI** (API-only today) | IBM | S |
| A3 | **QUBO / annealing** editor feeding QAOA + simulated annealing | D-Wave Ocean | M |
| A4 | **Photonic** lab (boson sampling, linear optics) | Perceval | L — low priority |
| A5 | **Pulse-level** teaching lab (simulated transmon; OpenPulse export). Qiskit Pulse and Qiskit Dynamics are both dead — do not target them | Quantify, QGL, Quil-T | L — low priority |
| A6 | Resource-estimator **cross-architecture comparison view** | GQI's own tool (list entry #1) | S–M |

### 3.8 Hardware reach

| # | Missing | Who has it | Effort |
|---|---|---|---|
| H1 | More vendors: **IQM, AQT, Quantinuum-direct, Quantum Inspire (free EU hardware)** | Coda, Quantum Inspire | M each |
| H2 | **Public QPU leaderboard** fed by B1 | Coda, Metriq | S after B1 |
| H3 | Public per-shot **price table** page | Coda, qBraid | S |
| H4 | Confirm whether the calibration snapshot is captured per job. `migrations/…_runs.sql` has a `calibration jsonb` column; `HANDOFF.md` §7 says it is not captured. One of them is wrong | — | S |

### 3.9 Platform and community

| # | Missing | Who has it | Effort |
|---|---|---|---|
| P1 | **Public circuit gallery** with citable, versioned IDs | QCR, Quirk URLs | M |
| P2 | AI edits shown as **reviewable diffs** before apply | QFlow | S–M |
| P3 | **In-browser Python** (Pyodide) — run Qiskit-style code with no server | qBraid (hosted) | L |
| P4 | **i18n** — English only today | Qniverse, Quantum Inspire audiences | M |
| P5 | Real-time collaboration / comments | QFlow, PsiQuantum Construct | L — defer |

---

## 4. The roadmap

Ordered so each phase produces something that can be *shown*, because the
list entry and any news item are only as good as what a visitor can verify in
five minutes.

### Phase 0 — Make the existing claims true (this week, operator-only)

Nothing new should be announced before this. From `docs/HANDOFF.md`:

1. Run `supabase/verify-migrations.sql`; confirm `byok_exclusion_applied`.
2. `IBM_QUANTUM_TOKEN` + `hardware_smoke.py --submit` — **no job from this
   codebase has ever reached real hardware.**
3. Verify BYOK end to end; settle the **Braket bit order** with one
   known-answer circuit.
4. Set `HARDWARE_RECONCILE_SECRET` (+ 5-minute schedule) and Upstash.
5. **Publish `qubit16` to PyPI.**
6. Resolve H4. Rewrite the two stale strategy docs.

### Phase 1 — Out-Quirk Quirk (weeks 1–3)

The editor is the front door and Quirk has been frozen since 2022.

E2 undo/redo → E1 drag-and-drop → E3 live two-way QASM → E4 SVG/PNG/quantikz
export → E7 presets → E5 gate set → E8. Then C1 equivalence checking and B4
the simulator benchmark.

*Exit test:* everything Quirk's README lists can be done here, plus real
hardware. That sentence is the pitch.

### Phase 2 — The interop hub (weeks 3–6)

I1 exports (Cirq, Q#, CUDA-Q, Braket, Quil, QASM 2) → I2 imports → B2 MQT
Bench library → S2 + S3 MPS and > 16 qubits on the server → S1 browser
stabilizer sim → I6 CLI + OpenAPI → I5 npm package → I3 QIR.

*Exit test:* a circuit from any of the six major SDKs round-trips through
qubit16. Only Quantum Programming Studio comes close, and it has no hardware
path, course or estimator.

### Phase 3 — Research depth (weeks 6–10)

M1 → M3 → M4 → M2 (Mitiq suite) · I4 Stim + Q1/Q2 codes and union-find ·
C2 ZX · C3 passes · S4 density matrix · A2 observable UI · A1 chemistry ·
A6 estimator comparison · A3 QUBO.

### Phase 4 — Proof (weeks 8–14, overlaps Phase 3)

B1 public cross-vendor benchmark with raw data → H2 leaderboard → H3 price
table → B3 Metriq-compatible output → P1 gallery with citable IDs → H1 one
new vendor (Quantum Inspire first: free hardware, EU audience).

### Phase 5 — Later, only if asked

P3 Pyodide · P4 i18n · A4 photonic · A5 pulse · C4 synthesis · P5 realtime.

---

## 5. Signals that make "best entry" checkable

| Signal | Target | Comparison point |
|---|---|---|
| GitHub stars on the public MIT repo | 1,000+ | Quirk: 1.1k, unmaintained |
| QOSF `awesome-quantum-software` listing | PR after Phase 1 | only criterion is open source |
| **Qiskit ecosystem** membership | after PyPI publish | needs SDK v2 + V2 primitives + OSI licence — the provider already qualifies |
| PyPI + npm downloads | public badge | — |
| JOSS paper (simulator) + a physics-education paper (the 40 sims) | submit in Phase 4 | Quantum Flytrap's credibility rests on two papers |
| Unitary Foundation microgrant ($4k) + unitaryHACK 2027 project | apply after Phase 1 | brings UF blog coverage |
| Show HN led by one instantly playable sim | ~100 points | Quirk 97, Quantum Game 154, Quantum Country 257 |
| Named university course adoptions | 5–10 | qBraid cites "400+ universities" |
| Public usage counter | publish | Black Opal 26k learners, qBraid 20k users |

## 6. The list entry itself

There is no form; the contact is `info@quantumcomputingreport.com`. The
current blurb describes a teaching lab and omits the hardware path, BYOK, the
Qiskit provider, the estimator and the recommender entirely.

Send an updated blurb **after Phase 0 item 2 and the PyPI publish**, not
before — the hardware claim has to be true when an editor clicks it. Pitch a
news item with it after Phase 1 or Phase 4: QCR runs tool-release news, and an
article outweighs list position because the list has no positions.

## 7. What not to do

* Do not match dead tools. A third of the list is archived.
* Do not chase Coda's 34-qubit GPU simulation in the browser. Raise the
  *server* ceiling (S3); the browser stays at 16 per PLAN-BEST-IN-CLASS.
* Do not build hosted notebooks to match qBraid. The provider already lets a
  researcher use the notebook they have.
* Do not announce hardware support anywhere until a real job has run.
* Do not let a projected number lose its label — still the platform's main
  credibility asset, and the benchmark (B1) makes it matter more, not less.
