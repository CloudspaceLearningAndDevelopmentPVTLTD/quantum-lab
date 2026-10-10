# Data & accounts

Supabase provides Postgres and authentication. The schema is 29 tables across 15 idempotent migrations, and **every table has row-level security enabled**. Personal data is kept to the minimum the product needs: the only PII the platform stores is the email address in Supabase Auth. Payment details live with Stripe; the application keeps only a `stripe_customer_id`.

## Where data lives

The design is local-first wherever that is honest:

| Data | Signed out | Signed in |
| --- | --- | --- |
| Course progress | `localStorage` (`lib/lessons/progress.ts`) | Merged with `user_progress` on sign-in: union of completed lessons, best quiz score per lesson; pushed with a 1.5 s debounce. Fails soft to local on any error. |
| Saved circuits | `localStorage` (`lib/circuit-store.ts`), Free limit of 10 | `circuits` table; the limit is enforced by a server-side insert |
| Analytics | 1,000-event ring buffer on the device | Same; ingest stores nothing unless explicitly configured |
| Tutor conversation | Sent per request, never stored | Same; the agent has no database |
| Exam attempts, certificates | — (sign-in required) | `exam_attempts`, `exam_certificates`, graded server-side |

## Schema

Migrations are generated from the hand-edited `supabase/schema*.sql` files by `scripts/supabase-migrations.sh`, so the SQL a reviewer reads is the SQL that runs.

| Migration | Tables and functions |
| --- | --- |
| `01_core` | `circuits`; `set_updated_at()` trigger |
| `02_billing` | `subscriptions`, `hardware_usage`, `hardware_bonus`, `stripe_events`; `reserve_hardware_job()`, `apply_stripe_subscription()` |
| `03_exams` | `exam_attempts`, `exam_certificates` |
| `04_orgs` | `orgs`, `org_members`, `org_invites`, `org_assignments`, `org_progress`, `org_progress_consent`, `org_classes`, `org_class_members`; `is_org_member()`, `is_org_manager()` |
| `05_competitions` | `competitions`, `competition_entries`, `competition_leaderboard` view |
| `06_email` | `email_subscriptions` (double opt-in consent records) |
| `07_integrations` | `webhook_endpoints`, `api_keys` |
| `08_platform` | `platform_settings` (admin runtime configuration, versioned) |
| `09_experiments` | `experiments`, `experiment_steps`; `append_experiment_step()` |
| `10_analytics` | `analytics_events` |
| `11_sessions` | `runtime_sessions` (IBM runtime session ownership) |
| `12_runs` | `published_runs` (immutable, enforced by trigger), `published_runs_public` view |
| `13_budgets` | `spend_budgets`; `spend_in_window()`, `reserve_hardware_job_within_budget()` |
| `14_byok` | `user_provider_credentials` |
| `15_hardening` | `user_progress`; org-seat integrity triggers; server-side circuit inserts |

## Row-level security as the authorisation model

Policies exist only where a browser legitimately touches a row with the anon key:

- `circuits`: read own and public, write own.
- `user_progress`, `spend_budgets`: own rows.
- `subscriptions`, `hardware_usage`, `hardware_bonus`: **read own, no user writes.** The absence of a write policy is the billing security model; a browser can see its quota but cannot grant itself one.
- Org tables: 21 policies. Members read their org; owners and admins (`is_org_manager`) write; a member can write only their own progress and consent rows. Creating an org requires the caller's own active subscription at the same plan, which closed an audit finding where a Free user could self-grant University seats.
- `published_runs`: world-readable, never editable.

Tables with RLS enabled and **no policies at all** are service-role only: `stripe_events`, the exam tables, competitions, `email_subscriptions`, `webhook_endpoints`, `api_keys`, `platform_settings`, experiments, `analytics_events`, `runtime_sessions` and `user_provider_credentials`. The service-role key is read by 21 server-only modules and never reaches the client; `lib/env.ts` validates its presence at boot and every store falls back to memory or `localStorage` without it.

Triggers back up the policies where a policy cannot express the rule: `orgs_lock_licence_columns()` stops a user changing `plan_id`, `seats_total` or `owner_id`; `org_members_inherit_plan()` copies a seat's plan from its org; `published_runs_no_edit()` makes a published run immutable; `apply_stripe_subscription()` drops a webhook write whose event timestamp is older than the stored one.

## Secrets at rest

Two kinds of secret are stored in the database, and both go through `lib/platform/secretBox.ts`:

- **Admin-set LLM provider keys** in `platform_settings`.
- **Bring-your-own hardware credentials** in `user_provider_credentials`.

`secretBox` is AES-256-GCM with a random 12-byte IV and an authentication tag, serialised as `v1.<iv>.<ciphertext>.<tag>` in base64url. The key is `SETTINGS_ENCRYPTION_KEY` (64 hex characters used raw, or any string hashed with SHA-256), falling back to a SHA-256 derivation from the service-role key. Opening a sealed value with the wrong key or a tampered envelope returns `null` rather than throwing, and a column check requires the `v1.` shape so a plaintext secret cannot be inserted by mistake.

For hardware credentials, `lib/security/providerCredentials.ts` declares each field `secret: true|false`. Secret fields (IBM token, AWS secret key, Azure client secret) are sealed together; public fields (AWS access key id, Azure tenant and client ids) are stored in the clear so the owner can see which account is attached. The listing function's return type has no field for a secret, so it cannot leak one; `resolveProviderCredential` is the single plaintext path and is used for one outbound vendor call. The API service never writes a presented credential into its settings or environment, because concurrent requests would leak one user's account to another; each provider call gets an explicit session object.

## Authentication

Supabase Auth with magic links; no passwords are stored by the application. The browser client (`lib/supabase.ts`) is created lazily with `persistSession` and `autoRefreshToken`, returns `null` when unconfigured, and never throws. Tokens are sent as a bearer header, verified server-side with `supabase.auth.getUser(token)`, and the email on the token, lower-cased, is the only email the server trusts. Invite tokens for organisations are random and stored hashed (ADR-0008), accepted only when the verified email matches the invitation.
