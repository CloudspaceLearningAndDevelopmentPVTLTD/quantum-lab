# Quantum Lab

**Learn quantum mechanics by playing with it.** Forty live visualizations, a from-scratch
16-qubit statevector simulator, a fifteen-lesson course, 30 circuit challenges, two graded exams, and an
AI tutor that degrades honestly when it has nothing to run on.

`Next.js 16` `React 19` `TypeScript 5.6 (strict)` `Tailwind 3.4` `three.js` `Python 3.11`
`FastAPI` `Qiskit + Aer` `PennyLane` `LangChain` `Supabase` `Stripe` `MIT`

---

Nothing here is a video or a pre-rendered animation. The double-slit page computes its own
interference pattern and samples individual particle impacts from it. The tunneling page
integrates the time-dependent Schrödinger equation while you watch. The circuit editor runs a
genuine statevector simulation written from scratch in `apps/web/lib/quantum.ts` — about 2,300 lines
with zero dependencies, cross-checked against Qiskit and PennyLane by a test that runs both.

It is for anyone who has read the words "superposition" and "entanglement" and wanted to
actually *touch* them.

---

## Run it in five minutes

```bash
git clone <your-repo-url> && cd quantum-lab
npm install          # from the REPO ROOT — this is an npm workspace
npm run dev
```

Open <http://localhost:3000>.

**No API key, no Python, no database, no account.** The visualizations, the simulator, the whole
course, the challenges, the exams and the tutor's offline answer set are self-contained
TypeScript. Every environment variable in this repository is optional; each one switches on an
*extra*. If a change ever makes an empty environment fail to boot, the change is wrong.

A good first five minutes: open `/simulator`, load the **Bell State** preset, press **Run**, and
confirm you only ever get `00` and `11` — never `01` or `10`. That is entanglement, computed in
your browser.


---

## What actually works today

Measured on this tree, not estimated. Re-measure before quoting.

| Suite | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit -p apps/web/tsconfig.json` | clean |
| Web unit | `cd apps/web && npx vitest run` | 860 passed, 43 files |
| API service | `cd services/api && .venv/bin/python -m pytest -q` | 129 passed |
| Agent service | `cd services/agent && .venv/bin/python -m pytest -q` | 82 passed |
| Preflight | `node scripts/preflight.mjs` | 20 pass, 0 warn, 0 fail |

Playwright (`apps/web/tests/e2e`, 12 spec files across a `chromium` and a `mobile` project) needs
a server on `:3000` and, in a container, `PW_CHROMIUM` pointed at a Chromium binary. It was not
re-run for this README; see [CONTRIBUTING.md](CONTRIBUTING.md) § Running every suite.

**Learn** — fifteen lessons. Eight free foundations (qubits, superposition and measurement,
interference, tunneling, gates and circuits, entanglement, Grover, inside a quantum computer)
and six paid advanced (Shor, error correction, VQE/NISQ, quantum cryptography, quantum machine
learning, QAOA/optimization). Each has an inline quiz, question-first inline checks, and a live
embedded visualization.

**Simulate** — `/simulator`. Click-or-keyboard gate grid, step-through execution, shot sampling
with a noise model, state inspector with amplitudes and reduced-density-matrix entanglement
entropy, OpenQASM 3 import/export with exact π fractions, save/load, share links that carry the
circuit in the URL. All 16 qubits are free with no account. A research-tools panel computes exact
Pauli-sum expectation values (`Z0 Z1`, `0.5*X0X1 - Y2`, `ZZI`) and downloads the full final
statevector as CSV or JSON.

**Visualize** — eleven interactive experiments. Eight are listed on `/visualizations`
(double-slit, superposition, Bloch sphere, entanglement, tunneling, Grover, QFT, decoherence);
three more (`/visualizations/shor`, `/visualizations/surface-code`, `/visualizations/vqe`) render
and have their own metadata and social cards, but they are **not** in the `VISUALIZATIONS`
catalogue in `components/ui/Hero.tsx` and no page, lesson or nav entry links to them — a grep of
`apps/web` for their paths matches only their own route files. They are reachable only by typing
the URL, and they are absent from `/visualizations`, the sitemap and the search palette. That is
a gap, not a design.

**Practise** — 22 circuit-building challenges with par scores, staged hints and a verdict that
explains what is wrong. Two timed exams (`foundations-cert`: 15 questions drawn from a pool of
58; `advanced-cert`: 20 from 61, behind the `certification` feature), graded and stamped by the
server, with resumable attempts and per-question review.

**Tutor** — `/tutor`. Three tiers: the LangChain agent that runs circuits to check its own
answers, a direct Anthropic call, and a built-in offline answer set. The status line above the
chat box names the tier that actually replied.

**Coach** — a concept graph over the course that recommends what to study next from local
progress, and shows the rule behind each recommendation.

**Hardware** — `/hardware`. Device picker, cost estimate, submission and job polling against
`services/api` (Qiskit + Aer, PennyLane) through a server-side proxy that authenticates the
caller, checks the entitlement, reserves quota, and only then presents the operator's secret
upstream.

**Operate** — Stripe billing with server-enforced entitlements, org seats with per-role checks,
classroom assignments with opt-in progress sharing, an admin console, a local-first insights page
that sends nothing anywhere, and a PWA with an offline fallback.

---

## What is deliberately not done

This section is the honest half of the README. None of these is a bug report.

- **Nothing has ever been deployed.** CI, three Dockerfiles and a Compose file exist and have
  never run: no image in this repository has ever been built, because the environment it was
  written in has no Docker daemon and the repository has never been pushed.
- **The Supabase RLS policies have never run against a live project.** `supabase/*.sql` is
  written and reviewed, not executed. The `anon` key is public by design, so RLS is the only
  thing between a browser and the data — and today the load-bearing control is the
  application-layer check in `apps/web/lib/orgs/access.ts`. Run the schema on a throwaway
  project and test it as an ordinary signed-in user before you enable accounts.
- **Re-running `supabase/schema-orgs.sql` deletes every unclaimed invite.** Deliberately: the old
  token scheme was forgeable and hashing those tokens would preserve keys an attacker can
  compute. Export pending invitations first. See `docs/DEPLOYMENT.md` § 5.2.
- **`services/api` is unauthenticated on its own port** and must stay off the public internet, or
  carry `API_SHARED_SECRET`. It executes user-supplied circuits and can spend IBM/Braket credits.
  The Next proxy is the enforcement point.
- **The lifecycle email that a product like this usually has does not exist**, on purpose: there
  is no consent record, no working unsubscribe and no scheduler. Sending nothing is better than
  sending to an address that did not ask. See `docs/ONBOARDING.md`.
- **A cohort is an organisation.** One Team or University licence is one cohort; a department
  running four classes off one licence cannot separate them. See `docs/CLASSROOM.md`.
- **A hardware job that returns 2xx with no usable `job_id`** keeps its usage row and is
  unpollable. Logged, not handled.
- **Three visualizations are unlisted and unlinked** (above), and `docs/RESPONSIVE.md` § 3 lists
  the phone-width defects that are known and still open.
- **`.env.example` is missing seven variables the code reads.** `BILLING_RECONCILE_SECRET`,
  `HEALTH_DEEP_TOKEN`, `UPSTASH_REDIS_REST_URL`/`_TOKEN` (and the `KV_REST_API_*` aliases),
  `BRAKET_S3_BUCKET`/`_PREFIX`, `NEXT_PUBLIC_SENTRY_RELEASE` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT`
  are all read by shipped code and absent from the file that claims to be the authoritative list.

---

## The three services

| Path | What it is | Needs |
| --- | --- | --- |
| `apps/web` | Next.js 16 App Router: 100 pages, 61 route handlers, the simulator, the course, the visualizations, the tutor endpoint and every entitlement gate | Node 18.17+ |
| `services/api` | FastAPI + Qiskit Aer + PennyLane. Executes OpenQASM 3, transpiles, estimates cost, submits to and polls real hardware | Python 3.11, **optional** |
| `services/agent` | LangChain tool-calling agent over Gemini, Groq, Anthropic or Azure OpenAI (LiteLLM, cheapest-first), thirteen tools, TF-IDF retrieval over the course | Python 3.11, **optional** |

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) has the diagrams: what talks to what, the
entitlement path from a click to a server refusal, the hardware submission chain, the tutor's
three-tier degradation and the data model.

### Optional: `services/api` (port 8000)

```bash
cd services/api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Interactive docs at <http://localhost:8000/docs>. See
[`services/api/README.md`](services/api/README.md).

### Optional: `services/agent` (port 8001)

```bash
cd services/agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn agent.server:app --reload --port 8001
```

See [`services/agent/README.md`](services/agent/README.md).

`./scripts/setup.sh` (bash) or `.\scripts\setup.ps1` (PowerShell) does the env files and both
venvs in one pass.

---

## How the physics works

All of it lives in [`apps/web/lib/quantum.ts`](apps/web/lib/quantum.ts) — **zero dependencies**.
Complex arithmetic, every standard gate, controlled gates, SWAP and Toffoli, Bloch vectors,
reduced-density-matrix entanglement entropy, measurement collapse, shot sampling with a seeded
`mulberry32` PRNG, and OpenQASM 3 import/export.

**Representation.** An *n*-qubit state is 2ⁿ complex amplitudes in a flat `Float64Array` of
`[re, im]` pairs. **Qubit 0 is the least significant bit**: basis index `i` has qubit `q` set when
`(i >> q) & 1 === 1`. Bitstring labels print **MSB-first** (`q_{n-1} … q_1 q_0`) so histogram keys
line up with Qiskit's display convention. See
[ADR-0003](docs/adr/0003-qubit-0-is-the-lsb-with-msb-first-labels.md).

Verified, not asserted — these are assertions in `vitest run`:

- A Bell state gives exactly 50/50 on `|00⟩` and `|11⟩`, entanglement entropy `1.0`.
- Two-qubit Grover finds `|11⟩` with probability `1.0`.
- Teleportation moves an `RY(π/3)` state onto qubit 2, giving `P(1) = 0.25`.
- QASM export → import round-trips bit-exactly.
- `lib/quantum.crosscheck.test.ts` pins this module's output against Qiskit and PennyLane
  through fixtures generated by `services/api/tests/test_js_crosscheck.py`.
- `services/api/tests/test_js_extended_crosscheck.py` runs the real module in Node on random
  circuits of 2–16 qubits — U3, √X, Fredkin, multi-controlled X, custom 2×2/4×4 matrices, X/Y/Z
  and anti-controls, controlled QFT, modular arithmetic — and requires every amplitude of the
  exported QASM to match Qiskit to 1e-9. CI installs Node in the API job so these run, and
  `test_js_bridge_available.py` fails the job rather than skipping if they cannot.

---

## Documentation map

**Engineering documentation site:** https://docs.qubit16.ai/ — architecture, the simulator engine and its verification, security, testing, deployment and engineering practices, built from `website/` by `.github/workflows/pages.yml`.

Read [`STATUS.md`](STATUS.md) first — what runs, what just closed, what is knowingly open.

| Doc | For |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The diagrams and the data model |
| [`docs/adr/`](docs/adr/) | Decision records — the non-obvious calls and the failures that motivated them |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Every suite, every trap, the design rules |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel + Railway, or one box with Compose |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Health endpoints, error shape, error tracking, CI |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, the pre-production checklist |
| [`docs/BILLING.md`](docs/BILLING.md) · [`docs/THEMING.md`](docs/THEMING.md) · [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) · [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) | Subsystem detail |
| [`docs/ANALYTICS.md`](docs/ANALYTICS.md) · [`docs/PWA.md`](docs/PWA.md) · [`docs/SEO.md`](docs/SEO.md) · [`docs/RESPONSIVE.md`](docs/RESPONSIVE.md) | Surfaces |
| [`docs/ANDROID.md`](docs/ANDROID.md) | The Android app (`apps/android/`) — a Trusted Web Activity, why, and what is left to publish |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) · [`services/api/docs/`](services/api/docs/) · [`services/agent/docs/RAG.md`](services/agent/docs/RAG.md) | Hardware, jobs, PennyLane, retrieval |
| [`docs/CLASSROOM.md`](docs/CLASSROOM.md) · [`docs/ONBOARDING.md`](docs/ONBOARDING.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md) | Product surfaces and what is next |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
