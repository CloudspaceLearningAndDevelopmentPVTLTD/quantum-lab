# Onboarding, retention and the first five minutes

What a first-time visitor meets, what brings them back, and the three things
this workstream deliberately did **not** build.

Everything below is local to the visitor's device. Nothing in this document
introduces a network call, an account requirement, or a stored identifier. If
you are changing any of it, read `docs/ANALYTICS.md` first — the privacy stance
there is a constraint on this file, not a neighbour of it.

---

## Where a visitor actually lands

| Route | Who gets there | What is asked of them |
| --- | --- | --- |
| `/` | everyone | nothing — Hero, three feature cards |
| `/welcome` | anyone who takes the banner | two gates, then one question |

`/welcome` is linked from **nowhere else in the product**: not the nav, not the
home page, not the footer, not the sitemap-driven UI. Before this change the
entire first-run flow was reachable only by typing the URL — 400 lines of
onboarding that a real visitor could not find. The banner in
`components/onboarding/ResumeBanner.tsx` (mounted in `app/layout.tsx`) is its
whole discovery path, which is why `tests/e2e/onboarding.spec.ts` asserts that a
first-time visitor is offered it from an ordinary page.

If the nav or the home page ever gains a proper "Start here" entry, that is
strictly better and this banner's first-visit mode should shrink or go.

---

## The flow, and why the circuit comes first

`/welcome` is three screens:

1. **First circuit** — the real editor, two qubits. Place H, place CX, run 1,024
   shots, and see a histogram with exactly two bars.
2. **Your path** — "what brings you here?", three options.
3. **You're set** — the rest of the chosen path, with anything already done
   ticked off rather than offered again.

It used to be 2 → 1 → 3. That put a three-way segmentation question — whose
answer changes nothing at all until the last screen — in front of the only
thing on this site that a book, a video or a lecture cannot do: watch real,
live-computed measurement outcomes come back from a circuit you built. Effort
before payoff, on the one screen where a visitor has the least accumulated
reason to spend any.

Reordered, the payoff is the first thing they touch, and the question is asked
at the moment it is actually useful — when it is answering "what next?".

Both screens remain skippable, and nothing on the site locks either way.

**Do not add a fourth screen.** The measured budget for this flow is about two
minutes; every screen added spends it on something that is not physics.

---

## Progress, without dark patterns

Progress is **derived** from what the learner did — see `lib/analytics/journey.ts`
and the "Derived progress" section of `docs/ANALYTICS.md`. Before that, the
resume banner called `nextStep(path, completedSteps)` with a list that no path
step id was ever written into, so it returned step 1 forever: a learner four
lessons deep was told to "pick up where you left off" and sent back to lesson
one. That is worse than showing nothing.

The banner has three modes and is silent the rest of the time:

| Mode | Condition | Line |
| --- | --- | --- |
| invite | never started onboarding, and no sign of activity elsewhere | "New here? Build a working two-qubit circuit in about two minutes" |
| resume | a path is chosen and a step remains | "Pick up where you left off — *step* · N of M done" |
| welcome back | as resume, but ≥ 7 days since the last recorded activity | "Welcome back — here is where you were: *step*" |

A dismissal is permanent, in every mode, and permanent means permanent.

### Rules this surface is held to

- **Absence is met with orientation, not a scolding.** The seven-day gap changes
  the wording and nothing else. No "you missed 6 days", no broken-streak
  graphic, no lost-progress warning. Nothing is withheld or reset for being
  away.
- **No manufactured urgency.** No countdowns, no expiring anything, no seat or
  spot counts. Nothing in this product is scarce; pretending otherwise to move a
  metric would be a lie told to someone who came here to learn.
- **A visit is not an achievement.** Clicking through from the banner marks a
  step `visited`, which moves the pointer along, and it is deliberately not
  counted in "N of M done". Inflating a counter is the cheapest possible way to
  make progress feel good and the fastest way to make it worthless.
- **Suppressed for people already busy.** The invite never interrupts someone
  who has already opened a lesson, a visualization or the simulator on their
  own — they found the way in, and an interruption is not help.
- **Seven days, not two.** A shorter window fires after an ordinary weekend and
  the phrase stops meaning anything.

Streaks live on `/insights` (another workstream's file). `streak().current` is
0 once the run has ended — see `lib/analytics/aggregate.test.ts`. A streak that
ended last week is not one you are still on, and showing it as live would be
flattery rather than information.

---

## Email: nothing is sent, on purpose

**Quantum Lab sends no lifecycle email.** No welcome sequence, no "you haven't
been back", no drip, no digest. This is a decision, not an omission.

Three things would have to exist first. As of 2026-08-25, all three do:

1. **A consent record — EXISTS (2026-08-25).** `email_subscriptions`
   (supabase/schema-email.sql; service-role only, RLS with no policies) stores
   email + purpose + `consented_at` + `confirmed_at` + `unsubscribed_at`, with
   the confirm/unsubscribe token held only as a SHA-256 hash.
   `POST /api/email/subscribe` records the signup and mails a confirm link
   (double opt-in — the form submission alone is NOT consent; only the click
   from the inbox stamps `confirmed_at`). Sendable means `confirmed_at` set
   AND `unsubscribed_at` null, and nothing less. Caveat, stated where a
   deployer will read it: without `SUPABASE_SERVICE_ROLE_KEY` the store is an
   in-process Map (`lib/email/subscriptions.ts`, same fallback pattern as the
   exam store), which forgets opt-outs on redeploy — so the memory backend is
   a demo, never a consent record, and any future sender must refuse it.
2. **An unsubscribe that works — EXISTS (2026-08-25).**
   `GET /api/email/unsubscribe?token=…` is one-click, verifies against the
   stored hash, persists `unsubscribed_at`, and is idempotent — always the
   same plain 200 page, except when the durable store is unreachable, where it
   says plainly that nothing was saved rather than confirming an opt-out it
   did not write. A stale confirm link cannot undo it; the only way back in is
   a fresh signup plus a fresh confirmation.
   `lib/email/subscriptions.test.ts` and `lib/email/subscribeRoutes.test.ts`
   fail if any of that stops being true.
3. **A scheduler — EXISTS (2026-08-25).** There is still no job runner in
   this deployment, so the scheduler is `POST /api/email/dispatch`: an
   operator-triggered endpoint (`Authorization: Bearer EMAIL_DISPATCH_SECRET`,
   same rules as `BILLING_RECONCILE_SECRET` — unset means nothing
   authorises) that processes due sends in bounded batches. The schedule
   math is pure (`lib/email/courseSchedule.ts`): day N of the 7-day course
   falls due N−1 days after `confirmed_at`, backlogs drain one message per
   run, and `sent_days` (new column, schema-email.sql) is appended
   **atomically before the provider is called**, so a crash or a concurrent
   run can drop a day but never double-send one. It filters on
   `unsubscribed_at` both when building the batch and again inside the
   atomic claim, and it **hard-refuses the memory backend** with a 503
   citing this section — a scheduler over a store that forgets opt-outs on
   restart is exactly what this section forbids, so the refusal is code,
   not a deployment note. Course mails carry a one-click unsubscribe as
   their first line (`GET /api/email/unsubscribe/course`), and every "Run
   it" link is verified against `lib/visualizations.ts` at module load —
   a renamed route breaks the build, not a subscriber's inbox.
   `lib/email/courseSchedule.test.ts`, `courseDispatch.test.ts`,
   `dispatchRoute.test.ts` and `courseTemplates.test.ts` hold all of that.

So the code no longer blocks sending — **the environment does, on purpose.**
All three prerequisites exist and the signup form is now mounted (foot of
`/learn`), but nothing is sent until an operator deliberately provides all
of: `RESEND_API_KEY` (a provider), `SUPABASE_SERVICE_ROLE_KEY` + the
`email_subscriptions` table (a durable consent store — dispatch refuses
anything less), and `EMAIL_DISPATCH_SECRET` plus a cron that actually invokes
`POST /api/email/dispatch` (hourly is plenty; each run sends at most one
message per subscriber). Any deployment missing any of those sends nothing,
and says so in its responses rather than failing quietly.

### What `/api/email` does now

The four templates in `lib/email/templates.ts` are **transactional**: org
invite, magic link, welcome, exam passed. `POST /api/email` renders one of them
and hands it to the provider, and it has now been holed twice for the same
underlying reason — "the template set is closed" was mistaken for "this is safe
to expose".

- **MAIL-1 (previously fixed):** `invite` and `magic-link` put a *caller-supplied*
  URL behind a "Sign in" button on an unauthenticated endpoint — a DKIM-signed,
  SPF-passing phishing mail from the product's own domain. Caller-supplied URLs
  are now pinned to this app's hosts.
- **The recipient hole (fixed here):** the endpoint still sent to whatever
  address a stranger named. Anonymous `curl`, 100 messages a day per IP, every
  one of them unsolicited mail wearing the app's sending reputation. It now
  requires a Supabase-verified caller and **will only send to the verified
  address on that caller's own token**. Mailing a stranger is structurally
  impossible rather than merely rate-limited.

Org invites are unaffected: `/api/orgs/invite` calls `sendEmail` from
`lib/email/client.ts` directly, on the server, behind its own authentication and
role check. It never went through this route. Nothing else in the product calls
`/api/email` at all.

`lib/email/route.test.ts` fails if either gate is removed.

**If you add lifecycle email later**, the bar is: opt-in recorded server-side
before the first send, a one-click unsubscribe honoured before every send, and
a suppression list that outlives a redeploy. All three now exist for the
7-day course (see the numbered list above) — but only when backed by the real
`email_subscriptions` table, not the Map fallback, and `/api/email/dispatch`
enforces that by refusing to run over the fallback. A NEW mailing beyond the
course clears none of this bar automatically: it needs its own purpose
literal, its own opt-in, and the same three prerequisites. Anything less and
the honest move is still to send nothing.

---

## Sharing

`lib/share-link.ts` serialises a circuit to OpenQASM 3, base64url-encodes it,
and puts it in `/simulator?c=…`. No database, no account, no round trip — a
shared link works from a text message.

Two properties, both covered by `lib/share-link.test.ts`:

- **It round-trips.** Sharing is the one feature whose failure is invisible to
  the person who triggers it: the sender sees a URL, and only the recipient sees
  an empty editor. Encode/decode identity is asserted for a Bell pair and for a
  parametrised circuit with π-fraction rotations.
- **Nothing private rides along.** The token is asserted to be *exactly*
  `toQasm(circuit)` — no saved-circuit name, no id, no timestamp, no origin, no
  session identifier. That is a property of the serializer, and exactly the kind
  that decays the next time somebody adds a helpful field to it, so it is
  checked by decoding the token back to text rather than by reading the code.

The token is also asserted to be URL-safe with no `+`, `/` or `=`. A `+` in a
query string decodes as a space, which is how a shared link quietly loses a gate.

---

## Offline

`/offline` is the service worker's navigation fallback. It lists what genuinely
still works without a network (the simulator, the course, saved circuits,
certification practice, the eight listed visualizations) and what does not (the tutor,
pricing, account, sync). Both lists are derived from data where a count is
quoted, because a hardcoded "ten lessons" in prose is a guaranteed future lie.

**One caveat, and it is the same lie one level down.** The lesson count comes from
`LESSONS.length`, which is real. The visualization count comes from a **second, hand-written
`VISUALIZATIONS` array declared inside `app/offline/page.tsx`**, not from the catalogue in
`components/ui/Hero.tsx`. Deriving a count from a duplicate of the data is not deriving it. Adding
a ninth visualization to the catalogue leaves this page saying eight and listing the wrong set, and
nothing will fail. Import the real array.

---

## Files

| Path | Role |
| --- | --- |
| `app/welcome/**` | the first-run route |
| `components/onboarding/WelcomeFlow.tsx` | screen order and the "You're set" screen |
| `components/onboarding/FirstCircuit.tsx` | the guided Bell pair, in the real editor |
| `components/onboarding/PathPicker.tsx` | the three paths |
| `components/onboarding/ResumeBanner.tsx` | invite / resume / welcome-back, mounted in `app/layout.tsx` |
| `lib/onboarding/state.ts` | localStorage state (SSR-safe, never throws) |
| `lib/onboarding/steps.ts` | the three paths as pure data |
| `lib/analytics/journey.ts` | derived path progress |
| `lib/share-link.ts` | permalinks |
| `app/offline/**` | service-worker fallback |

### Known loose ends

- ~~`shouldShowResume()` / `nextStep()` dead code~~ — **deleted.** Both were
  superseded by `lib/analytics/journey.ts` (`shouldShowResume()` encoded the
  rule that made path progress invisible; `nextStep()` is the function that
  returned step 1 forever) and had no callers; the history survives in the
  header comments of `lib/analytics/journey.ts` and
  `components/onboarding/ResumeBanner.tsx`.
- `circuit.built` and `viz.interacted` are in the `EventName` union in
  `lib/analytics/events.ts` and **nothing emits either** — verified by grepping every `track(…)`
  call site in `app/` and `components/`. `viz.interacted` is *read* by `/coach` and by
  `lib/analytics/journey.ts`, so both are branching on a value that never arrives. Either emit them
  or remove them from the union; a closed union whose members are unreachable is the kind of thing
  a reader takes as evidence the feature exists. See `docs/ANALYTICS.md`.
