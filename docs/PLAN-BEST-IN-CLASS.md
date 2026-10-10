# How qubit16 becomes the platform quantum engineers choose

A plan, not a wish list. Every item names what it is worth, what it costs, and
what it depends on. Ordered so each step makes the next one cheaper.

Read `docs/COMPETITIVE-GAPS.md` first — it is the honest account of where we
stand. This file is what to do about it.

---

## The strategic idea, in one paragraph

**We will not win by being a better place to write a circuit.** Qiskit is
excellent, free, and already installed on every researcher's laptop. We win by
being the layer *underneath* their existing code that does four things a local
notebook structurally cannot: reach every vendor through one credential, keep a
comparable record of every run, tell them which device to use and what it will
cost before they spend it, and apply the error suppression most people never
switch on. The adoption cost has to be **one line of their existing script**,
not a new API to learn.

Everything below follows from that.

---

## Phase A — Be reachable from the code people already have

*Shipped in this phase already: API keys with scopes, an Estimator path,
runtime sessions, durable results. `docs/API.md` is the surface.*

### A1. A Qiskit-compatible provider — **the single highest-leverage item**

```python
from qubit16 import Qubit16Provider

service = Qubit16Provider(token="qb16_sk_…")
backend = service.backend("ibm_brisbane")     # or ionq_aria, or rigetti_ankaa
```

`SamplerV2`, `EstimatorV2`, `Session` and `backend.run` already exist as
concepts in our API; a provider is the adapter that makes existing Qiskit code
run against us **unchanged**. That inverts the adoption cost entirely: instead
of "learn our API", it is "change the two lines where you construct the
service, and now your script reaches IonQ and Rigetti too, keeps a history, and
costs are estimated before you spend."

This is how qBraid and Strangeworks actually get adopted, and neither of them
is as honest about cost or as strong on the learning side.

* **Worth:** Converts every existing Qiskit user into a potential user with
  near-zero switching cost. Nothing else on this list comes close.
* **Cost:** A Python package implementing `BackendV2`, `Provider`, and the two
  primitives against the REST surface that now exists. Medium — the hard part
  (auth, quota, multi-vendor dispatch, mitigation) is already built.
* **Depends on:** the API. Done.

### A2. Parameterised circuits and sweeps

A single circuit at a single parameter point is not an experiment. Researchers
sweep an angle, a depth, a noise level — and today that means N submissions, N
quota units and N queue positions.

Qiskit has `Parameter` and the primitives take parameter-value arrays natively,
so the vendor side is free. What is missing is a wire representation of a free
parameter in our QASM path, and a quota rule that counts a sweep as one job.

* **Worth:** VQE and QAOA go from "possible" to "not absurd". It is also the
  difference between a sweep costing one job of allowance and costing fifty.
* **Cost:** Small-to-medium.
* **Depends on:** A1 is nicer with it but does not need it.

### A3. Background job reconciler

The status poll is the only thing that observes a hardware job. Submit, close
the tab, and the row says `queued` forever. A periodic worker over
non-terminal rows with a stamped `job_id` closes this — and IBM makes it cheap,
because every job we submit is tagged `qubit16`, so `service.jobs(job_tags=…)`
recovers our jobs even if our own record were lost.

* **Worth:** Makes the durable record actually durable. It is currently the
  largest gap between what the history claims and what it delivers.
* **Cost:** Small. One cron-shaped worker.

---

## Phase B — Do things no competitor does

This is where the platform stops being a nicer console and becomes the obvious
choice. Every item here exploits something we already have and nobody else
combines.

### B1. Device recommendation: "which machine, and what will it cost?"

Given a circuit, answer: *on which of the nine devices will this produce the
most usable result per dollar?*

We are the only platform that can answer this, because answering it needs
**live calibration + real pricing + coupling maps + transpilation, across
vendors, at once** — and every vendor console only knows its own hardware. We
already have all four inputs. The estimate is a transpile against each
candidate, a two-qubit-gate count, a fidelity projection from the calibration
figures, and the price.

* **Worth:** This is the single most useful thing a multi-vendor platform can
  do, and it is a perfect demo: paste a circuit, see nine devices ranked with
  the reasoning shown.
* **Cost:** Medium. `lib/hardware/fitEstimate.ts` already does part of it for
  one device.
* **Risk to manage:** it must be honest about uncertainty. A projected fidelity
  is a projection; label it as one or it becomes the thing people quote back
  when a run disappoints.

### B2. Cross-run comparison

Two runs of the same circuit — different device, different optimisation level,
mitigation on versus off — side by side, with the divergence quantified
(total-variation distance for histograms, error bars for expectation values).

This is the most common thing a hardware engineer actually does. We now store
everything needed and the CSV export is currently the only way to get at it.

* **Worth:** High, and cheap. It also makes B1's claims checkable, which is
  what stops B1 becoming marketing.
* **Cost:** Small-to-medium. Pure UI plus a distance metric over data we hold.

### B3. A public benchmark of real devices

Run a fixed suite — mirror circuits, quantum volume, a GHZ ladder, randomised
benchmarking — across every device we reach, on a schedule, and publish the
results with full methodology and raw data.

* **Worth:** This is a **credibility and distribution** play, not a feature.
  Vendors publish their own numbers; nobody publishes an independent,
  reproducible, cross-vendor comparison with the circuits attached. It is the
  kind of thing that gets cited, linked and posted — and it makes qubit16 the
  reference rather than a tool.
* **Cost:** Medium, plus a real and recurring QPU bill. Budget it deliberately.
* **Depends on:** A3 (so scheduled runs collect their own results).

### B4. Fault-tolerance resource estimation

"How many physical qubits and how much runtime would this algorithm need under
a given code and error budget?" — the most-asked question in algorithm
research, and the one nobody can answer by running anything.

Azure ships an estimator. We hold pieces nobody combines: a surface-code
decoder lab with real threshold behaviour, live device calibration, and circuit
analysis. An estimator here composes with `/workbench/decoder-lab` instead of
sitting beside it — you can change the decoder and watch the physical-qubit
count move.

* **Worth:** High and durable. Largest genuine differentiation on this list.
* **Cost:** Largest build here. Do it after B1–B3 have brought the audience.

---

## Phase C — Make it a place research lives, not a tool research visits

### C1. Reproducible run permalinks

A public URL for one run: the circuit, the device, the calibration snapshot at
submission time, the compilation settings, the raw counts, and the date.
Opt-in, immutable, citable.

* **Worth:** Papers need a reproducibility artefact and currently attach a
  GitHub gist. Being the place that link points to is worth more than any
  feature, because it puts qubit16 in the citation.
* **Cost:** Small-to-medium. We already store all of it; this is a public read
  path, an opt-in flag and a stable id.
* **Note:** the calibration snapshot is the part nobody else keeps, and it is
  what makes a result actually reproducible rather than merely repeatable.

### C2. Research group workspaces

Shared quota, shared job history, shared budget, per-member attribution. The
org machinery (seats, roles, invites, admin console) already exists for
classrooms; a research group is the same shape with a different default.

* **Worth:** Turns single-seat Pro into lab-sized contracts. This is the
  revenue item on the list.
* **Cost:** Medium, mostly re-pointing existing org code.

### C3. Spend controls

Per-project budgets, alerts at thresholds, a hard stop. We meter jobs; we do
not meter money, and the unit that matters to a PI with a grant is money.

* **Worth:** Removes the main objection a lab has to giving a student a key.
* **Cost:** Small-to-medium. `qpu_seconds` is already recorded.

### C4. Hosted notebooks

The obvious item, deliberately last. It is the largest build, it is what qBraid
already does well, and A1 makes it much less urgent — a researcher with a
Qiskit provider runs our platform from the notebook they already have. Build it
when the audience asks for it, not before.

---

## What NOT to do

Stated because the expensive mistakes on a platform like this are additions,
not omissions.

* **Do not chase qubit count on the browser simulator.** 16 is right for
  teaching and the server path is where a bigger number belongs. A 30-qubit
  browser statevector is an engineering trophy nobody needs.
* **Do not build a circuit-drawing tool for experts.** They write Python. The
  gate grid is for learners and should stay aimed at them.
* **Do not put a Pauli-sum observable input on the homepage.** The learning
  product is finished, good, and is what the site is for today. Every item
  above lives on `/hardware`, `/workbench` or an API. The double-slit
  simulation keeps the front page.
* **Do not add a scope to an API key without deciding on purpose.** The scope
  catalogue is deliberately `hardware:*` only, and the test that enforces it is
  there to make widening it a decision rather than a diff.
* **Do not let a projected number lose its label.** Estimated fidelity,
  estimated cost, static calibration: the platform's whole credibility with
  this audience rests on never once presenting a projection as a measurement.
  It is the thing the existing codebase does better than its competitors and
  the easiest thing to erode.

---

## Ordering, and why

| | Item | Worth | Cost | Do it |
|---|---|---|---|---|
| 1 | **A1** Qiskit provider | Highest | Medium | Now |
| 2 | **A3** Job reconciler | High | Small | Now — it is small |
| 3 | **B2** Cross-run comparison | High | Small | Now |
| 4 | **A2** Parameter sweeps | High | Medium | Next |
| 5 | **B1** Device recommendation | Highest | Medium | Next |
| 6 | **C1** Run permalinks | High | Small | Next |
| 7 | **B3** Public benchmark | High (distribution) | Medium + QPU budget | After an audience exists |
| 8 | **C3** Spend controls | Medium | Small | With C2 |
| 9 | **C2** Group workspaces | High (revenue) | Medium | When labs ask |
| 10 | **B4** Resource estimator | Highest (durable) | Largest | After B1–B3 |
| 11 | **C4** Hosted notebooks | Medium | Largest | Only if asked |

**If only one thing gets built: A1.** Everything else on this list is worth
more once existing Qiskit code can reach the platform without being rewritten.

---

## The measure of success

Not signups. Three things:

1. **A paper cites a qubit16 run permalink.** (C1)
2. **Somebody's VQE runs here instead of on IBM's console**, because the
   session, the mitigation and the history are better. (A1 + A2)
3. **Our benchmark gets argued with.** (B3) An independent number nobody
   disputes is a number nobody read.
