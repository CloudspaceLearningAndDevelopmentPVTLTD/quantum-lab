# Running on real hardware

How `/hardware` reaches a physical quantum computer, what sits between the
browser and the money, and what is still open.

---

## 1. The path a request takes

```
browser                     Next server                    services/api          vendor
────────────────────────────────────────────────────────────────────────────────────────
lib/hardware/client.ts  →  app/api/hardware/**/route.ts  →  routers/hardware.py  →  IBM
                           (validates, rate-limits,          (guard_qasm,            Braket
                            attaches the secret)              Qiskit, SDK)
```

Before August 2026 the first arrow went straight to `services/api`. The browser
held `NEXT_PUBLIC_API_URL` and called the Python service itself. That is why the
opt-in `API_SHARED_SECRET` in `services/api/app/core/security.py` could not be
switched on: the only caller that needed to present the secret was a browser,
and a secret in a bundle is not a secret. docs/SECURITY.md §4 records the
requirement; this proxy is it.

## 2. What the proxy forwards

Five endpoints, one route file each, path-for-path with the upstream. A sixth,
`/api/hardware/jobs`, is listed alongside them because it belongs to the same
surface, but it is **not** a proxy: it serves this account's stored job history
out of `public.hardware_usage` and never calls `services/api` at all.

| Route (Next)                          | Limit (IP / account) | Gates before the secret is attached |
|---------------------------------------|----------------------|-------------------------------------|
| `GET  /api/hardware/devices`          | 60/min / —           | none — free, public, no user data    |
| `POST /api/hardware/estimate`         | 60/min / —           | none — free, public, no user data    |
| `POST /api/hardware/transpile`        | 60/min / —           | none — free, public, no user data    |
| `POST /api/hardware/submit`           | **5/min / 5/min**    | **sign-in → `hardware.real` → monthly quota** |
| `GET  /api/hardware/job/{prov}/{id}`  | 60/min / 60/min      | **sign-in → job ownership**          |
| `GET  /api/hardware/jobs`             | 60/min / 60/min      | **sign-in** — reads OUR database, not upstream |

`submit` is the one that spends money, hence its own much tighter limit *and*
everything in §3.

The three open endpoints are open on purpose, and the reasoning is written at
the top of each route file so it does not have to be re-derived: none of them
is charged by a vendor, none returns another user's data, and all three are what
the page renders *before* a visitor decides whether to buy Pro. Their residual
exposure is upstream CPU (a Qiskit parse per estimate/transpile), bounded by the
per-IP limit and by `guard_qasm()`. If a provider ever starts metering catalogue
reads, `devices` is the first route to put behind `requireCaller`.

**It is not a wildcard proxy, and it must not become one.** `services/api` also
exposes `/api/circuits/run`, which executes arbitrary user QASM, and `/api/jobs`.
A `[...path]` catch-all would republish every one of them through the Next
server and quietly undo whatever the shared secret was protecting. Adding an
endpoint means adding a route file and validating its shape.

Each route validates before forwarding — `qasm` length against the upstream's
`MAX_QASM_CHARS` (131 072), `shots` against `settings.max_shots` (20 000),
`optimization_level` against Qiskit's 0–3, `provider` against
`ibm`/`braket`/`azure`.
These bounds are a **copy**; the upstream schemas and `guard_qasm()` still run
and remain authoritative. The point of checking twice is that a body which
would be refused upstream never costs a network round trip and a Qiskit parse
(audit finding PY‑1: a 50-byte body made Qiskit allocate 669 MB).

The job-id route is a catch-all segment because a Braket task id is an ARN and
contains a slash. Segments are checked **after** Next has percent-decoded them —
checking the encoded form is how `%2e%2e` gets missed — against
`/^[A-Za-z0-9:_-]+$/`, which cannot spell `..` at all.

## 3. Who may spend money (`/submit`)

`forward()` in `lib/hardware/proxy.ts` **presents the operator's shared secret on
every upstream call.** Whatever gate `services/api` would have applied to the
caller, this hop has already passed on their behalf. So the Next route is the
only place the question "may this person spend our money?" can be asked, and for
a while it was not asked at all: the route's sole gate was an IP rate limit, and
`curl -X POST https://<host>/api/hardware/submit -d '{...}'` from a signed-out
client enqueued a job on IBM against the operator's account, five a minute per
address, from as many addresses as the caller cared to rent.

That was a **regression**, not a long-standing gap. Before the proxy, an
operator who set `API_SHARED_SECRET` — the control §4 of docs/SECURITY.md
recommends — got a 401 upstream for browser traffic: the hardware page was
broken, but the endpoint with a cost attached was shut. Introducing the proxy
made the server present that secret for anonymous callers, so turning the
documented lock on stopped protecting the only endpoint that spends.

The gate chain now, in order:

```
1  IP rate limit          5/min      before anything expensive, so an anonymous
                                     flood cannot be aimed at our auth service
2  requireCaller          401        Supabase-verified token; never a body field
3  account rate limit     5/min      an account cannot be rotated like an IP
4  shape validation       400        cheap, and keeps junk out of billing
5  requireFeature         402        'hardware.real' — Free is refused here
6  reserveHardwareJob     503        claim a row in public.hardware_usage
7  assertHardwareQuota    402        50 / 500 / 5,000 per calendar month
8  forward                           ← the shared secret leaves the process HERE
9  recordHardwareJob                 stamp the provider job handle on the row
```

A non-2xx from upstream releases the reservation, so a refused or unreachable
submission does not cost the user a job of their allowance.

**Metering fails closed.** Steps 6 and 7 refuse with 503 when the usage store
cannot answer — no Supabase, no `SUPABASE_SERVICE_ROLE_KEY`, or the database
simply down. Allowing a job when the meter is broken converts a database blip
into an unbounded provider bill discovered from an invoice. The practical
consequence: **a deployment with real provider credentials but no Supabase
project cannot submit hardware jobs at all.** That is intended. Without accounts
there is no notion of who is spending, and therefore no bound.

**Behaviour on a cold start and across instances.** There is no in-process
counter: `public.hardware_usage` is the only meter, so a fresh serverless
instance counts exactly what a warm one counts, and N instances share one
allowance rather than each getting a fresh one. What remains is a narrow race —
two genuinely simultaneous submissions can both insert before either counts, so
an account can over-run its allowance by the number of requests in flight,
bounded by the 5/min per-account limit. Closing it completely needs a
`security definer` insert-if-under-quota function in Postgres.

## 3a. Whose job is it? (`/job/{provider}/{id}`)

Polling spends nothing at a vendor — it reads the status of a job that is already
paid for — so there is **no entitlement or quota check** on it. A Pro user who
lapses to Free can still read the results of jobs they paid for.

It does return somebody's **measurement results**, though, and it used to return
them to anyone holding the id, signed out, with the shared secret attached to
make it work. So a job is now **bound to the account that submitted it**: step 9
above stamps `provider` and `job_id` onto the submitter's `hardware_usage` row,
and this route refuses anything that does not match.

* Somebody else's job and a job that never existed return the **same** 404 with
  the same body. A distinct 403 would make the route an oracle for real ids.
* When the ownership store cannot answer, the route returns **503**, not the job.
  An outage is not a reason to publish a stranger's results. The JobMonitor
  already renders a failed poll as "the job is unaffected — it lives on the
  provider", which is exactly true.
* **Jobs submitted before this change have no stamped row and are no longer
  pollable through the proxy.** Their ids live in `localStorage` on the hardware
  page, so a few users will see "no such job" on stale cards. The jobs
  themselves are untouched and their results remain in the provider's console.
  That one-time cost buys the end of an unauthenticated read of everyone's
  results.

## 4. Turning the shared secret on

Nothing below is required for local development. With no secret set the proxy
adds one hop and changes nothing else.

1. On **`services/api`**: `API_SHARED_SECRET=$(openssl rand -hex 32)`.
2. On the **Next deployment**: `QUANTUM_API_SECRET=<the same value>`.
   Server-only. It must never appear under a `NEXT_PUBLIC_` name — Next inlines
   those into the client bundle, which would hand the secret to every visitor.
   `API_SHARED_SECRET` is also accepted on the Next side, because a
   `docker compose` setup usually gives one variable to both services.
3. Verify: `curl -X POST https://<api-host>/api/circuits/run` must return 401,
   `GET /api/health` must still return 200 (exempt, so liveness probes work),
   and `/hardware` in the app must still list devices and estimate a cost.

If 401s appear only in production, check whether your reverse proxy forwards
`X-Quantum-Lab-Secret`; a platform that strips unknown headers will break it,
and this interaction has never been tested against a real proxy.

## 3b. Azure Quantum: wired, never run against a live workspace

Label it honestly, because until August 2026 it was labelled two different ways
at once.

**What was true.** `services/api/app/quantum/azure.py` is 485 lines implementing
submit, poll, target listing and result normalisation for Azure Quantum, in the
same submit-then-poll shape as IBM and Braket. Exactly one of its functions had
a caller: `azure_available()`, used by `app/quantum/backends.py` to decide
whether to grey out two registry entries. `submit_azure_job`, `poll_azure_job`
and `list_azure_targets` had **zero**.

The visible consequence was a contradiction. `GET /api/circuits/backends`
advertised `azure_quantinuum_h1` and `azure_ionq_aria` as selectable hardware;
`POST /api/hardware/submit` answered "`azure_quantinuum_h1` is not a hardware
backend" for the first and the queue refused the second; and
`GET /api/hardware/devices` did not list Azure at all, so the page could not
render a card for a device it would let you pick. That is scaffolding presented
as a feature.

**What is true now.** The dispatch is connected: `BACKEND_PROVIDER` routes both
ids to `PROVIDER_AZURE`, `submit_job` and `poll_job` dispatch to the Azure
functions, `AZURE_BACKEND_TARGETS` translates our stable ids to Microsoft's
target strings (`azure_quantinuum_h1` → `quantinuum.qpu.h1-1`), and
`list_hardware_devices` includes Azure targets. Without credentials they appear
as catalogue rows marked unavailable with the reason attached, which is the
correct answer. `services/api/tests/test_wiring.py` derives all four tables from
the registry, so adding a backend without finishing the job now fails a test.

**What is still not true.** None of this has ever executed against a real Azure
Quantum workspace. There is no SDK installed in any environment this code has
run in, no resource id, no credential, and therefore no evidence that
`workspace.get_targets(name=...)`, `target.submit(qasm2_source, shots=...)` or
`job.get_results()` behave as this module assumes. The IBM and Braket paths are
in the same position; the difference is that they were at least reachable.
**Treat the first Azure submission as a test of this code, not a use of it.**

**Cost estimation was lying about it, and about four other devices.**
`transpile.vendor_for()` defaults an unknown backend id to `"simulator"`, which
prices at zero, and five hardware ids were missing from `BACKEND_VENDOR`:
`ibm_kyiv`, `ibm_sherbrooke`, `ionq_forte`, `azure_quantinuum_h1` and
`azure_ionq_aria`. `POST /api/hardware/estimate` therefore returned
`is_free: true` with the note "No charge: simulators run locally" for an IonQ
Forte submission, which is billed per shot plus a task fee. All five are now
priced. Quantinuum is a special case: it bills in H-System Credits at a rate
specific to the customer's Azure agreement, so there is no dollar figure to
report — it returns a zero total with `is_free: false` and a note saying this
service cannot price it and that it is **not** free.

## 5. What is still open

Written here rather than only in a tracker, because each is a thing a reader of
this code would otherwise assume is handled.

* **The quota has a narrow concurrency race.** See §3: the reservation is
  inserted before the count, which makes two sequential requests safe and two
  simultaneous ones able to over-run by the number in flight. The fix is a
  `security definer` function in Postgres; until then the bound is the 5/min
  per-account rate limit.
* **`supabase/schema-billing.sql` has still never been run against a live
  project.** The new `provider` / `job_id` columns and the ownership index are
  written with `add column if not exists`, so the file is re-runnable, but the
  first operator to apply it is the first to test it.
* **Metering trusts the upstream's `job_id`.** If `services/api` returns 2xx with
  no usable handle, the usage row stands (we do not refund spend we cannot rule
  out) but the job can never be polled through the proxy. It is logged.
* **Three client functions are not proxied.** `analyse()`, `submitLocalJob()`
  and `pollLocalJob()` in `lib/hardware/client.ts` still call
  `NEXT_PUBLIC_API_URL` directly. Nothing in the app calls them, which is why
  they were left alone rather than given routes. **With the shared secret on
  they return 401, and with the API on a private network they cannot connect.**
  Wire one into a page and you must add a route handler first.
* **`services/agent` does not present the secret.** Its `run_quantum_circuit`
  tool posts to `/api/circuits/run` and its `except Exception` treats a 401 like
  any other API problem: it silently simulates locally instead. The tutor keeps
  answering; the only symptom is that the API stops seeing agent traffic.
* **No provider has ever been touched live.** §3b said this of Azure; §5a
  explains why it was true of IBM and Braket too, and what had to change before
  it could stop being true. It is wired and tested against its own tables;
  nothing has verified it against a vendor. `scripts/hardware_smoke.py` is how.
* **`/api/hardware/estimate` is not a quote.** The per-shot and per-task figures
  are transcribed by hand from published pricing pages, are not a live feed, and
  do not model per-qubit surcharges, reservation pricing or free-tier credits.
  Quantinuum cannot be priced at all (§3b).
* **The three IBM devices in `KNOWN_DEVICES` are also the source of the noise
  model's constants.** `docs/PENNYLANE.md` §3 documents where those came from
  and that they are a specification sheet rather than a live calibration. If the
  catalogue is ever changed to a different device family, that model no longer
  describes it.
* **`services/api` has no rate limit of its own.** Everything above lives in the
  Next server. Anyone who can reach the Python port directly bypasses all of it,
  which is the whole argument for keeping that port private (docs/SECURITY.md
  §4, deployment A).

---

## 5a. What changed in September 2026: the path became runnable

Everything §3b said about Azure — wired, never run — was true of **all three**
providers, and for a reason that was not written down anywhere: the vendor SDKs
were commented out of `services/api/requirements.txt` under an "OPTIONAL
EXTRAS" heading, and the Dockerfile installs that file. So the deployed image
could not submit to IBM, Braket or Azure **with valid credentials and a working
device**, because `import qiskit_ibm_runtime` raised `ModuleNotFoundError`
inside `_require_ibm()` long before the token was read, and the route answered
503 with advice — "install it with `pip install qiskit-ibm-runtime`" — aimed at
a container nobody was going to pip into.

There was no deployed environment in which any of this **could** run. That is
now fixed, along with four things that would each have failed on first contact
with a real account.

**1. The SDKs ship.** `services/api/requirements-hardware.txt` holds the three
vendor SDKs and the Dockerfile installs it by default. Build with
`--build-arg INCLUDE_HARDWARE_SDKS=0` for a simulator-only deployment: that
saves about 120 MB and restores exactly the previous behaviour.

**2. IBM is addressed to an instance.** `QiskitRuntimeService` was constructed
with a channel and a token and nothing else. The legacy `ibm_quantum` channel
that resolved hub/group/project from a bare token was retired in 2025; its
successor addresses work to a service instance identified by a CRN. Omitting it
is not a hard error, which is exactly why it went unnoticed — the SDK
enumerates every instance the token can see and picks one. On a single-instance
account that silently works. On an account with both an Open plan and a paid
one, a submission meant for paid hardware can land on a queue with a different
allowance and a different bill, and a poll issued against the other instance
answers "job not found" for a job that plainly exists. `IBM_QUANTUM_INSTANCE`
(and `IBM_QUANTUM_REGION`) now set it, and are omitted from the call entirely
when unset so single-instance accounts are unaffected.

**3. The service is built once.** It was constructed fresh inside submit,
inside poll and inside the device listing — and `JobMonitor` polls a running job
for its whole lifetime, so a six-hour queue meant hundreds of authentications
to read one status field. `_ibm_service()` caches one per (channel, token,
instance, region).

**4. The preview now describes the circuit that runs.** `POST /transpile` took
an `optimization_level` and showed you the resulting depth and gate counts;
`submit_ibm_job` was hardcoded to level 1. They agreed only because the page
also passed 1, and nothing tied the two numbers together. `optimization_level`
is now a submission parameter, threaded from the page through the proxy to both
the preview and the submission, and the level is stored on the job record.

**5. Jobs are attributable at the vendor.** Every IBM job is tagged `qubit16`
plus `owner:<hash>`, where the hash is a truncated SHA-256 of the
Supabase-verified caller id — never a body field, and never the raw id, since
tags are visible in IBM's console. Tags are also what makes
`service.jobs(job_tags=["qubit16"])` able to recover our jobs when our own
record of them is lost.

**6. The Azure catalogue speaks the right language.** `GET /devices` published
Azure rows keyed by Microsoft's target string (`quantinuum.qpu.h1-1`) while
every route downstream is keyed by our registry id (`azure_quantinuum_h1`), so
selecting a Quantinuum card produced "not a hardware backend" for a device the
service had just offered — the same defect §3b describes, surviving in the one
direction that was not fixed. `list_hardware_devices()` now translates on the
way out and carries the vendor's spelling in `vendor_target`. Targets the
service has not wired up (the two Azure simulators) are listed and marked
unavailable with the reason, rather than offered and then refused at
submission. `tests/test_wiring.py` asserts that **every device the catalogue
marks available resolves through `provider_for`** — the invariant the existing
registry tests did not cover, because the picker reads the catalogue, not the
registry.

### Free error suppression

Two options that cost nothing at the vendor are now requestable from the
hardware page and stored on the job record:

* **Dynamical decoupling (XY4).** Fills idle qubit time with an echo sequence.
  It changes the pulse schedule, not the shot count.
* **Readout twirling.** Randomises a Pauli frame around each measurement and
  undoes it classically, converting a *biased* readout error — a device that
  mistakes 1 for 0 more often than the reverse — into a symmetric one. Your
  shots are split across randomisations rather than added to.

Both are error **suppression**, not mitigation: they change how the circuit is
executed rather than post-processing the result. Both default to **off**,
because a run has to be reproducible by default and the person comparing two
runs has to be the one who decided they differ. IBM only; other providers
ignore the flags rather than refusing them, so a caller need not branch on
provider to ask.

`resilience_level` (TREX / ZNE / PEC) is **not** exposed. It is an
`EstimatorV2` option and we do not call `EstimatorV2` — see
docs/COMPETITIVE-GAPS.md §3.3.

### Results are stored now

A hardware job's results used to be fetched from the vendor on each poll,
rendered, and dropped. The job ids lived in `localStorage`, capped at twenty,
holding an id and a backend name — so the history was per-browser, it died with
site data, and **no measurement count was ever written down anywhere.**

`public.hardware_usage` now carries `status`, `counts`, `qasm`, `error`,
`qpu_seconds`, `optimization_level`, `transpiled_depth`,
`transpiled_two_qubit_gates` and `completed_at`.
`GET /api/hardware/job/{provider}/{id}` writes them as it observes each job —
it is the only place the server ever sees a job's state, since submission is
asynchronous at the vendor and nothing calls us back — and
`GET /api/hardware/jobs` serves the account's history, rendered by
`components/hardware/JobHistory.tsx` with CSV and JSON export.

Two honest limits on that record:

* **A poll is the only writer.** Submit a job, close the tab, and its row stays
  `queued` however long ago it actually finished. The panel renders a row that
  was never polled as "never checked" rather than as "queued", because guessing
  would mean telling somebody their finished experiment is still in a queue.
  The fix is a background reconciler over non-terminal rows; it does not exist
  yet.
* **The circuit source is stored.** `qasm` is user content and is kept
  deliberately: without it the history is a list of histograms with no
  provenance, and a researcher cannot tell which of six variants produced which
  distribution. It is readable only by its owner under RLS and by the service
  role. An operator who considers that too much can drop the single column;
  everything else still works.

### Verifying against a real account

`services/api/scripts/hardware_smoke.py` is the only thing that can tell you
the path works, because every test in the suite is offline and injects fakes —
which is right, a test suite that spends money is a test suite nobody runs, but
it means a green suite proves internal consistency and not that IBM will accept
a job.

```bash
cd services/api
python scripts/hardware_smoke.py                              # credentials + device list
python scripts/hardware_smoke.py --backend ibm_brisbane       # compile + price, submits nothing
python scripts/hardware_smoke.py --backend ibm_brisbane --submit   # asks before spending
python scripts/hardware_smoke.py --poll ibm:<job_id>
```

It submits a Bell pair — an answer everybody already knows, so a wrong result
is unmistakable — and on polling reports what fraction of shots landed on 00 or
11. **Treat the first run as a test of this code, not a use of it.** As of this
writing nothing here has executed against a live IBM, AWS or Azure account.


---

## 6. What a submitted job shows: transpiled circuit and device topology

A submitted or completed job card (`components/hardware/JobMonitor.tsx`) can
expand a **"device layout & transpiled circuit"** section with two halves:

* **A topology sketch** (`components/hardware/DeviceTopology.tsx`). Each
  backend id maps onto a connectivity family — IBM ids to **heavy-hex**,
  IonQ/Quantinuum to **all-to-all** (one shared ion trap), Rigetti to a
  **square lattice**, and anything unrecognised to a **linear chain** — and a
  small SVG draws the family's characteristic pattern. It is labelled, in the
  figure itself, as a **schematic**: it is the *idea* of the coupling map (why
  heavy-hex transpilation inserts SWAPs and trapped-ion transpilation does
  not), not a live calibration map, which is provider data we do not have
  offline and would not fit at card size. Keep the label; a diagram in a
  hardware UI reads as telemetry unless it denies it.
* **The transpiled gate sequence.** The card re-runs the same transpilation
  preview the pre-submit disclosure uses (`POST /api/hardware/transpile`) and
  lists the native instructions in execution order, with consecutive repeats
  collapsed (`rz q0 ×3`). The caption says exactly what it is: the
  deterministic rewrite the submission used, reconstructed — not data read
  back from the device. The list itself is derived client-side by
  `lib/hardware/topology.ts::parseGateSequence` from the transpiled OpenQASM.

The geometry and the parser are pure and unit-tested
(`lib/hardware/topology.test.ts`); the mapping from backend ids to families is
prefix-based so live IBM names and Braket ARNs land correctly, not only the
static catalogue ids.

**Server-side sequence.** `transpile_for` in
`services/api/app/quantum/transpile.py` now also returns `sequence` (ordered
`{gate, qubits}` entries, capped at `SEQUENCE_CAP` = 200, with
`sequence_truncated`) — tested in
`services/api/tests/test_transpile_sequence.py`. The HTTP layer's
`TranspileResponse` model in `app/routers/hardware.py` does not carry the two
fields yet, so the browser parses the QASM instead; adding
`sequence: list[dict]` and `sequence_truncated: bool` to that model is the
whole remaining wire-up, after which the client parser becomes the fallback.

**Wiring note.** `JobMonitor` takes the backend id and submitted QASM as
optional props (`backend`, `qasm`) and renders the section only when given
them — with no props it renders exactly as before. `/hardware`'s stored-job
list (`app/hardware/page.tsx`) already keeps each job's `backend`; wiring the
section up is `backend={job.backend}` on the `<JobMonitor>` it renders, plus
persisting the submitted QASM into `StoredJob` if the sequence half should
survive a reload. A job given a backend but no QASM shows the topology half
with an honest "source not kept for this job" note in place of the sequence.

---

## 7. Noise-aware device fit: calibration summaries and the fit estimate

Two additions let the picker answer "which of these machines gives *this*
circuit the best odds?" without ever dressing a heuristic up as telemetry.

### 7.1 Per-device calibration summary (`services/api`)

Every row of `GET /api/hardware/devices` now carries a `calibration` object
(`app/quantum/calibration.py`, wire model `CalibrationSummary` in
`app/routers/hardware.py`): qubit count, **median 1Q/2Q gate error**, **median
T1/T2 (µs)**, queue depth — and a mandatory `source` marker:

| `source`        | Meaning |
|-----------------|---------|
| `live`          | Read from the vendor SDK during this listing — IBM's `backend.target` or Braket's `device.properties`, both data the SDK already fetched, no extra round-trip. Only earned when the read yielded at least one real figure. |
| `static`        | The shipped table of **vendor-published typical values** (`STATIC_CALIBRATIONS`). Served whenever credentials are absent or a live read failed; the `note` says "typical … not a live calibration". Azure targets are always `static` — their SDK has no cheap calibration read. |
| `unavailable`   | Nothing honest to show (device not in the table). No numbers are invented. |

The honesty rules are load-bearing and tested
(`services/api/tests/test_calibration.py`): a summary never upgrades itself
(`live` requires actual figures; an empty target degrades to `static`), the
static table's provenance discipline matches the pricing table's (§5:
transcribed by hand, dated, indicative), and without credentials the whole
listing must contain no `live` summary at all.

### 7.2 The fit estimate (`apps/web`)

`lib/hardware/fitEstimate.ts` computes, entirely client-side:

```
success ≈ exp(−depth × median 2Q error)
```

with `depth` being the circuit **as drawn** (`circuitStats`, ASAP layering,
measurements/barriers excluded) and the error taken from the device's
calibration summary. Labels: `good` ≥ 0.75, `marginal` ≥ 0.35, else `poor`
(`FIT_THRESHOLDS`, pinned by `fitEstimate.test.ts` along with monotonicity in
both depth and error rate).

`DevicePicker` renders it as a pill per device — and a **Sort by estimated
fit** toggle (stable sort, no-estimate devices last, toggling off restores the
server order; keyboard arrowing follows the visible order) — only when given
the new optional `circuitDepth` prop. Wiring on `/hardware` is one line:
`circuitDepth={circuit ? circuitStats(circuit).depth : null}` in
`app/hardware/page.tsx`.

**Honesty constraints — keep all of them when touching this UI:**

* The formula travels with the number: the tooltip shows it verbatim
  (`FIT_FORMULA`) plus what it ignores (`FIT_DISCLAIMER`: routing, readout
  error, decoherence, post-transpile depth growth). The pill always says
  "est.".
* An estimate built on `static` calibration is suffixed "(typical)" — typical
  spec-sheet numbers must not masquerade as today's device.
* No calibration, no 2Q error, or `source: unavailable` ⇒ "fit unknown", never
  a guessed percentage.
* It is a **ranking** heuristic. It exists to say "machine A's 2Q error is 10×
  machine B's, prefer B for this depth" — never to predict a fidelity anyone
  should quote. If a real prediction is ever wanted, it belongs server-side,
  post-transpile, per-device coupling map and all.
