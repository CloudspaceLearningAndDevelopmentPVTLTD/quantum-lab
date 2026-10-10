# Roadmap

Checked items exist in the repository today and were verified against the code, not against the
previous version of this file. Everything unchecked is planned.

**This file was badly out of date and has been rewritten.** It listed accounts, Stripe billing,
real hardware submission, org licensing, certifications and an async job surface as unstarted; all
six ship. Treat the phase headings below as history, not as a plan you are still inside.

---

## Phase 1 — Foundation

The free product that earns the audience. **Complete on the product side.**

- [x] Double-slit — sinc²·cos² intensity pattern with single-particle impact sampling
- [x] Superposition & measurement
- [x] Bloch sphere (three.js)
- [x] Entanglement
- [x] Quantum tunneling — live time-dependent Schrödinger integration, staggered leapfrog,
      absorbing boundaries
- [x] Grover, QFT and decoherence visualizations (eight listed in total)
- [x] Zero-dependency statevector simulator (`apps/web/lib/quantum.ts`, 807 lines), verified
      against Bell / Grover / teleportation / QASM round-trip **and cross-checked against Qiskit
      and PennyLane** through a shared fixture
- [x] Circuit simulator UI — gate grid with a real keyboard path, step-through execution, shot
      sampling with a noise model, state inspector with amplitudes and entanglement entropy
- [x] OpenQASM 3 import and export, with exact π fractions
- [x] AI tutor with an offline answer set so it works with no API key
- [x] Optional FastAPI execution service with a multi-vendor backend registry
- [x] Optional LangChain + Claude tool-calling agent
- [ ] YouTube channel launch — one video per visualization, using the live sims as the visuals
- [x] Email list capture on the site — the consent/unsubscribe prerequisites shipped in Phase 14
      (double opt-in, hashed tokens, durable opt-out; see that section's honesty note about the
      never-run schema)
- [ ] Free 7-day email course — capture and consent exist; the **scheduler/sender does not**, and
      per Phase 14's note it must refuse the non-durable in-memory consent store
- [ ] Public launch: Hacker News, r/QuantumComputing, physics education communities

## Phase 2 — Monetization

**Built, and never run against a live Stripe account or Supabase project.**

- [x] Paid course — fifteen lessons, seven of them the paid advanced track, gated server-side
- [x] Accounts and auth (Supabase, magic link)
- [x] Saved circuits (`public.circuits`) and shareable permalinks that carry the circuit in the URL
- [x] Simulator: 16 qubits on every plan, signed in or not (was free 5 / Pro 12 / Team 16 until
      2026-10-09), from `lib/plans.ts`
- [x] Real IBM Quantum / Braket / Azure submissions wired through the UI, behind an authenticated,
      entitlement-checked, quota-reserving proxy
- [x] Stripe billing, plans, webhook and customer portal
- [x] Usage analytics — local-first, computed in the browser, with server ingestion off by default
- [ ] **The Stripe integration has never processed a real payment.** No Stripe account, no webhook
      delivery, no test event. `docs/DEPLOYMENT.md` § 6 and § 9.2 are the checklist.
- [ ] **The Supabase RLS policies have never run.** Until they do, `lib/orgs/access.ts` is the
      control. Item 1 of the pre-production checklist in `docs/SECURITY.md`.
- [ ] YouTube monetization
- [ ] Sponsorships from quantum SDK and hardware vendors

## Phase 3 — Scale

Mostly built. What is left is operational rather than architectural.

- [x] Seat-based licensing — orgs, roles, invites, an admin console, an instructor console
- [x] Classroom — assignments, completion tracking, CSV export for a gradebook, and opt-in
      per-org progress sharing (`docs/CLASSROOM.md`)
- [x] Advanced track — Shor, error correction, VQE/NISQ, quantum cryptography
- [x] Certifications — two exams, a 103-question pool, **server-graded** attempts with a server
      clock, and publicly verifiable certificates at `/verify/<id>`
- [x] Async job surface on `services/api` — `POST /api/jobs` → `202 { job_id }`, poll, list, stats,
      cancel
- [x] Per-account hardware quotas, counted over the **subscription** month, reserved atomically by
      a `security definer` function
- [ ] **A durable job store.** Without `REDIS_URL` the store is a bounded in-process dict: jobs are
      lost on restart and invisible to other replicas. Redis is in the `queue` Compose profile and
      off by default. The trigger to turn it on is a second replica.
- [ ] Mobile app
- [ ] Cohort programs with live sessions
- [ ] Per-class cohorts within one licence — today a cohort *is* an org

---

## Phase 14 — Ten features in parallel (2026-08-25)

Ten agents built with disjoint file ownership; everything below was integrated and verified in one
sweep: `tsc --noEmit` clean, 54/54 vitest files (1001 tests), `next build` clean (88 app routes),
`services/agent` 97/97, `services/api` 177/177, `mobile.spec.ts` 27/27 (mobile) +
`exam.spec.ts` 6/6 (chromium).

- [x] **MCP server** — `/api/mcp/[transport]` (Streamable HTTP) exposing seven tools over the
      existing simulator/challenge/lesson code (`lib/mcp/server.ts`): run QASM with sparse
      labelled amplitudes, per-step statevectors, challenge grading, lessons (free bodies only —
      the paid-body module is never queried), gate reference. Hardware submission is the
      documented out-of-scope next step (needs auth/billing at the MCP boundary).
- [x] **Spaced repetition** — `/review` page backed by a pure SM-2-lite scheduler
      (`lib/review/scheduler.ts`, injected clock, localStorage-persisted), seeded from existing
      quiz scores; due-count util covers free quizzed lessons only.
- [x] **Hardware topology + transpile sequence** — device-family schematic
      (`components/hardware/DeviceTopology.tsx`, explicitly captioned as a schematic, not a live
      calibration map), transpiled gate-sequence parser, and the Pro quota bonus-unlock
      (threshold 50, +25) with tests on both sides of the API.
- [x] **Open Badges + missing analytics events** — public
      `/api/certificates/[id]/badge` serving an OB 3.0-style `OpenBadgeCredential` (rate-limited;
      structurally cannot leak score/attempts/userId), plus deduped `circuit.built` and
      `viz.interacted` emitters that were previously never fired.
- [x] **Phase-disk strip** — per-qubit reduced-density-matrix disks (`lib/quantum-phase.ts` +
      `components/circuit/PhaseDiskStrip.tsx`): area ∝ P(|1⟩), needle = relative phase, ring
      opacity = purity; theme-aware per ADR-0007, each disk screen-reader labelled.
- [x] **Tutor retrieval fix** — `_course_hits_as_concepts` in `services/agent/agent/knowledge.py`
      now merges up to 3 sibling chunks per routed lesson (preferring the keypoints chunk) instead
      of keeping one chunk per lesson. Measured: retrieval eval 16/25 → **21/25** (mean coverage
      81% → 93%), routing still 25/25, misconceptions 0/25. Honest residual: 4/25 questions still
      fall short of full coverage — a content/chunking question, not a routing one.
- [x] **Tutor debug-loop tools** — `inspect_statevector` (per-gate-prefix exact states, ≤20 steps /
      ≤12 qubits) and `diff_circuits` (structural QASM diff, positions aligned with inspect steps)
      in `services/agent/agent/tools.py`; all failures return `{"error": ...}`, never raise.
- [x] **Email consent + double opt-in** — `supabase/schema-email.sql` (`email_subscriptions`,
      RLS with no policies — service-role only), token-hash-only consent store with a state
      machine where a stale confirm link can never undo an opt-out, and rate-limited
      subscribe/unsubscribe routes with no address-probing oracle. This closes the consent /
      unsubscribe / durable-suppression prerequisites `docs/ONBOARDING.md` set for the Phase 1
      email items. Same honesty note as billing: the schema has **never been run against a live
      Supabase project**, and the in-memory fallback store is a demo any future sender must
      refuse.
- [x] **Lesson depth toggle** — per-section "Explain this differently" (Simpler / More
      mathematical) riding the existing `/api/agent` levels; probes tutor tier once per lesson and
      says so honestly when only the offline FAQ tier is live.
- [x] **Hygiene sweep** — the visualization catalogue moved to `lib/visualizations.ts` (the
      offline page had drifted to 8 of 11 entries), dead onboarding code deleted per
      `docs/ONBOARDING.md`'s own instruction.

---

## Phase 15 — Fourteen features in parallel (2026-08-25)

Thirteen build agents plus an MCP-extension agent, disjoint file ownership, integrated and
verified in one sweep: `tsc --noEmit` clean, 71/71 vitest files (**1203** tests), `next build`
clean (**97** app routes, up from 88 — `/compete`, `/embed/circuit`, `/visualizations/qec-duel`,
`/api/hooks`, `/api/tools`, `/api/compete`, `/api/email/dispatch`, `/api/email/unsubscribe/course`
among the new ones), `services/agent` **135/135**, `services/api` **187/187**, `mobile.spec.ts`
**29/29** (mobile — the 27 prior cases plus overflow guards for the two new pages),
`exam.spec.ts` 6/6 (chromium). `/compete` and `/visualizations/qec-duel` were added to the fixed
route lists in `a11y.spec.ts` and `mobile.spec.ts` the same way `/coach` was, and the 14 new
parameterised checks all pass.

- [x] **Problem generation** — `lib/challenges/generate.ts`: deterministic
      `(kind, difficulty, seed)` practice challenges in three kinds (target-state,
      target-distribution, fix-the-bug), each **verified solvable by execution** before it is
      returned (reference solution passes, empty circuit fails, par is tight); surfaced as
      "Practice more like this" on challenge pages and as the `generate_challenge` MCP tool.
- [x] **Webhooks + REST facade** — `lib/integrations/webhooks.ts`, `/api/hooks` (register/list/
      delete, HMAC-signed deliveries, SSRF hostname guard with its limitation stated in
      `docs/INTEGRATIONS.md`), `/api/tools` (REST facade over the MCP tool set). Honest gaps,
      documented: without a Supabase service role, registrations are in-memory
      (`durable: false` in every response); `challenge_completed` is **declared but never fires**
      — completion is a client-side localStorage claim, and firing a webhook from a forgeable
      claim was refused. It waits on a server-side completion record.
- [x] **Embed widget** — `/embed/circuit` + `public/embed.js`: an unauthenticated, locally
      simulating circuit widget for third-party pages. The CSP exception was **not declined — it
      shipped, narrowly**: `frame-ancestors` gains allowlisted origins (`NEXT_PUBLIC_EMBED_ANCESTORS`,
      default nobody, `*` dropped as malformed) on `/embed/*` routes only; `X-Frame-Options:
      SAMEORIGIN` stays global, so legacy browsers without `frame-ancestors` support fail strict
      (blank frame). All inbound `postMessage` traffic goes through a strict typed parser.
      `docs/EMBED.md` has the full posture.
- [x] **Quirk-mode live simulation** — `components/circuit/ColumnProbe.tsx` + `lib/column-probe.ts`:
      per-column live probability readout in the simulator, recomputed as gates are placed, in the
      spirit of Quirk's always-on displays.
- [x] **Q-sphere** — `components/circuit/QSphere.tsx` + `lib/qsphere-layout.ts`: latitude-by-
      Hamming-weight Q-sphere state view with per-node amplitude/phase, alongside the existing
      inspector.
- [x] **Notebook export** — `lib/export/notebook.ts`: circuits export as runnable Qiskit/PennyLane
      `.ipynb` notebooks (also exposed as the `export_notebook` MCP tool).
- [x] **Run-this-paper agent tools** — `services/agent/agent/paper.py`, an honest MVP:
      `fetch_arxiv` (bounded, injection-fenced abstract fetch) and `protocol_hints` (pure keyword
      scan mapping an abstract onto the named ≤16-qubit protocols this product can actually
      simulate, each with a ready-to-run QASM template; says so plainly when nothing matches).
      This does not "reproduce arbitrary papers" — it spots the runnable ones. Tests in
      `test_paper_tools.py`.
- [x] **Session planner** — `lib/coach/sessionPlan.ts`: progress snapshot → structured study plan,
      shared between the `/coach` page and the stateless `get_session_plan` MCP tool.
- [x] **Weekly competition + leaderboard** — `/compete` + `/api/compete` + `lib/compete/*`:
      seeded weekly circuit golf, server-side grading, best-only entry per account,
      `competition_leaderboard` view exposing display name/gates/time only. Honest gaps: without
      a service role the store is an in-process Map (`durable: false`, and the page says so), and
      `supabase/schema-competitions.sql` — like every schema file in this repo — has **never been
      run against a live Supabase project**.
- [x] **QEC decoder duel** — `/visualizations/qec-duel` (`components/viz/QECDuelLab.tsx`,
      `viz/qec/decoderDuel.ts`): repetition-code decoder race with a tested pure core.
- [x] **Backend fit estimates** — `services/api/app/quantum/calibration.py` + `lib/hardware/
      fitEstimate.ts` + `DevicePicker`: static calibration-table fit estimates per device with the
      `docs/HARDWARE.md` honesty rules (three-state `ok/estimate/unavailable`; no numbers invented
      for unknown devices — these are typical figures, not live calibration).
- [x] **Email scheduler + 7-day course** — `lib/email/courseSchedule.ts`, `courseTemplates.ts`,
      `courseDispatch.ts`, `/api/email/dispatch` (secret-gated, external-cron-driven, bounded
      batches) riding Phase 14's double-opt-in consent store. Honest by construction: with no
      `RESEND_API_KEY` nothing is claimed sent (`configured: false`), the in-memory subscription
      store refuses to drive real sends, and unsubscribe is honoured before every send per
      `docs/ONBOARDING.md`'s prerequisites.
- [x] **Tutor content fixes** — `services/agent/agent/knowledge.py` content additions closing the
      Phase 14 residual: offline eval now **25/25 passed, 0 declined** (was 22/25 with 3 declines)
      — measured, see `docs/TUTOR.md`.
- [x] **MCP extensions** — `lib/mcp/server.ts` grows `generate_challenge`, `get_session_plan`,
      `export_notebook`, and `submit_hardware_job` (the first async, authenticated tool — bearer
      token forwarded to the real `/api/hardware/submit` handler; the sync REST facade refuses it
      with a pointer to the MCP endpoint). `docs/MCP.md` updated to match.

---

## Phase 16 — Nine features in parallel (2026-08-26)

Nine build agents with disjoint ownership, integrated and verified in one sweep: `tsc --noEmit`
clean, 79/79 vitest files (**1296** tests), `next build` clean (**104** routes printed, up from
97 — `/benchmark`, `/api/orgs/classes` and `/api/orgs/classes/assignments` among the new),
`services/agent` **136/136** (`services/api` untouched this phase, not re-run), `mobile.spec.ts`
**30/30** (mobile), `exam.spec.ts` **6/6** (chromium), `a11y.spec.ts` **129 passed / 1 skipped**
(chromium, the skip pre-existing). `/benchmark` was added to the fixed route lists in
`a11y.spec.ts` and `mobile.spec.ts` the same way `/compete` was in Phase 15.

- [x] **GCP deploy kit** — `docs/DEPLOYMENT-GCP.md` + `cloudbuild.yaml` + `.gcloudignore`:
      paste-along Cloud Run deployment for all three services (per-service resources, env-var
      tables, Secret Manager, two-pass web build, domain mapping, cost table). **Operator-only,
      never executed**: every `gcloud` step is marked [UNVERIFIED] in the doc itself, no image
      has been built on Cloud Build, and nothing has been deployed. Documentation, not a record.
- [x] **Stripe test harness** — `docs/STRIPE-SETUP.md` + `scripts/stripe-smoke.mjs`: test-mode
      product/price setup mapped to the four `STRIPE_PRICE_*` env names, `stripe listen` webhook
      flow, expected DB rows, one `stripe trigger` per handled event. **Operator-only, never run
      against a real Stripe account** — it waits on someone with an sk_test_ key.
- [x] **QML lesson** — `quantum-machine-learning` joins the advanced track (now **five** lessons,
      **12** total): encoding-is-the-model, barren plateaus, a runnable classifier with honest
      accuracies, exam pool questions, coach-graph/search/review integration. The paywall picked
      it up automatically (`ADVANCED_SLUGS` is derived). Agent curriculum updated to match.
- [x] **QAOA lesson** — `qaoa-and-optimization` joins the advanced track (now **six** lessons,
      **14** total): MaxCut-to-Ising encoding, the alternating cost/mixer ansatz, the p-depth
      trade-off and fixed-p locality obstructions, why quantum-optimisation advantage remains
      unproven as of 2026 (the LABS scaling study stated at its own valuation), and the
      barren-plateau link to `/visualizations/vqe`. Prerequisite `vqe-and-nisq`; paywall picked
      it up automatically; coach-graph/search integrated. Taught, **not yet examined** — the
      advanced cert pool has no QAOA items, so the slug sits in `UNEXAMINED_SLUGS` in
      `lib/exams/questions.test.ts` until the exam bank writes them. Agent curriculum
      (`services/agent`) was NOT updated in this phase — caught by
      `test_curriculum_mirror_has_not_drifted` and closed in Phase 17.
- [x] **Question-first advanced track** — all six advanced lessons now carry 2-3 `inline-check`
      blocks at real predict moments (Shor and error correction have 3 each), same block and
      gating as the converted foundations lessons.
- [x] **Self-attested completion cards** — `lib/completionCard.ts`: downloadable track-completion
      SVG that says, on the card itself, "Self-reported … not a verified credential." Deliberately
      **not** an Open Badge: the server cannot honestly attest local-first progress, so verifiable
      assertions stay exam-only.
- [x] **Question-first inline checks** — new `inline-check` lesson block (`lib/lessons/types.ts`,
      `lib/lessons/inlineCheck.ts`, `components/lesson/InlineCheck.tsx`): predict-before-reveal
      gating with a "show me anyway" escape hatch. Honest partial: **one lesson converted**; the
      other eleven still teach exposition-first until someone does the editorial pass.
- [x] **Agent benchmark harness** — `scripts/agent-bench.mjs` + `lib/bench/*` + `/benchmark` +
      `docs/BENCHMARK.md`: runs a model against the real challenge grader (22 catalogue + seeded
      generated challenges, ≤2 attempts, deterministic order). Honest partial: the pipeline is
      proven end-to-end **short of a real key** — no `ANTHROPIC_API_KEY` has been supplied here,
      so `/benchmark` currently renders with no recorded runs.
- [x] **Multi-week learning plan** — `lib/coach/weeklyPlan.ts` on `/coach`: clock-injected,
      non-destructive re-planning weeks of 2–4 items from the concept graph; ticks derive from
      evidence only and are monotone. No calendar urgency, per `docs/ONBOARDING.md`.
- [x] **Per-class cohorts** — `supabase/schema-orgs.sql` (additive: `org_classes`,
      `org_class_members`, nullable `org_assignments.class_id`), `lib/orgs/*`, two new API routes,
      instructor UI. Deleted class's assignments fall back to whole-licence. Same standing caveat
      as every schema file: **never run against a live Supabase project**, RLS untested live.
- [x] **Launch content kit** — `launch/*.md` (HN, Reddit, YouTube scripts, "quantum in a week"),
      kept **outside the repo** deliberately; every claim was written against code with pointers.
      One count already went stale in this same phase: the HN post says "11-lesson course" and the
      QML lesson makes it 12 — flagged, to be fixed at posting time along with a fresh re-verify.

Still true after this phase, and worth repeating: deploy, Stripe, and Supabase live runs are
**operator-only work this environment cannot perform** — the kits above shorten that work but do
not substitute for it.

---

## Phase 17 — Content fan-out: six agents on lessons, exams, challenges, tutor, scripts (2026-08-27)

Six content agents with disjoint ownership, integrated and gated in one sweep. What shipped:

- [x] **`inside-a-quantum-computer`** — new **free** foundations lesson (the eighth): transmon
      from LC-oscillator-plus-Josephson-junction, gates as shaped microwave pulses (virtual Z
      free), the millikelvin argument (5 GHz ⇒ hf/k_B ≈ 240 mK; ~17 thermal photons at 4.2 K;
      e⁻¹⁶ ≈ 10⁻⁷ at 15 mK — numbers re-derived during integration, they check out), dispersive
      readout, and an honest transmon-vs-trapped-ion comparison. Taught, **not examined**
      (`UNEXAMINED_SLUGS`).
- [x] **`qaoa-and-optimization`** — new paid advanced lesson (the sixth; see the Phase 16 bullet
      above for content). Its p=1 five-cycle numpy example was re-executed during integration:
      printed values (E[cut] 2.5→3.75, P(best) 0.312→0.879) reproduce exactly. Still in
      `UNEXAMINED_SLUGS` — the exam bank wrote QML items this phase, not QAOA items.
- [x] **Question-first foundations track** — six foundations lessons converted to the
      `inline-check` predict-first format, and `bodies/tunneling.ts` gained checks in the same
      pass (the advanced track was converted in Phase 16). Every lesson in the course now gates
      its payoff sections behind a commit-or-skip check.
- [x] **9 QML exam questions** — `a37`–`a45` in `lib/exams/questions.ts`, all against the
      `quantum-machine-learning` lesson: pool now **103** (f01–f58 + a01–a45). Three spot-checked
      against the lesson text during integration (a39 amplitude-encoding costs, a44 data
      re-uploading circuit — RY algebra verified by hand, a45 Tang dequantisation): no physics
      errors found.
- [x] **8 new advanced challenges** — challenge catalogue now **30**.
- [x] **6 new tutor topics** — `services/agent/agent/knowledge.py` + `apps/web/app/api/agent/offlineFaq.ts`;
      eval set grown 25 → **31** questions and re-measured: **31/31 passed, 0 declined, 0 failed**
      (re-run during integration via `eval/offline_probe.mjs`, not trusted from the agent's
      self-report; per-topic numbers in `docs/TUTOR.md`, dated 2026-08-27).
- [x] **9 YouTube scripts appended** — `launch/youtube-scripts.md` now carries **12 of 12**
      planned video scripts.

Integration fixes (the gaps between six agents' local views and one tree):

- `services/agent/agent/curriculum.py` — the Python lesson mirror was missing both new lessons;
  caught by `test_curriculum_mirror_has_not_drifted` (exactly the failure that test exists for),
  both entries added. `QUIZ_BANK` in `agent/tools.py` gained three-question banks for both new
  slugs (its coverage test is parametrised over `curriculum.LESSON_SLUGS`, so adding the mirror
  entries made the missing banks fail loudly too), plus `_QUIZ_ALIASES` entries (transmon, qaoa,
  maxcut, …).
- `tests/e2e/learning.spec.ts` could no longer load: its deliberate Node-side import of
  `lib/lessons/server.ts` hits the `server-only` marker's unconditional throw (pre-existing at
  HEAD, surfaced now because this phase's gate actually ran the spec). Fixed with
  `tests/e2e/neutralizeServerOnly.ts` — a require-cache stub scoped to the Playwright process,
  equivalent to what the `react-server` resolution condition hands back; the guard in the real
  app bundle is untouched and still covered by the raw-document paywall assertions.
- Two `learning.spec.ts` cases assumed quiz/embed blocks are visible on page load; the
  question-first conversion gates them behind inline checks. The spec now skips through the
  gates via the card's own "Show me anyway" escape hatch (`revealGatedBlocks`).

Counts after this phase: **14 lessons** (8 free foundations, 6 paid advanced), **30 challenges**,
**103-question** certification pool, **31-question** tutor eval at 31/31, **12/12** video
scripts. Two lessons taught-but-unexamined (`inside-a-quantum-computer`, `qaoa-and-optimization`)
— tracked in `UNEXAMINED_SLUGS`, which is the honest ledger for that gap, not a workaround.

Gates, all run in this tree, none inherited from agent self-reports: `tsc --noEmit` clean,
vitest **79/79 files, 1333/1333**, `next build` clean (106 route lines printed, up 2 from
Phase 16), `services/agent` pytest **138/138**, Playwright `mobile.spec.ts` **30/30** (mobile),
`exam.spec.ts` + `a11y.spec.ts` **135 passed / 1 skipped** (chromium, the skip pre-existing),
`learning.spec.ts` **11/11** (chromium).

---

## The actual next things

Ordered by value, and each one is a real, named, currently-open item rather than a feature idea.

1. ~~**Deploy it once.**~~ **Done (October 2026):** qubit16.ai runs on Azure Container Apps,
   images are built in Azure Container Registry, CI runs on every push, and CD deploys every
   green `main` build through OIDC. The AWS and GCP kits remain [UNVERIFIED].
2. **Run the schema on a throwaway Supabase project and test RLS as an ordinary signed-in user.**
   The `anon` key is public by design; RLS is the only thing between a browser and the data.
3. **Set a shared rate-limit store.** `UPSTASH_REDIS_REST_*` or `KV_REST_API_*`. Without it, every
   limiter on a money-spending route is per-instance, which on a serverless platform is close to no
   limit.
4. ~~**Regenerate `.env.example`.**~~ **Resolved 2026-08-25 — verified:** it now documents
   `HEALTH_DEEP_TOKEN`, `BILLING_RECONCILE_SECRET`, `NEXT_PUBLIC_SENTRY_RELEASE`,
   `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, and the `UPSTASH_REDIS_REST_*` / `KV_REST_API_*` shared
   rate-limit pair, each with a comment on what reads it and what happens when it's unset. (Setting
   those variables in a real deployment is still item 3, below — unchanged.)
5. ~~**Link or delete the three orphaned visualization routes.**~~ **Resolved 2026-08-25 —
   verified:** `/visualizations/shor`, `/visualizations/surface-code`, and `/visualizations/vqe`
   all build, and are linked from `components/ui/Hero.tsx` and `components/viz/LazyViz.tsx` (also
   reachable via `/offline`, the lesson bodies, and search corpus) — confirmed by grep and by a
   clean `next build`.
6. ~~**Emit `isAccessibleForFree: false` and `offers` on the advanced course.**~~ **Resolved
   2026-08-25 — verified:** `components/seo/schema.ts`'s `courseSchema` already does this
   correctly (`isAccessibleForFree: false`, no `offers`, for the advanced track; `isAccessibleForFree:
   true` with a real `$0` `Offer` for foundations), and two new cases in
   `lib/lessons/access.test.ts` pin it down — both pass under `vitest run`.
7. ~~**Add `import 'server-only'` to `lib/lessons/server.ts`.**~~ **Resolved 2026-08-25 —
   verified:** the import is in, `server-only` is now a real dependency in
   `apps/web/package.json`, and — because Vitest doesn't apply webpack's `react-server` export
   condition — `vitest.config.ts` now aliases `server-only` to its own empty module so the four
   test files that legitimately import `lib/lessons/server` (`access`, `bundle`, `lessons`,
   `search/corpus`) keep passing instead of hitting the package's client-side throw. All 43 test
   files / 864 tests pass; `next build` and `tsc --noEmit` are clean.
8. ~~**Fix the phone-width defects in `docs/RESPONSIVE.md` § 3.**~~ **Resolved 2026-08-25 —
   verified.** All eight defects §3 listed are fixed and each has a passing regression test —
   see `docs/RESPONSIVE.md` §3 for the current, doc-matches-code account of each. The two gaps
   noted in the prior pass are also closed: `/instructor`'s overflow turned out to already be
   fixed (a Phase 10 `Controls.Segmented` fix it inherited) and is now in `mobile.spec.ts`'s
   `OVERFLOW_ROUTES`; `/certify/[examId]` now has a dedicated phone-width case in `mobile.spec.ts`
   (it previously had only desktop coverage via `exam.spec.ts`). `mobile.spec.ts` is now 27/27
   passing under the `mobile` Playwright project (26 from the prior pass plus this new case).
9. ~~**Dependency vulnerabilities requiring a major-version bump.**~~ **Resolved 2026-08-26 —
   verified.** `next` 14.2.35 → **16.3.2**, `react`/`react-dom` 18.3.1 → **19.2.8**, `@sentry/nextjs`
   8.42.0 → **10.71.0** (the only version line whose `peerDependencies` declares Next 16 support).
   The PostCSS and Rollup high-severity findings that motivated this are gone from the production
   tree (`npm audit --omit=dev`: 29 → 4, and the 4 remaining — `@supabase/auth-js` low,
   `playwright` high — are pre-existing and unrelated). A third instance of the same PostCSS CVE
   family, a direct `apps/web` devDependency separate from the copies `next` and `@sentry/nextjs`
   bundle, was also bumped (8.4.47 → 8.5.26) once found during verification.
   The breaking-change surface was the async request APIs (`cookies()`/`headers()`/`draftMode()`
   and every `params`/`searchParams` prop becoming Promise-based) — this app has none of the
   former (auth is Supabase bearer tokens, not cookies/middleware) and 15 files needed the latter,
   all mechanical. `middleware.ts` was renamed to `proxy.ts` per Next 16's convention (the built
   output file is still `.next/server/middleware.js`, so `docs/DEPLOYMENT.md` and `lib/env.ts`'s
   existing references to that path remain correct — verified by inspecting the build output, not
   assumed). One `opengraph-image.tsx` needed `runtime: 'edge'` → `'nodejs'` (Next 16 no longer
   allows edge runtime under a segment with `generateStaticParams`). Full gate sweep, run
   independently rather than trusted from a self-report: `tsc --noEmit` clean, 43/43 vitest files
   (864/864 tests), `next build` clean (74/74 pages, no route dropped), `mobile.spec.ts` +
   `exam.spec.ts` 33/33 across both Playwright projects.
   Separately: this app has **no CSP nonce**, and that is a *documented, deliberate* choice, not an
   oversight — `apps/web/lib/security/headers.ts`'s header comment already lays out why (static
   prerendering makes a per-request nonce impossible without moving the whole app to dynamic
   rendering) and the trade-off is tracked as item 12 of `docs/SECURITY.md`'s pre-production
   checklist. Checked against current Next.js docs and the relevant nonce CVE
   (GHSA-ffhc-5mcf-pf4q, App Router nonce reflection, fixed in 15.5.16/16.2.5) before writing this:
   the existing reasoning already matches current guidance and the CVE doesn't apply here (this
   app carries no nonce to begin with). No change made — recorded so the next person doesn't
   re-research the same question.

---

## Not doing yet

Deliberately deferred. Each is a real idea that would cost more than it returns today.

- **A custom LMS.** Progress tracking, quizzes and cohort tooling are a product on their own.
- **Lifecycle email.** Not a missing feature — a decision, with the three prerequisites spelled out
  in `docs/ONBOARDING.md`. Building a sender without a consent record, a working unsubscribe and a
  suppression list that outlives a redeploy is how a product ends up mailing people who never
  asked, with no way out.
- **Mobile-first design.** The gate grid and the state inspector need horizontal room and the
  audience is on laptops. The site is responsive and usable on a phone; making phones the primary
  target would compromise the desktop experience people actually learn on.
- **A Celery/Redis worker tier.** The async *shape* exists and every backend reachable without
  credentials returns in under a second. A broker and a worker process buy nothing until there is
  more than one replica.
- **Server-side lesson progress.** Progress is local, `/insights` computes every number in the
  browser, and course progress reaches an organisation only through an explicit, revocable,
  per-org grant. Reversing that is a product decision, not a feature.
