# Where qubit16 stands against the tools researchers actually use

Written to answer one question honestly: **if a working quantum engineer or
researcher opened qubit16.ai tomorrow, what would make them close the tab?**

This is not a marketing comparison. Every "we have it" below was checked
against the code, and every gap names the file that would have to change.
Where a competitor's capability is described, it is described at the level of
*what the tool lets you do*, not at the level of a version number — those move
faster than this document will.

---

## 1. Who we are actually competing with

Three different audiences, three different incumbents. Conflating them is how a
product ends up losing all three.

| Audience | What they use today | Why they would switch |
|---|---|---|
| **Students / self-learners** | Qiskit textbook, YouTube, Quirk | Nothing beats 40 interactive sims + a tutor + a graded path. **We win here already.** |
| **Educators** | Their own notebooks, IBM Quantum Lab | Seats, assignments, gradebook export, verifiable certificates. **We win here already.** |
| **Engineers / researchers** | Qiskit in a local Jupyter notebook, IBM Quantum Platform, Amazon Braket console, qBraid, PennyLane | **This is the audience we do not yet hold.** The rest of this document is about them. |

The single most important sentence in this file: **a researcher's alternative
is not another website, it is `pip install qiskit` and a local notebook.** Any
feature that is merely "as good as a notebook" is worth nothing. We have to be
better at something a notebook is bad at.

The three things a notebook is genuinely bad at, and which we are positioned to
own:

1. **Multi-vendor access behind one identity.** IBM, IonQ, Rigetti, Quantinuum
   each want their own account, their own credentials, their own billing. We
   already put all of them behind one sign-in, one quota and one bill.
2. **A durable, comparable record of runs.** A notebook's output cell is not a
   lab notebook. Ours now is (see §3.1).
3. **Reproducing published results at small scale.** `/workbench` already does
   this for AlphaQubit-style decoding, RL calibration, AI routing, ZNE, QAOA
   evolution — and nobody else does it at all.

---

## 2. What we already have that the incumbents do not

Stated first, because the gap list below is long and it is easy to read it as
"we have nothing".

* **`/workbench` has no equivalent anywhere.** Ten tools that each let you
  reproduce a recent published result at a scale that runs in a browser tab:
  a surface-code decoder race (lookup vs MLP vs transformer vs exact MWPM at
  d = 3/5/7), an RL calibration agent holding an X gate above 99.5% fidelity
  through drift, a routing race between SABRE and a policy you train in the
  page, ZNE and readout mitigation with error bars, and an honest
  QVC-vs-logistic-regression comparison. IBM, AWS and Azure all ship consoles
  for *their own hardware*; none ships a place to reproduce the literature.
* **Multi-vendor hardware behind one auth, quota and bill** — IBM, IonQ and
  Rigetti (Braket), Quantinuum and IonQ (Azure). qBraid and Strangeworks do
  this; the vendors themselves do not.
* **Cost estimation before submission**, per-vendor, with an explicit refusal
  to price what it cannot price (Quantinuum bills in H-System Credits at a
  customer-specific rate, and we say so rather than reporting `$0`).
* **A transpile preview against the real device** before spending anything.
* **40 interactive physics visualizations** with real integrators, not GIFs.
* **An MCP server**, so an agent can drive the simulator directly. Almost
  nobody in this space has one.
* **Live calibration data with an explicit provenance marker** — `live`,
  `static` (vendor-published typical values) or `unavailable`. Most consoles
  show you a number without telling you how old it is.

---

## 3. The gaps, in the order they cost us users

### 3.1 ~~Results were never stored~~ — CLOSED

**Was:** hardware job ids lived in `localStorage`, capped at twenty, holding an
id and a backend name. The measurement counts were fetched from the vendor on
each poll, rendered, and dropped. Close the tab and the run was gone; sign in
on a second machine and the history was empty; a job that finished overnight
was never collected, because the only thing that ever advanced a job's status
was an open browser tab.

For a teaching demo that is survivable. For this audience it is
disqualifying — the entire value of running on a QPU is the record of what came
back, and "check the vendor's console" means we added nothing to the vendor's
console.

**Now:** `public.hardware_usage` carries `status`, `counts`, `qasm`, `error`,
`qpu_seconds`, `optimization_level`, `transpiled_depth`,
`transpiled_two_qubit_gates` and `completed_at`. The job-status proxy writes
them as it observes each job, `GET /api/hardware/jobs` serves them, and
`components/hardware/JobHistory.tsx` renders them with CSV and JSON export.

**Residual, stated plainly:** a job nobody ever polls still has no recorded
status, because the poll is the only writer. §4.1 is the fix.

### 3.2 ~~There is no code path~~ — CLOSED

**Was:** a researcher writes Python, and the only ways into this platform were
a gate grid, a QASM textarea, and an MCP server aimed at agents rather than at
people. No user-issued API key, no REST surface a script could authenticate
against, no CLI, no `pip install`.

Everything else we built was therefore reachable only by hand — which is the
definition of a tool a researcher will not adopt, because it cannot go in a
loop, in a script, or in a paper's reproduction instructions.

**Now:** `public.api_keys` (SHA-256 hash only, prefixed `qb16_sk_`, revoked by
timestamp rather than deleted, `last_used_at` stamped off the request path),
`verifiedApiCaller` in `lib/security/auth.ts`, and `/api/hardware/*` accepting
either credential. `docs/API.md` is the surface.

Two decisions worth not undoing:

* **Key acceptance is OPT-IN PER ROUTE.** `verifiedCaller` and
  `verifiedCallerId` are unchanged and still take a session token only. Making
  *them* accept keys would have been one line and would have silently extended
  key authority to billing, the customer portal, org membership, exams and the
  platform console.
* **A key cannot mint a key.** `/api/keys` requires a session. If a key could
  issue a key, revocation would stop meaning anything — an attacker holding a
  leaked key issues a second one, and revoking the first leaves the second
  working.

**Still open:** a `pip install`-able SDK, and specifically a Qiskit-compatible
provider so existing Qiskit code runs against us unchanged. See
`docs/PLAN-BEST-IN-CLASS.md` §A1 — it is the highest-leverage item left on the
whole roadmap.

### 3.3 ~~Sampler only — no expectation values~~ — CLOSED

**Was:** `submit` ran `SamplerV2` and returned a bitstring histogram. That is
the right primitive for teaching and the wrong one for research — every
variational algorithm (VQE, QAOA, most of quantum chemistry, most of QML)
computes **⟨ψ|H|ψ⟩ for an observable H**, not a histogram.

The practical consequence was not "it is awkward": **you could not run a VQE or
a QAOA on hardware through qubit16 at all**, because the primitive was not
exposed. A researcher discovers that within about five minutes.

**Now:** an `observables` field taking named Pauli sums, `EstimatorV2`
dispatch, `resilience_level` 0-2 with readout mitigation on by default, and an
expectation-value result shape beside `counts`.
`services/api/app/quantum/observables.py` owns the parsing and the validation.

**The part that would have been wrong silently:** an observable is written
against the circuit the user wrote; the circuit that runs has been laid out
onto a 127-qubit device where their qubit 0 may be physical qubit 43. Handing
the Estimator an un-mapped observable raises nothing — it measures different
physical qubits and returns a perfectly plausible expectation value for a
question nobody asked. `observables_for_circuit` does the `apply_layout`
mapping and `tests/test_observables.py` pins it.

**Still open:** a UI for expressing an observable. The API takes them; the
hardware page does not yet offer a way to type one, so this is code-path-only
today.

### 3.4 ~~No sessions or batch mode~~ — CLOSED

Even with §3.3 fixed, a variational loop would re-queue from scratch on every
iteration — which on a shared QPU means a 200-iteration optimisation takes
days. This is the difference between "we support VQE" and "VQE is usable here".

**Now:** `POST /api/hardware/session` reserves a device and every submission
takes a `session_id`. Gated exactly like `/submit` — a route that reserves a
QPU spends money even though it enqueues nothing, and gating it more loosely
than `/submit` would leave the cheaper-looking door unlocked. Capped at eight
hours, because a session bills for its window whether or not jobs are running
and an abandoned one is a bill with no work attached.

**Still open:** sessions are not recorded on our side, so `DELETE /session/{id}`
cannot check ownership. A session id is high-entropy and only ever returned to
the account that opened it, so the exposure is that somebody holding one can
close it early — an annoyance, not a disclosure. Storing session ownership is
the real fix.

### 3.5 ~~Error mitigation exists, but not on the hardware path~~ — CLOSED

**Was:** `/workbench/noise` implements zero-noise extrapolation by gate folding
and readout inversion via a calibrated confusion matrix — genuinely well done,
and run entirely **against a simulated noise model in the browser**. The real
hardware path applied none of it. IBM's runtime offers
`resilience_level` (TREX readout twirling, ZNE, PEC) and gate twirling as
server-side options that cost nothing to request. Q-CTRL sells error
suppression as an entire product because the improvement is large and real.

**Now:** dynamical decoupling (XY4) and readout twirling are requestable from
the hardware page and the API, both free at the vendor, both recorded on the
job so two runs that differ can be told apart. `resilience_level` (TREX / ZNE /
PEC) is exposed on the Estimator path, defaulting to 1 — an unmitigated
expectation value on current hardware is biased in a way that is easy to
mistake for physics.

**Still open:** gate twirling (`enable_gates`) multiplies circuit variants and
is a different trade from the free options above; it is not exposed.

### 3.6 No fault-tolerance resource estimation

Azure Quantum's Resource Estimator answers "how many physical qubits and how
much runtime would this algorithm need under a given error-correction code and
error budget?" — the single most-asked question in quantum algorithm research,
and the one nobody can answer by running anything today.

We have the pieces nobody else combines: a surface-code decoder lab, real
device calibration data, and circuit analysis. An estimator that took a circuit
and reported logical-qubit count, physical-qubit count, code distance and
runtime under a stated error budget would be directly useful, and it composes
with `/workbench/decoder-lab` rather than sitting beside it.

### 3.7 No parameterized circuits or sweeps

A single circuit at a single parameter point is not an experiment. Researchers
sweep: an angle, a depth, a noise level. Qiskit has `Parameter` and the
primitives take parameter-value arrays natively. Our QASM path has no notion of
a free parameter, so a sweep means N separate submissions, N quota units and N
queue positions.

### 3.8 Qubit ceiling

16 qubits at the top tier. That is correct for a browser statevector and
correct for teaching. It is below the interesting range for research, where the
questions start around 20-30 qubits — and `services/api` runs Aer, which
handles far more than 16 on a server. The cap is a plan limit on the browser
simulator, not a physical one; the server path is not exposed at a higher
ceiling.

---

## 4. Also worth fixing, lower cost

### 4.1 Nothing reconciles a job when no tab is open

The job-status poll is the only thing that observes a hardware job. A user who
submits and closes the tab has a row that stays `queued` forever even though
the job finished hours ago.

The fix is a periodic reconciler: for every `hardware_usage` row with a
non-terminal status and a stamped `job_id`, poll the provider and write the
result. IBM makes this cheap — every job we submit is now tagged `qubit16`, so
`service.jobs(job_tags=["qubit16"])` recovers our jobs even if our own record
of them were lost.

### 4.2 No cross-device circuit → hardware flow

Saved circuits and hardware submission do not know about each other. You cannot
open a saved circuit and submit it, or re-run a past hardware job.

### 4.3 No comparison view

Two runs of the same circuit — different device, different optimisation level,
mitigation on versus off — cannot be put side by side. This is the most common
thing a hardware engineer actually wants to do, we now store everything needed
to do it, and the CSV export is currently the only way to get at it.

---

## 5. The order to build in

Ranked by (researcher value) ÷ (effort), given what already exists:

Items 1-4 of the original list shipped. `docs/PLAN-BEST-IN-CLASS.md` is the
full plan from here; the short version:

1. ~~API keys + REST~~ — **done**.
2. ~~Estimator / observables~~ — **done**.
3. ~~Runtime sessions~~ — **done**.
4. ~~`resilience_level` + suppression~~ — **done** (gate twirling excepted).
5. **A Qiskit-compatible provider.** The highest-leverage item left: it makes
   the adoption cost one line of somebody's existing script.
6. **Background job reconciler** (§4.1). Small, and it makes §3.1 true even
   with no tab open.
7. **Cross-run comparison** (§4.3). Small, and we now store everything for it.
8. **Parameter sweeps** (§3.7).
9. **Device recommendation** — the thing only a multi-vendor platform can do.
10. **Resource estimator** (§3.6). Largest build, largest differentiation.

---

## 6. What must not be lost while chasing this

The learning product is finished, good, and is what the site is *for* today.
Every change above is additive to a separate surface (`/hardware`,
`/workbench`, an API) and none of it should push a first-time visitor towards a
Pauli-sum observable input. The homepage should keep selling the double-slit
simulation. The researcher features should be discoverable to somebody who came
looking for them and invisible to somebody who did not.
