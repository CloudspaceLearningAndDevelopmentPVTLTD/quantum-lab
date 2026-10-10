# Launch checklist — qubit16.ai

What has to be true, outside this repo, for the public launch to work. Each
item names the failure you get if it is skipped, so it can be triaged rather
than trusted. Code-side wiring is `infra/azure/.env.production` +
`bash infra/azure/deploy.sh` (see docs/DEPLOYMENT-AZURE.md); this file is
the rest.

## Verify after every deploy

```bash
curl -s "https://qubit16.ai/api/health?deep=1&token=$HEALTH_DEEP_TOKEN"
curl -s https://qubit16.ai/api/agent
```

The first reports every subsystem as `ok` / `skipped` (not configured) /
`failing` (configured, not answering), including `launchTrial`, `email`,
`modelProvider` and `deepProbeToken`. The second reports which tutor tier is
live: `"source":"agent"` (full tool-calling tutor), `"direct"` (model, no
tools) or `"offline"` (no key reached production).

## Supabase — sign-in will not work until these are set

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://qubit16.ai`. Default is `http://localhost:3000`;
  with the default every magic link in every sign-in email redirects the
  user to localhost. This is the single most common "login is broken" cause.
- **Redirect URLs**: add `https://qubit16.ai/**` (and the
  `https://quantum-lab-web.*.azurecontainerapps.io/**` URL if that hostname
  should keep working). `components/auth/useSession.ts` passes
  `${window.location.origin}/account?next=<path>` as `emailRedirectTo` (so a
  user returns to the page they signed in from); an origin not on this list
  is refused, and the `/**` wildcard is what lets the `?next=` through.

Dashboard → **Authentication → Providers → Email**: keep *Email* enabled;
the app signs in by magic link (`signInWithOtp`), no passwords.

Dashboard → **Authentication → Email Templates → Magic Link**: add the
one-time code to the body, e.g. `<p>Or enter this code: <strong>{{ .Token }}</strong></p>`.
The sign-in panel offers "Sign in with code" (`verifyOtp`) for the cases a
link cannot handle: reading the email on a phone while signing in on a laptop,
and corporate/school mail scanners that pre-open the single-use link so the
real click says "expired". Without `{{ .Token }}` in the template the code
box is still shown but the email contains no code to type.

Dashboard → **Project Settings → Authentication → SMTP Settings**:

- The built-in sender is for development. It is rate-limited to a handful
  of messages per hour and Supabase reserves the right to throttle it
  further; at launch traffic sign-in emails will simply stop arriving.
- Set **custom SMTP**. Resend provides it with the same account that
  serves the app's own email: host `smtp.resend.com`, port `465`, user
  `resend`, password = the Resend API key, sender = the verified
  `EMAIL_FROM` address. One provider, both mail paths.

Schema: `supabase link --project-ref <ref>` then `supabase db push`
(supabase/README.md). Confirm with **Table Editor** showing `circuits`,
`subscriptions`, `exam_attempts`, `orgs`… (19 tables).

Compatibility note: the project uses the newer `sb_publishable_…` key
format with `@supabase/supabase-js` 2.45. Supabase documents the new keys as
compatible with existing client libraries; the first real magic-link sign-in
on qubit16.ai is the confirmation. If it fails with an API-key error, the
fix is either the legacy `anon` JWT from the same dashboard page, or a
supabase-js upgrade.

## Email on the qubit16.ai domain (Cloudflare + Resend)

Cloudflare can **receive** for the domain but cannot **send** transactional
mail; the app is wired for Resend (free tier: 3,000/month).

1. Resend → **Domains → Add** `qubit16.ai`. It shows three DNS records
   (DKIM TXT, SPF/MX for the return path, DMARC TXT).
2. Cloudflare → DNS → add those records exactly, **DNS only** (grey cloud).
3. Resend → **Verify**; then **API Keys → Create** → paste into
   `RESEND_API_KEY`. `EMAIL_FROM="Qubit16 <hello@qubit16.ai>"`.
4. Cloudflare → **Email → Email Routing → Enable**, add a route
   `hello@qubit16.ai → <your inbox>`. This is inbound only, and is what
   makes replies to the app's emails, and the address in the site footer,
   reach a human. Cloudflare adds its own MX records for this; Resend's
   return-path MX is on a subdomain, so the two do not collide.

## Azure

- **Stray registry**: `az acr list -g quantum-lab-rg -o table`. A failed
  earlier deploy created a second Basic registry; only the one the apps pull
  from should remain (each is ~$5/month).
  `az acr delete -n <unused> -g quantum-lab-rg --yes`.
- **Custom domain** on `quantum-lab-web`: `az containerapp hostname list
  -n quantum-lab-web -g quantum-lab-rg -o table` should show `qubit16.ai`
  as `SniEnabled`. deploy.sh reads this to bake the public URL and the CORS
  allow-list.
- **Cost alert**: deploy.sh attempts a $50/month budget; if the CLI lacks
  the role, set it in the portal (Cost Management → Budgets).

## AI tutor

- `GEMINI_KEY` in `.env.production` (free tier). After deploy,
  `curl -s https://qubit16.ai/api/agent` should say `"source":"agent"`.
  `"offline"` means no key reached production; `"direct"` means the key is
  on web but `services/agent` is not answering (check its
  `/api/agent/health`).
- Optional: `FORCE_LLM_PROVIDER` to pin a provider (docs/LLM-GATEWAY.md).
- **Platform console.** Put your own address in `PLATFORM_ADMIN_EMAILS` in
  `.env.production`, deploy, sign in, open `/account` → "Open the console"
  (`/admin/platform`). From there add / test / replace keys, reorder
  providers, and set what signed-out, free, trial and paid learners get —
  no redeploy. Needs `SUPABASE_SERVICE_ROLE_KEY` and the `platform_settings`
  table (`supabase db push` after pulling — migration 0008). deploy.sh
  generates `SETTINGS_ENCRYPTION_KEY` and appends it to the env file; keep
  that file.

## Launch trial

`NEXT_PUBLIC_LAUNCH_TRIAL_DAYS=30` with Supabase + service-role key set. The
health probe's `launchTrial` line states which of three states you are in:
off, on-and-expiring, or on-but-cannot-expire (service key missing). Turn
it off later by blanking the variable and redeploying; nothing else changes.

## Not yet wired (deliberately)

- **Stripe** — billing is off for the launch trial; leave the keys blank.
- **Real hardware** — `IBM_QUANTUM_TOKEN` / AWS Braket keys when wanted;
  `/hardware` says which is missing.
- **Sentry**, **Upstash** — optional; the app degrades without them.
