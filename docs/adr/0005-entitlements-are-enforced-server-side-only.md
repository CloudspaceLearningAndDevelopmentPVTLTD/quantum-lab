# ADR-0005 — Entitlements are enforced server-side only

**Status:** accepted · **Applies to:** `apps/web/lib/plans.ts`, `lib/billing/entitlements.ts`, `lib/billing/usage.ts`, `lib/orgs/access.ts`, every route that grants a paid capability

## Context

Quantum Lab sells four plans (free / pro / team / edu) and a set of `FeatureId`s. A React app makes
it very easy to write the gate where the reader is:

```tsx
{hasFeature(entitlement, 'course.advanced') ? <Lesson/> : <Paywall/>}   // NOT A GATE
```

This reads like enforcement. It is a rendering decision made on data the browser was handed.

## The failure

An adversarial review found the entire entitlement layer was decorative:

- `requireFeature`, `assertHardwareQuota` and `recordHardwareJob` had **zero callers**. Every gate
  in the product was a client component.
- The advanced track was sold as Pro and **served in full to `curl`**.
- `POST /api/hardware/submit` — the one endpoint that spends the operator's money on IBM and
  Braket — had no identity, no entitlement and no quota. Its only control was an IP rate limit of
  5/min, which costs a few dollars an hour to defeat. Worse, the Next proxy attached the operator's
  shared secret on behalf of *any* anonymous caller, so switching on the documented lock turned a
  broken-but-closed configuration into a working-and-open one.
- The certification `FeatureId` had never meant anything; the check on `/certify/[examId]` was a
  client component.

Every one of those was green in CI.

## Decision

**A capability is granted by a server that verified who is asking. Nothing else is a gate.**

Concretely:

1. **Identity never comes from a request body.** There is no `userId` parameter anywhere in the
   billing, org, exam or hardware paths, and there must never be one. Identity is a Supabase
   access token on an `Authorization: Bearer` header, validated server-side
   (`lib/security/auth.ts`), and clients send it through `lib/authFetch.ts`. The bug that motivated
   the rule: `POST /api/billing/portal` trusted a `userId` from the body, so an anonymous `curl`
   with any user's UUID returned a Stripe portal URL for that person — invoices, billing address,
   saved card, cancel button.
2. **A billing lookup failure degrades to FREE.** A user must never see an error page because the
   `subscriptions` table was unreachable. On a *read* path that means the free tier; on a *spend*
   path it means refuse.
3. **Client-side checks stay, and are presentation only.** Hiding a control a member cannot use is
   good UI. It is not a control, and `docs/CLASSROOM.md` says so in one line: *if the UI and the
   API ever disagree, the API is right.*
4. **Every new gate needs a caller and a test that fails without it.**
   `lib/hardware/submitGate.test.ts` fails if any link in the submission chain is removed;
   `lib/lessons/access.test.ts` covers the lesson content route; `lib/orgs/classroomRoutes.test.ts`
   drives the real handlers and asserts the database is unchanged after a refusal.

## Consequences

- Some things simply cannot be gated the way the pricing page implies, and the honest response is
  to change the architecture rather than the copy. Exam attempts moved server-side
  (`supabase/schema-exams.sql`, `lib/exams/service.ts`) because a `localStorage` attempt cannot be
  graded credibly. Lesson bodies moved to server-only modules — see
  [ADR-0006](0006-lesson-bodies-are-server-only-modules.md).
- Paid content costs a round trip. `/learn/[slug]` renders three preview blocks for *every*
  document request, including a paying subscriber's first paint, and the tail arrives after mount.
  That is the price of having no server-readable session, and it buys the property that `curl`,
  Googlebot and a subscriber all receive the same HTML — no cloaking, nothing to bypass by turning
  JavaScript off.
- `supabase/schema-billing.sql` has **no user write policy at all** on `subscriptions`. Its absence
  is the billing security model.
- The controls are the application layer today, because the RLS policies have never been executed
  against a live project. That is stated wherever it matters and is item 1 of the pre-production
  checklist in `docs/SECURITY.md`.

## What must not be undone

Do not move authorisation into `middleware.ts`. Its header explains why: it would change the
behaviour of every route at once, and a middleware that half-enforces auth is worse than one that
does not try. Do not add a `userId` parameter to any route. Do not delete a gate because the UI
"already handles it".
