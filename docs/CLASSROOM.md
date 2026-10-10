# Classroom

What an instructor can actually do with a Team or University licence, how the
privacy decision at the centre of it was resolved, and what is still missing.

Everything below describes code that exists. Where something does not work, it
says so in the same voice.

---

## The shape of it

| Who | Where | What they do |
| --- | --- | --- |
| Instructor (owner/admin seat) | `/instructor` → **Cohort** | Publish an assignment, watch completion, export CSV |
| Instructor | `/instructor` → **Co-pilot** | Draft course material with a model (unchanged) |
| Learner (member seat) | `/admin` → **Coursework** | See what they owe, tick it off, decide whether to share |
| Anyone managing seats | `/admin` → Seats / Invites / Progress | Unchanged, plus a Progress tab that no longer invents data |

An **assignment** is a title, a due date and an ordered list of items. An item is
one lesson, one challenge or one exam, named by the id its catalogue already
uses. A learner sees a checklist; the instructor sees who has finished it.

### Classes: per-class cohorts within one licence

This section used to say "a cohort is an org" and defend not adding a
`cohort_id` column nothing filtered on. Classes exist now, and the thing that
was defended is exactly what was built when they became needed: a table with its
own membership (`org_classes` + `org_class_members` in
`supabase/schema-orgs.sql`), not an orphan column.

What a class IS: a named group of seats inside one licence, and a target for an
assignment. `org_assignments.class_id` is nullable, and **null means what every
assignment meant before classes existed — everyone on the licence**. That is the
default everywhere: the original publish route does not know classes exist, and
no pre-classes row or caller changes behaviour. A class-scoped assignment is
counted only against its class: the instructor console's completion figures,
denominators and per-learner lists use `assignmentAppliesTo()` in
`lib/orgs/assignments.ts`, the one place the rule lives.

What a class is NOT, said plainly:

- **Not an access boundary.** Every permission check is still the org check in
  `lib/orgs/access.ts`. Any active seat can read all of the licence's
  coursework, including class-scoped assignments; the composer and the console
  both say so on screen. Do not put anything in a class-scoped assignment that
  must be hidden from the rest of the licence.
- **Not a role.** "Instructor" still means an owner or admin seat. Creating a
  class, editing its roster and publishing to it all require owner/admin, the
  same as publishing anything.
- **Not a filter the learner sees.** The learner's coursework page is
  unchanged: it lists the org's assignments exactly as before. Filtering a
  learner's checklist to their own classes is honest future work; today a
  learner in class A still sees class B's assignment in their list (and the
  instructor's figures simply never count them for it).

Membership joins seats (`org_members.id`), not accounts, so an invited seat
with no `auth.users` row can be placed in a class. Deleting a class does not
delete its coursework: `class_id` is `ON DELETE SET NULL`, so the work falls
back to targeting the whole licence, and the local-mode store mirrors that so
development cannot behave differently from a real database.

---

## The privacy decision

This is the part that mattered most, and it was a contradiction before it was a
feature.

`docs/ANALYTICS.md` says — correctly, and it is one of the better things about
this codebase — that Quantum Lab measures itself on the learner's device and
nowhere else. Lesson progress and challenge results are `localStorage`.
`/insights` computes every number in the browser. Meanwhile `/pricing` sells
"cohort progress and usage analytics" to a university, and the admin console's
Progress tab rendered a table in which **every row but your own was invented**:
a seeded PRNG in local mode, hard zeroes with a backend configured.

Both claims cannot be true. The resolution is not to start collecting progress.

### The five rules

1. **Nothing leaves the device without an explicit grant.** A learner turns
   sharing on themselves, per organisation, from the Coursework tab. There is no
   default-on, no pre-ticked box, and an instructor cannot do it for them —
   `/api/orgs/progress/consent` has no `userId` parameter, by design.
2. **The grant is specific and legible.** `SHARED_FIELDS` in
   `apps/web/lib/orgs/progressShare.ts` is the list, in the words the learner
   reads:

   > - Which lessons you have marked complete.
   > - Your quiz scores, as the number of questions you got right in each lesson.
   > - Which practice challenges you have solved.
   > - Which certification exams you have passed.

   And what is not:

   > Not shared: your saved circuits, your tutor conversations, anything you
   > type, and the on-device usage data behind /insights.

   There is one list. `progressShare.test.ts` fails if a field is added to the
   snapshot without a line being added to the disclosure.
3. **The gate is server-side.** `POST /api/orgs/progress` refuses a snapshot
   from a learner with no consent row; `upsertSnapshot()` refuses again; the RLS
   policy on `org_progress` refuses a third time. A check that ran only in the
   browser would be decoration.
4. **Revoking deletes.** "Stop sharing" removes the stored snapshot before it
   removes the consent row — in that order, so a half-failure leaves consent with
   no data rather than data with no consent. A failure to delete is reported as a
   failure, never as a cheerful "done".
5. **"Has not shared" is a first-class state.** It is never rendered as 0%, never
   averaged in as a zero, and in the CSV it is `not_shared`, never `not_started`.
   Every cohort figure states its denominator: *1 of 2 sharing*, not *33%*.

### What is stored

`org_progress` holds one row per (org, learner), replaced wholesale on each
share. It is a **snapshot, not an event log**: no history, no per-action
timestamps, nothing resembling an activity stream. The single derived field is
`completions` — assignment id → the moment the server first saw every item of
that assignment done. That is the only thing that can make a learner "late", and
it is written on ingest and never moved backwards.

Sharing is **not continuous**. There is no background sync and no heartbeat. The
learner presses "Update what they see" after a study session, and the panel shows
when the last one was sent.

---

## Enforcement

Every classroom capability goes through `requireOrgRole()` in
`apps/web/lib/orgs/access.ts`, server-side, against the caller's membership row
for **the org named in the request**:

| Route | Method | Required |
| --- | --- | --- |
| `/api/orgs/assignments` | GET | any active seat |
| `/api/orgs/assignments` | POST / PATCH / DELETE | owner or admin |
| `/api/orgs/assignments/export` | GET | owner or admin |
| `/api/orgs/progress` | GET | owner or admin |
| `/api/orgs/progress` | POST | any active seat, **and a consent row** |
| `/api/orgs/progress/consent` | GET / POST / DELETE | any active seat, **self only** |
| `/api/orgs/classes` | GET | any active seat |
| `/api/orgs/classes` | POST / PATCH / DELETE | owner or admin |
| `/api/orgs/classes/assignments` | POST | owner or admin, and the class must belong to the org named in the request |

An instructor of one cohort naming another cohort's id gets a 403 with the same
sentence as a stranger — the 403 is not a membership oracle. A suspended seat is
refused outright. `lib/orgs/classroomRoutes.test.ts` asserts each of those
through the real handlers and checks the database is unchanged afterwards.

The console hides controls a member cannot use. **That is not a control.** If the
UI and the API ever disagree, the API is right.

---

## The CSV

LMS grade passback was removed as unbuildable, so this is how a mark reaches an
institution's gradebook. `GET /api/orgs/assignments/export?orgId=` returns one
row per (learner × assignment):

```
student_email,assignment,due_at,items_total,items_complete,status,completed_at,on_time,last_shared_at
```

- `status` is `complete` | `in_progress` | `not_started` | `not_shared`.
- `on_time` is `yes`, `no`, or **blank when unknown** — not `no`. A gradebook
  column that renders "late" for "we do not know" fails a student.
- Rows are ordered (assignment by due date) × (learner by email), so two exports
  of unchanged data are byte-identical and diffable.
- Cells beginning `=`, `+`, `-` or `@` are prefixed with a single quote. A
  learner controls their own email address, and without that guard opening the
  file in Excel executes it.

---

## With no backend configured

With no Supabase project, the whole feature runs against `localStorage`
(`quantum-lab.classroom`) so the assign → see → complete → export loop is
walkable in development. In that mode the browser stands in for one seat, the
panels say so on screen, and **nothing is protected because nothing leaves the
browser**.

The API routes refuse mutations outright in that configuration (`503
not_configured`) rather than accepting a write into a server-side store that does
not exist. An instructor being told their assignment was published when no
learner will ever see it is the worse failure.

---

## Known gaps

- **Classes target, they do not hide.** Per-class cohorts within one licence
  exist (see the classes section above), but a class-scoped assignment is still
  readable by every seat on the licence, and the learner's coursework list is
  not yet filtered to their classes. The CSV export is likewise still
  licence-wide: one file, every learner × every assignment, with no class
  column. Both are honest next steps, not claimed features.
- **Class-scoped publishing is a second route.** `POST
  /api/orgs/classes/assignments` duplicates the field validation of `POST
  /api/orgs/assignments` (same functions, two call sites) because the original
  route belongs to another workstream and its "no classId" contract had to stay
  byte-identical. Folding a `classId` field into the original route would
  retire the duplicate.
- **The learner's coursework lives at `/admin`.** That is where invite links
  already land (`/admin?invite=…`), so it is where a learner arrives with a seat
  in hand — but the URL reads like a staff page. A `/cohort` route and a
  navigation entry belong to whoever owns `app/layout.tsx` and
  `components/ui/SiteNav.tsx`; this workstream did not reach into those files.
- **`docs/ANALYTICS.md` — done.** Its table used to answer "Does anything leave
  the device? **No**" without qualification. It now says "no analytics event
  does", and carries a note naming the two paths that DO leave the device —
  server-graded certification, and this feature's consented progress share —
  pointing back here as the authority on the second. The analytics event buffer
  itself is untouched by this feature and still never leaves.
- **Exam results come from `GET /api/exams/summary`.** If that call fails —
  offline, signed out, store unavailable — the snapshot reports no exams and an
  assignment naming an exam shows as incomplete. That is the safe direction: it
  never invents a pass.
- **No per-item completion timestamps.** Completion time is recorded per
  assignment, at ingest. A learner who finishes everything and shares once a week
  later is recorded as completing then. `on_time` is honest about this only in
  the sense that it compares what the server actually observed.
- **The RLS policies for `org_assignments`, `org_progress_consent`,
  `org_progress`, `org_classes` and `org_class_members` have never run against
  a live project**, exactly like the seat
  policies above them in `supabase/schema-orgs.sql`. The app-layer checks are the
  control today. Verifying them is part of the same pre-production checklist item
  in `docs/SECURITY.md`.
- **No notification of any kind.** Nobody is emailed when work is assigned or when a deadline
  passes. **Invite email, however, is wired** — this file used to say it was not.
  `app/api/orgs/invite/route.ts` calls `sendEmail` from `lib/email/client.ts` directly, on the
  server, after its own authentication and role check, and reports the outcome as
  `{ emailSent, emailReason? }`. Delivery is best-effort and deliberately happens *after* the
  invite row exists: the response also carries the accept URL, which is the only path that works
  with `RESEND_API_KEY` unset. Assignment and deadline notifications remain unbuilt.
- **Grades are completion, not marks.** The export says whether items were
  finished, plus quiz scores in the Progress tab. There is no rubric, no weighting
  and no partial credit, because nothing in the product produces one.
