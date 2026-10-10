# Microsoft for Startups Founders Hub — credit milestones

Source: https://learn.microsoft.com/en-us/startups/microsoft-for-startups/getting-started-mfs#credit-milestones-and-requirements
(fetched August 2026 — re-check the live page before relying on exact numbers,
Microsoft can and does change program terms).

Unlike most "startup credit" programs, Founders Hub's tiers are gated purely
on **Azure usage**, not funding, revenue, or product stage:

| Milestone | Credit | Requirement |
| --- | --- | --- |
| 1 | $200 | Sign up + verify identity (personal LinkedIn account, not a business one) |
| 2 | $5,000 | Business verification — confirm a registered legal entity |
| 3 | $25,000 | **5+ distinct Azure services**, each with ≥$1 spend, sustained ~60 days |
| 4 | $50,000 | **7+ distinct services**, same $1-each bar, sustained ~60 days |
| 5 | $150,000 | **10+ services**, plus ~$3,000/month total spend, sustained ~60 days |

Progression is automatic once the bar is met — no re-applying per tier. Apply
once at [portal.startups.microsoft.com](https://portal.startups.microsoft.com/),
link this Azure subscription, and the dashboard tracks the rest.

## What counts toward Milestone 3 from this repo

The base `infra/azure/deploy.sh` run (web/api/agent on Container Apps) touches
roughly **2** distinct billed services:

1. Azure Container Registry
2. Azure Container Apps

`infra/azure/deploy.sh`'s optional `ENABLE_MILESTONE_WORKLOADS=true` section
adds 3 more, chosen to be *usable* rather than throwaway:

3. Azure Database for PostgreSQL Flexible Server (Burstable B1ms, ~$13/mo)
4. Azure Cache for Redis (Basic C0, ~$16/mo)
5. Azure OpenAI Service (pay-per-token, ~$0-a few dollars depending on use)

That's 5 — the Milestone 3 bar — for roughly **+$30-40/month** on top of the
base deployment, sustained for ~60 days before the $25,000 unlocks.

## What actually gets wired in now

Provisioning used to stop at "resource exists, app doesn't know about it."
As of this update, `infra/azure/deploy.sh`'s `ENABLE_MILESTONE_WORKLOADS`
section also connects each resource to the running app — not by replacing
Supabase (still the primary datastore for auth/user data) or Upstash (still
the primary rate-limit store), but by giving each Azure resource its own
real, additive job:

- **Azure Database for PostgreSQL** → durable job history. The live job
  queue (`app/jobs/store.py`, in-memory or Redis) was never meant to be a
  system of record — Redis expires jobs after 24h by design, memory is
  capped at 500. `app/jobs/archive.py` mirrors every finished job into a
  `job_history` table the moment `DATABASE_URL` is set, giving learners (and
  you) a real run history beyond that window. New endpoint:
  `GET /api/jobs/history`. Best-effort and lazily-imported throughout — a
  slow or unreachable Postgres degrades to "no history," never a broken
  queue.
- **Azure Cache for Redis** → the job store itself. `app/jobs/store.py`
  already had a `RedisJobStore` implementation (multi-process-safe, unlike
  the in-memory default) gated on `REDIS_URL` — it just never had a Redis to
  point at outside `docker-compose.yml`'s local dev profile. The deploy
  script now wires the real `rediss://` connection string in once
  provisioning finishes (Redis takes 15-20 min; the script waits).
- **Azure OpenAI** → a fourth selectable LLM provider, alongside Gemini/
  Groq/Anthropic in `docs/LLM-GATEWAY.md`. The script creates a
  `gpt-4o-mini` deployment and sets `AZURE_API_KEY`/`AZURE_API_BASE`/
  `AZURE_API_VERSION` on both `quantum-lab-agent` (Python, via LiteLLM's
  `azure/<deployment>` model id) and `quantum-lab-web` (Node, via
  `@ai-sdk/azure`). It is deliberately NOT the default — Gemini's free tier
  still wins cost-wise — so it activates only when `MODEL=azure/gpt-4o-mini`
  / `TUTOR_MODEL=gpt-4o-mini` are also set, which the script does not do
  automatically.

Each of these degrades exactly like the Redis store already did before this
change: unset or unreachable means "off," never a crash. None of it was a
Supabase or Upstash replacement, on purpose — those still do the jobs they
were doing; these three resources now do new, genuinely useful jobs instead
of sitting idle generating milestone-qualifying spend for its own sake
(which, to be clear, was and still is sufficient by itself for Founders
Hub's counting — the program only checks the Azure bill).

One resource re-run caveat: Postgres's admin password is generated at
creation and Azure never returns it again, so `DATABASE_URL` is only
auto-wired on the run that *creates* the server. If it already existed
before this section ran, wire `DATABASE_URL` by hand once (see the script's
own printed instructions).

## Turning it off

`ENABLE_MILESTONE_WORKLOADS` defaults to `false` — the base deploy never
creates these 3 resources unless you explicitly opt in. To stop the ongoing
spend once you've held the milestone requirement for the needed ~60 days (or
decide not to pursue this): delete each resource individually (they're *not*
covered by the `az group delete` teardown note in `docs/DEPLOYMENT-AZURE.md`
if you want to keep the base web/api/agent deployment running while dropping
just these 3):

```bash
az postgres flexible-server delete -n quantum-lab-pg-<suffix> -g quantum-lab-rg --yes
az redis delete -n quantum-lab-redis-<suffix> -g quantum-lab-rg
az cognitiveservices account delete -n quantum-lab-aoai-<suffix> -g quantum-lab-rg
```
