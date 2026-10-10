# Handoff — qubit16.ai, 17 September 2026

Written for whoever picks this up next, human or agent. Read
`docs/COMPETITIVE-GAPS.md` and `docs/PLAN-BEST-IN-CLASS.md` for the strategy;
this file is the operational state and the next actions.

---

## 1. What is live and verified

Deployed to Azure Container Apps (`quantum-lab-rg`, ACR `quantumlabacr14409`).

* Vendor SDKs ship in the API image. Devices now report *"needs a token"*, not
  *"SDK not installed"* — the whole hardware path was unreachable before.
* IBM addressed by CRN, cached service, `optimization_level` threaded from the
  page through to submission, dynamical decoupling and readout twirling.
* Estimator (expectation values), runtime sessions, parameter sweeps.
* Scoped API keys, durable job history, run permalinks, spend controls,
  device recommendation, resource estimation, cross-run comparison, reconciler.
* `packages/qubit16-python` — Qiskit-compatible provider.
* Palette derived from real hardware (`scripts/derive-theme.mjs`).
* Promotion: free until **2027-01-01** for every signed-in account.

---

## 2. ~~THE BLOCKER~~ — migrations applied 17 September 2026

**Reported applied by the operator on 17 Sep 2026**, via the dashboard SQL
editor, using `supabase/apply-all-migrations.sql` (all fourteen in dependency
order, idempotent throughout).

**Confirm before trusting it.** Paste `supabase/verify-migrations.sql` — it is
read-only and answers in one table. Every row must read `OK`, and the two
function rows must read `byok_exclusion_applied = true`. That second check is
the one worth actually doing: `schema-byok.sql` *replaces*
`reserve_hardware_job` and `spend_in_window`, so if migration 14 ran out of
order or errored partway, the table and column can all exist while the
functions are still the un-patched versions — in which case BYOK jobs are
recorded correctly and then counted against the monthly allowance anyway,
silently.

**What an HTTP probe does NOT prove.** `/api/credentials` and `/api/keys`
answering 401 instead of 503 is *not* evidence the tables exist:
`verifiedCallerId` runs first in both routes, so an unauthenticated request
short-circuits before the store is ever touched. The 401 proves the route is
deployed and nothing more. Only the SQL above, or a signed-in round trip
through the account panel, touches the new schema.

These are the six features that were returning **503** behind it:

| Table | Feature |
|---|---|
| `hardware_usage` result columns | job history |
| `api_keys` | programmatic access |
| `runtime_sessions` | session ownership |
| `published_runs` | citable permalinks |
| `spend_budgets` | spend caps |
| `user_provider_credentials` + `hardware_usage.credential_owner` | BYOK (§4) |

BYOK is the one partial exception: without its migration the panel answers 503
and nothing is stored, but a deployment that *has* stored credentials and then
loses the `credential_owner` column keeps running BYOK jobs on the user's own
token and merely counts them against the allowance as well, with a loud log.
The safe direction, and one migration away.

```bash
supabase link --project-ref flwyvhsmgrrqpmhcqlzd
supabase db push
```

Or paste each file in `supabase/migrations/` into
<https://supabase.com/dashboard/project/flwyvhsmgrrqpmhcqlzd/sql/new>.
Every statement is `if not exists`; re-running is a no-op.

---

## 3. Credentials — what to get, where, and what it unlocks

Set in `infra/azure/.env.production` (gitignored), then re-run the deploy.
**Everything is optional.** Each unset variable degrades one feature and the
rest of the app works.

### Tier 1 — do these first

| Variable | Where to get it | Unlocks | Cost |
|---|---|---|---|
| `IBM_QUANTUM_TOKEN` | <https://quantum.ibm.com> → sign in → API token | **Real hardware.** The single highest-value credential. | **Free** (Open plan) |
| `IBM_QUANTUM_INSTANCE` | Same console → your instance → copy the CRN | Only needed if your account has **more than one** instance. Omit it and the SDK picks one for you — which can put a job on the wrong plan and make polls answer "not found". | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` | Accounts, quotas, job history, API keys. **Already set.** | Free tier |

Verify IBM end to end:

```bash
cd services/api
python scripts/hardware_smoke.py                            # credentials + devices
python scripts/hardware_smoke.py --backend ibm_brisbane     # compile + price only
python scripts/hardware_smoke.py --backend ibm_brisbane --submit
```

### Tier 2 — other hardware vendors

| Variable | Where | Notes |
|---|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS IAM user with `AmazonBraketFullAccess` | IonQ + Rigetti. **Paid per shot.** |
| `BRAKET_S3_BUCKET` | Any S3 bucket you own | Braket writes every result there. Required. |
| `AZURE_QUANTUM_RESOURCE_ID` / `_LOCATION` | Azure portal → Quantum Workspace | Quantinuum + IonQ. Quantinuum bills in H-System Credits and **cannot be priced in dollars** — the code says so rather than reporting $0. |

### Tier 3 — product features

| Variable | Where | Unlocks |
|---|---|---|
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com → Developers | Paid plans. **Not needed until 2027-01-01** — everything is free until then. |
| `RESEND_API_KEY` / `EMAIL_FROM` | resend.com, domain verified | Email course, receipts. |
| `ANTHROPIC_KEY` / `GEMINI_KEY` / `GROQ_KEY` | Respective consoles | Live AI tutor. Offline tutor works without any. |
| `SETTINGS_ENCRYPTION_KEY` | `openssl rand -hex 32` | AES-256-GCM for admin-set provider keys **and for user-supplied ones (BYOK, §4)**. Unset, `secretBox` derives a key from the service-role key — which means rotating *that* silently invalidates every stored credential. Set it explicitly. |
| `HARDWARE_RECONCILE_SECRET` | `openssl rand -hex 32` | The job sweep. Unset = the endpoint refuses everyone and nothing reconciles. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | upstash.com | Rate limiting that survives a deploy. Without it limits are per-instance and reset on cold start — **not a control you can rely on in production.** |

---

## 4. BYOK — let users bring their own hardware credentials

**BUILT, 17 September 2026.** This section is kept as written because the
reasoning is still the specification; what follows each numbered point is what
actually shipped. `docs/BYOK.md` is the full document — user instructions,
operator setup, and what is still unproven.

### Why it matters more than it looks

Today every hardware job spends the **operator's** IBM/AWS/Azure allowance.
That is the one cost that scales with users, and it is why the monthly quota
exists at all. If a researcher supplies their **own** IBM token:

* their jobs cost qubit16 **nothing**;
* the quota stops being a limit worth arguing about for them;
* "free for everyone" becomes structurally true, not a promotion;
* a lab with its own paid IBM instance can use qubit16 as the front end for
  hardware they already pay for — which is precisely the C2 group-workspace
  customer, reached without building C2.

IBM's Open plan is free and takes about two minutes to obtain. Most of the
target audience can bring a key.

### The shape it should take — and what shipped

1. **`public.user_provider_credentials`** — one row per (user, provider).
   Store the token **encrypted at rest with AES-256-GCM**, not hashed: unlike
   an API key, this one must be *recoverable* because it is presented to the
   vendor. `lib/platform/settings.ts` already implements exactly this
   encryption for admin-set provider keys — reuse it, do not write a second one.
   RLS on, no policies, service-role only.

   > **Shipped** as `supabase/schema-byok.sql`. Reuses `secretBox.ts`
   > unchanged. Composite primary key `(user_id, provider)`, so saving is an
   > upsert and there is no version history — a superseded token is a live
   > credential, and keeping copies would mean "remove" leaves something
   > behind. Store: `apps/web/lib/security/providerCredentials.ts`.
2. **Never returns to the client.** List shows provider, a masked hint and
   `last_used_at`. Same rule as `api_keys`: shown once at entry, never again.

   > **Shipped.** The listing type has no field for a token, and a test
   > asserts the serialised listing does not contain one. The hint masks from
   > the END (`····8f2c`) because vendor tokens share a fixed prefix and
   > masking from the front would make every hint identical. `/api/credentials`
   > is session-only — an API key cannot install a vendor credential, or a
   > leaked CI key could attach the attacker's IBM token to the victim's
   > account.
3. **`/api/hardware/submit` resolves whose credential to use** — the caller's
   if present, the operator's otherwise — and passes it to `services/api` on
   that request rather than reading it from the service's environment. That is
   the real work: `app/quantum/hardware.py::_ibm_service()` currently caches
   one service per `settings.ibm_quantum_token`. Its cache key must become the
   presented token, and a per-request token must never be written into
   `settings`.

   > **Shipped**, and it was the real work as predicted. The credential travels
   > as a header (`X-Quantum-Lab-Credentials`, base64 JSON) rather than a body
   > field, because polling is a GET and a query parameter would put a live
   > token in every access log between the hop. `_ibm_service(credentials)`
   > keys its cache on the presented token and nothing is ever written to
   > `settings`; both are asserted in `services/api/tests/test_byok.py`.
   >
   > **Two things §4 did not anticipate**, both found while building:
   >
   > · **Polling needs the credential too.** A job on a user's own token is
   >   invisible to the operator's token, so a BYOK job polled with the wrong
   >   one reports "not found" forever. The poll keys on
   >   `hardware_usage.credential_owner` — the credential the job was
   >   *submitted* with — not on what the user has attached now, so adding or
   >   removing a credential does not orphan existing jobs.
   >
   > · **The service cache became unbounded.** Its key space was a handful of
   >   operator settings; it is now one entry per distinct user token, each
   >   holding a live credential for the life of the process. Capped at 32 with
   >   oldest-first eviction.
   >
   > BYOK covers **all three providers** — IBM, Braket and Azure. Each is
   > threaded as an EXPLICIT per-request session object, never through ambient
   > configuration: `QiskitRuntimeService` keyed on the presented token, an
   > `AwsSession` over an explicit `boto3.Session`, and a
   > `ClientSecretCredential` passed to `Workspace(credential=…)`.
   >
   > `os.environ` deserves naming as the trap here. boto3 reads
   > `AWS_ACCESS_KEY_ID` from it, so "set it for the duration of the call" looks
   > like it works — and does, until two users submit at once and one job is
   > billed to the other's AWS account. Nothing writes to `os.environ` or
   > `settings` on any provider path.
   >
   > A credential presented for the WRONG provider, or for a runtime session
   > opened on the operator's account, is refused rather than quietly run on
   > ours.
4. **Quota exemption.** A job on a user's own credential should not consume the
   monthly allowance. `reserveHardwareJobWithinBudget` needs a flag; the row
   should still be written (the history is the point) with a marker saying
   whose credential paid.

   > **Shipped** as `hardware_usage.credential_owner` (`'operator'` default, so
   > every existing row is correctly labelled with no backfill). A BYOK job
   > does not go through `reserve_hardware_job` at all — there is no limit to
   > check, so there is nothing for the advisory lock to protect — it is a
   > plain insert by `recordByokHardwareJob`. `reserve_hardware_job` and
   > `spend_in_window` are **replaced** in `schema-byok.sql` with copies
   > carrying one added clause each (`and credential_owner = 'operator'`);
   > the file says loudly that they are copies and must be kept in sync, and
   > why editing the originals in place would break an already-migrated
   > project. Un-migrated deployments degrade to counting BYOK jobs against
   > the allowance, with a loud log — the safe direction.
5. **Say plainly what it means.** A user handing over a token is handing over
   the ability to spend their IBM allowance. Tell them: what is stored, that it
   is encrypted, that jobs appear in *their* vendor console, how to revoke,
   and that revoking at the vendor is the real revocation.

   > **Shipped** as the disclosure block in
   > `apps/web/components/account/ProviderCredentials.tsx`, stated *before* the
   > input rather than under it, plus step-by-step instructions for obtaining
   > an IBM token in the panel itself rather than behind a documentation link —
   > the errand takes two minutes only if you already know the token is on the
   > dashboard and the CRN is a separate thing you usually do not need.
   > "Remove" is never called "revoke" anywhere in the code or the copy. The
   > panel also surfaces a credential that no longer decrypts after a key
   > rotation, which is otherwise invisible until jobs quietly start drawing on
   > the platform's allowance again.

### The one thing not to do — not done

Do not accept the token as a request parameter from the browser on every
submit "to avoid storing it". It would then be in browser memory, in any error
report, and in whatever logs the request passes through. Encrypted at rest and
decrypted server-side for exactly one outbound call is the safer shape.

---

## 5. Deploying

```bash
ACR_NAME=quantumlabacr14409 RESOURCE_GROUP=quantum-lab-rg bash infra/azure/deploy.sh
```

**Deploys the committed HEAD, not your working directory** — `deploy.sh` checks
HEAD out into a throwaway `git worktree` and re-execs there. Uncommitted work is
listed loudly and excluded. `DEPLOY_FROM_WORKTREE=0` restores the old behaviour.

**A full deploy through the new worktree path has not been run yet.** The
mechanism is verified (correct commit, detached, `.env.production` carried in);
the next deploy is its first end-to-end exercise. If it misbehaves, that flag
is the escape hatch.

`API_SHARED_SECRET` is now **reused** across deploys rather than regenerated, so
an ordinary deploy no longer takes the hardware surface down for several
minutes. `ROTATE_API_SECRET=1` performs a gapless rotation via an overlap
window.

---

## 6. Known-good test baseline

```
services/api   385 passed   5 failed   6 errors
apps/web      3111 passed   5 failed
```

**The failures are pre-existing and environmental, not regressions.** On this
Windows box `pennylane-lightning` segfaults natively (verified outside pytest)
and `test_js_random_crosscheck.py` cannot spawn `node`. The web failures pass
in isolation and fail only under full-suite load (5s timeouts). Verify against
these numbers before assuming you broke something.

---

## 7. What is still genuinely unproven

Stated plainly because a green suite does not cover it:

* **No job has ever been submitted to real hardware from this codebase.** Every
  hardware test is offline and injects fakes. The IBM, Braket and Azure call
  shapes are written against the SDKs and unverified against a live account.
  `scripts/hardware_smoke.py` is the only thing that will settle it.
* **Braket bit order is unverified.** `poll_braket_job` returns
  `result.measurement_counts` verbatim. If Braket's qubit order is the reverse
  of Qiskit's, every IonQ/Rigetti histogram is mislabelled per qubit. One real
  run of a known-answer circuit settles it. Documented, not guessed at.
* **The migrations were applied on 17 Sep 2026** (operator-reported; see §2
  for the read-only query that confirms it). Until that query has been run and
  read, treat every table below as present-but-unverified — and note that no
  code path here has yet been exercised against the live schema, only against
  the in-memory doubles the tests use.
* **Calibration is not captured against a job**, so run permalinks are
  repeatable but not yet reproducible. The public page says so.

---

## 8. Suggested next actions, in order

1. Apply the migrations (§2). Everything else is blocked on it.
2. Set `IBM_QUANTUM_TOKEN`, run `hardware_smoke.py --submit`. First real job.
3. ~~Build BYOK (§4).~~ **Done, all three providers.** Verify it end to end
   the moment step 2 works: store a token on `/account`, submit, and confirm
   the job appears in *that* vendor console and does not decrement the monthly
   allowance. IBM first — it is free and the call shape is the best understood.
   Braket and Azure carry one extra unknown: their explicit-session call
   shapes are written against the published SDK signatures and have never run
   against a live account.
4. `docs/PLAN-BEST-IN-CLASS.md` §A1 — publish `packages/qubit16-python` to PyPI.
5. Set `HARDWARE_RECONCILE_SECRET` and schedule the sweep every 5 minutes.
6. Set `UPSTASH_REDIS_REST_URL` — rate limiting is currently per-instance.
