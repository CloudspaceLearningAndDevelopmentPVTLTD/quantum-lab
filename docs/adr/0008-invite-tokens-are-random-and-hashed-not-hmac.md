# ADR-0008 — Invite tokens are random and hashed, not an HMAC

**Status:** accepted · **Applies to:** `apps/web/lib/orgs/invites.ts`, `supabase/schema-orgs.sql`

## Context

An organisation invites someone to a seat. The invitee gets a link, clicks it, and joins.

The original scheme encoded `(orgId, email)` with a djb2 checksum. It was **deterministic and
reversible**: anyone could mint a valid token for any (org, email) pair in two lines of JavaScript
and claim a seat on a stranger's licence. The module's own header said so.

The obvious replacement is a stateless HMAC over `(org, email, expiry)` with a server secret.

## Decision

A **32-byte cryptographically random token**, stored only as its **SHA-256 hash**, with an
**expiry** and **single use**.

The HMAC was rejected for three reasons:

1. **Single use is the property that matters here.** An invite link travels by email. It gets
   forwarded, logged by mail scanners, and pasted into chat. A stateless HMAC is replayable by
   everyone who ever sees it until it expires. Making it single-use needs a row to burn — at which
   point the row exists and the HMAC has bought nothing.
2. **An HMAC needs a server secret.** Quantum Lab runs with an entirely empty environment by
   design, so an unset secret would have to either disable invites or fall back to something
   weaker. "Secure only when an optional variable is set" is the exact failure mode this project's
   audits keep finding.
3. **`public.org_invites` already exists**, already has an `accepted_at` column, and is already
   read on the acceptance path. The row is not a new cost.

## Consequences

- **The token says nothing.** It is an opaque lookup key, so the org and the email must be read
  from the stored row. There is no offline "decode the link" path any more, and there must not be —
  that path *was* the vulnerability.
- **The raw token exists exactly once**, in the scope that creates it and in the URL that is
  emailed. It is never stored and never logged.
- **Re-running `supabase/schema-orgs.sql` deletes every unclaimed invite.** Lines 115–152 are a
  migration block that runs only when the old `org_invites.token` column exists, and it executes
  `delete from public.org_invites where accepted_at is null;`. That is deliberate: the old tokens
  are forgeable, and hashing them would preserve keys an attacker can compute. Export pending
  invitations before you run it, then re-send them from the admin console. Old links are dead and
  stay dead — that is the fix working. On a fresh project the block does not run at all.
- Invite delivery is best-effort. `POST /api/orgs/invite` calls `sendEmail` directly, server-side,
  behind its own authentication and role check, and reports the outcome as `{ emailSent,
  emailReason? }`. The response also carries the accept URL, which is the only path that works with
  email unconfigured.

## What must not be undone

Do not add a decode path, a "which org is this invite for" endpoint that takes a raw token without
consuming it, or a fallback token scheme for when some secret is unset. Do not remove the
single-use burn.
