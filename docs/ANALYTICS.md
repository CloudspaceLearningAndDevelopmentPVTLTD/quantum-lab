# Analytics

Quantum Lab measures itself **on the learner's device and nowhere else**. There is
no analytics vendor, no tag manager, no pixel, no analytics cookie, no
fingerprint, and no cross-site identifier anywhere in this app. What follows is
the whole system.

(The app does set exactly one cookie, `ql_exam_guest` — an httpOnly, unsigned
practice identity minted by the exam routes so an anonymous candidate can resume
a paper. It is not read by anything in this document. Precision here is not
pedantry: a blanket "no cookies" that a reader can disprove with devtools costs
more trust than the cookie does.)

---

## The short version

| Question | Answer |
| --- | --- |
| Where do events go? | `localStorage`, key `quantum-lab.events`, on the visitor's device |
| Does anything leave the device? | **No analytics event does** — unless `NEXT_PUBLIC_ANALYTICS_ENDPOINT` is set *and* `flush()` is called. See the note below: this row is about the event buffer and nothing else. |
| Third-party scripts? | None |
| Cookies? | Only `ql_exam_guest`, an httpOnly practice identity set by the exam routes. Not an analytics cookie, and nothing here reads it. |
| Who reads the data? | The visitor, on `/insights`; every number is computed client-side |
| Can they turn it off? | Yes — a toggle on `/insights`, plus automatic opt-out on DNT/GPC |
| Can they export it? | Yes — "Download my data" writes a JSON file |
| Can they delete it? | Yes — "Delete all analytics", confirm-on-second-click |

> **What this page is NOT about, and the reason the row above is qualified.**
> "Nothing leaves the device" is a statement about the analytics event buffer.
> It has never been a statement about the whole product, and two things in the
> tree now make the unqualified version false:
>
> * **Certification.** Exam attempts, answers and scores are written to the
>   server — that is the entire point of `lib/exams/store.ts`, because a score a
>   browser computes is a score a browser can edit. A certificate carries a
>   self-attested name and is publicly verifiable by number.
> * **Classroom progress sharing.** A learner in an organisation may opt in to
>   share lesson, challenge and exam completions with their instructor
>   (`/api/orgs/progress`). It is off by default, per-org, learner-initiated,
>   revocable, and revoking it deletes the shared copy. docs/CLASSROOM.md §
>   "Privacy" is the authority on it.
>
> Neither path touches the analytics buffer, and neither is enabled by the
> `/insights` toggle. If you are answering a privacy question about this
> product, answer it from all three documents, not this table alone.

---

## The event taxonomy

The set of event names is **closed**: `EventName` in
`apps/web/lib/analytics/events.ts` is a union type, so there is no way to emit a
free-form name and the complete list of what we record fits on one screen.

The props below were read off the actual `track()` call sites, not off an
earlier draft of this table — every row that follows is what the code emits
today. (The previous version of this table was wrong on nine rows: it promised
`qubits` where the code writes `numQubits`, `slug` on `quiz.answered` where the
code writes `questionId`, and a `source` on `upgrade.viewed` that has never
existed. A property name in a doc is a contract with whoever writes the next
dashboard query.)

| Event | Meaning | Props, as emitted | Emitted by |
| --- | --- | --- | --- |
| `lesson.viewed` | A lesson page was opened | `slug`, `level`, `track` | `components/lesson/LessonShell` |
| `lesson.completed` | A lesson was marked complete | `slug`, `level` | `components/lesson/LessonShell` |
| `quiz.answered` | A quiz question was answered | `questionId`, `correct` | `components/lesson/Quiz` |
| `circuit.built` | The circuit editor was modified | — | **nothing. No component emits this.** |
| `circuit.run` | A simulation was executed | `numQubits`, `gateCount`, `shots`, `noisy` | `app/simulator/page` |
| `circuit.saved` | A circuit was saved to the library | `numQubits`, `gateCount` | `components/circuit/SaveLoadPanel` |
| `circuit.shared` | A share link was generated | `numQubits` | `components/circuit/SaveLoadPanel` |
| `viz.opened` | A visualization was opened | `slug`, `level` | `components/ui/VizFrame` |
| `viz.interacted` | A visualization control was used | `slug`, `control` | — |
| `tutor.asked` | A question was sent to the tutor | `level`, `turn`, `length`, `hasCircuit` | `components/tutor/ChatPanel` |
| `exam.started` | A practice exam was started | `examId`, `questionCount` | `components/exam/ExamRunner` |
| `exam.completed` | A practice exam was finished | `examId`, `score`, `passed` | `components/exam/ExamRunner` |
| `hardware.submitted` | A job was submitted to real hardware | `provider`, `backend`, `shots` | `app/hardware/page` |
| `upgrade.viewed` | The pricing page was viewed | `currentPlan` | `components/billing/PricingTable` |
| `upgrade.started` | Checkout was started | `planId`, `period` | `components/billing/PricingTable` |

`circuit.built` and `viz.interacted` are **vocabulary with no speaker**: they
are in the closed union and in `EVENT_NAMES`, so `countByName` reports a zero
for them forever and any chart built on them is permanently flat. Either wire
an emitter or delete the name — do not leave a third one lying here.

Property values are flat scalars only — `string | number | boolean`. Objects,
arrays and `null` are dropped on the way in.

### Event shape

```ts
interface AnalyticsEvent {
  name: EventName                                  // from the closed union
  at: string                                       // ISO-8601
  props: Record<string, string | number | boolean> // flat scalars, sanitized
  sessionId: string                                // per-TAB, sessionStorage
}
```

`sessionId` is **not** a user id. It is generated per browser tab
(`crypto.randomUUID()` where available), held in `sessionStorage`, and dies with
the tab. It is not stable across tabs, restarts, or devices, and it is never
correlated with anything else.

---

## No PII, twice over

Call sites are designed never to pass personal data: the taxonomy is built around
slugs, counts and booleans. `sanitizeProps()` is the second layer — defence in
depth, so a mistake is cheap rather than a breach:

- Any property key containing `email`, `name`, `token`, `key`, `secret`,
  `password`, `phone`, or `address` (case-insensitive) is **dropped entirely**.
- Any string value is **truncated to 64 characters**, so an accidentally-pasted
  blob cannot ride along.

`sanitizeProps()` runs on the client before an event is written **and again on the
server** in `POST /api/analytics`. A server that trusts its client for privacy
guarantees does not have any.

---

## Opt-out, and browser privacy signals

`isOptedOut()` returns true when **any** of these hold:

1. `localStorage['quantum-lab.analytics-optout'] === '1'` — the in-app toggle.
2. `navigator.doNotTrack === '1'` — Do Not Track.
3. `navigator.globalPrivacyControl === true` — Global Privacy Control.

**DNT and GPC are an automatic opt-out that the in-app toggle cannot override.**
Those signals are the person telling their browser, once, that they do not want to
be measured. If a per-site switch could turn that back on, the browser-level
setting would be meaningless — and a preference a site can quietly revoke is worse
than no preference at all. So the browser wins, the toggle on `/insights` renders
disabled, and the page explains why.

Turning the toggle off also **deletes the existing buffer**, because "off" should
mean off, not paused.

While opted out, `track()` and `flush()` are complete no-ops.

---

## Retention and caps

| Cap | Value | Behaviour at the limit |
| --- | --- | --- |
| Local ring buffer | **1,000 events** | Oldest events are dropped first |
| Ingestion batch | **500 events** per POST | Extra events dropped; response says `truncated: true` |
| String prop length | **64 characters** | Truncated |

There is no time-based expiry: the ring buffer is self-limiting, and clearing site
data removes everything. Sample data generated from the empty state is written to
the same buffer and removed by the same delete button.

---

## Aggregation

`apps/web/lib/analytics/aggregate.ts` holds every calculation the dashboard makes.
It touches no browser API, which is what makes "computed in your browser" easy to
audit: this is all the computation there is.

- Day buckets are **local**, not UTC — a learner's yesterday is their yesterday.
- `dailySeries()` returns a **dense, zero-filled** series. A sparse series would
  draw a line that hops from Monday to Friday as if the quiet days never happened.
- `streak().current` only counts when the last active day is today or yesterday.
  A streak that ended last week is not one you are still on.
- `learningSummary().minutesEstimate` is a **heuristic**: 5 minutes per distinct
  5-minute bucket containing an event. Quantum Lab runs no timer and sends no
  heartbeat — both of which would be far more invasive than the thing they
  measure. Read it as "roughly how much of your time this app was part of", never
  as a timesheet.

### Derived progress — `lib/analytics/journey.ts`

The same buffer answers "where is this learner on the path they chose?", and it
answers it by **derivation, not by extra bookkeeping**: a lesson step is done
when the lesson is in the course-progress store or a `lesson.completed` event is
in the buffer, a visualization step when its slug has been opened, a challenge
step when it is solved, `/simulator` when a circuit has been run, `/hardware`
when a job has been submitted. Nothing new is recorded, nothing new is emitted,
and no component outside `components/onboarding/**` had to be instrumented.

Two rules keep it honest:

- **Lesson completions are the UNION of the progress store and the event
  buffer.** The buffer is a 1,000-event ring and is deleted outright on
  analytics opt-out; the progress store is not. Reading only the buffer would
  mean that opting out of measurement silently erased visible progress, which
  makes exercising a privacy control feel like a punishment.
- **A click-through is `visited`, never `done`.** Following the resume banner
  advances the pointer so the same step is not re-offered on every page load,
  but it is not counted in "N of M done" — only evidence is.

One known imprecision, written down rather than hidden: the developer path has
two steps on `/simulator` ("Bell state" and "Export OpenQASM 3"), so a single
run satisfies both. There is no export event in the taxonomy and adding one
that nothing emits would be a worse lie than this one — see the two rows above
that already have no speaker.

`lib/analytics/journey.test.ts` includes an invariant test that **every step of
every path points at a route this module can read a signal from**. Without it, a
step whose href moves somewhere unreadable becomes permanently un-completable
and freezes the resume pointer — which is exactly the bug this module was
written to fix.

---

## What is tested

The claims on this page are asserted in code, not only in prose:

| File | Proves |
| --- | --- |
| `lib/analytics/track.test.ts` | `flush()` makes no request with no endpoint; DNT and GPC cannot be overridden by the in-app toggle; opting out deletes the buffer; the ring buffer drops its oldest entries; PII-shaped keys never reach storage; the session id is never written to `localStorage` |
| `lib/analytics/aggregate.test.ts` | local (not UTC) day buckets; dense zero-filled series; `streak().current` is 0 for a run that ended two days ago; the minutes heuristic is buckets, not elapsed time |
| `lib/analytics/journey.test.ts` | the derivation above, including the every-step-is-readable invariant |

---

## `POST /api/analytics`

The route exists so self-hosters have a documented place to add storage. In the
default build **it stores nothing**.

```http
POST /api/analytics
Content-Type: application/json

{ "events": [ { "name": "circuit.run", "at": "2026-08-16T10:00:00.000Z",
                "props": { "qubits": 3 }, "sessionId": "…" } ] }
```

Default response (HTTP 200):

```json
{
  "stored": false,
  "received": 1,
  "rejected": 0,
  "truncated": false,
  "message": "Analytics ingestion is not configured; events stay on the device."
}
```

- A malformed body is **400 with a message**, never a 500.
- Batches over 500 events are truncated, and the response says so.
- `GET /api/analytics` returns `{ configured: false, mode: 'local-first', … }`.
- `export const dynamic = 'force-dynamic'` and `runtime = 'nodejs'` are required:
  the handler reads the request and must never be prerendered.

---

## Wiring a real backend

Only do this if you actually need server-side aggregates, and tell your users.

1. **Implement storage.** In `apps/web/app/api/analytics/route.ts`, replace
   `storageConfigured()` with a real check and write `accepted` to your store
   (Supabase, Postgres, ClickHouse, a log file). Events arrive already validated
   and sanitized. Do not add an IP column, and do not log the request IP —
   `sessionId` plus an IP is a stronger identifier than anything else in this
   system.
2. **Point the client at it.** Set `NEXT_PUBLIC_ANALYTICS_ENDPOINT` in
   `.env.local`:

   ```bash
   NEXT_PUBLIC_ANALYTICS_ENDPOINT=/api/analytics
   ```

   With this unset — the shipped default — `flush()` returns immediately and no
   request is ever made.
3. **Call `flush()`** where it suits you (a `visibilitychange` handler is the
   usual choice). It POSTs with `credentials: 'omit'`, so no cookie or ambient
   identity travels with the batch, and it does **not** clear the local buffer:
   the device keeps its own copy for `/insights`.
4. **Update your privacy notice.** The moment step 2 is done, the claim "nothing
   leaves your device" stops being true, and `/insights` says so automatically.

---

## Charts

Charts on `/insights` are hand-built SVG — the app ships no charting dependency.
They follow the house data-visualization rules: the five categorical hues
(violet → teal → amber → rose → sky) are assigned in fixed order by series index
and never cycled or reassigned by rank; a single series gets one hue and no legend
box (the title names it) while two or more get a legend plus direct end-labels; a
single y-axis, never two; recessive solid hairline gridlines, horizontal only;
2px lines with 8px end markers ringed in the surface colour; a crosshair tooltip
reporting every series at the hovered date; and a "Show as table" toggle so no
value is reachable only by hovering.
