# Integrations: the four-layer surface

How an external agent platform (Vegaduta is the motivating one, but nothing
here is Vegaduta-specific) connects to Quantum Lab. Four layers, from
preferred to fallback:

| # | Layer | Direction | Endpoint | Auth |
|---|-------|-----------|----------|------|
| 1 | **MCP** (primary) | pull | `/api/mcp/mcp` | none (public/compute tools only) |
| 2 | **REST tool API** (fallback) | pull | `/api/tools` | none (same posture as MCP) |
| 3 | **Webhooks** | push | your URL, managed at `/api/hooks` | HMAC-signed deliveries; management requires a Supabase token |
| 4 | **Widget-by-another-agent** | embed | the app's public pages | n/a |

## 1. MCP — the primary surface

The full tool registry (`apps/web/lib/mcp/server.ts`, docs/MCP.md): seventeen
tools — eleven core (simulation, step inspection, challenge listing and
grading, session plan, notebook export, hardware submission, lessons and the
gate reference), one verified generate→verify→repair loop, and five
experiment-record tools. Every clamp and every paywall decision lives in the registry.
If your platform speaks MCP, use this and ignore layer 2.

## 2. REST tool API — the fallback

For platforms that can only call plain HTTP tools.

```
GET  /api/tools            → the tool list with JSON Schemas
POST /api/tools            → {"tool": "run_circuit", "args": {"qasm": "...", "shots": 256}}
```

Only two tools are exposed — `run_circuit` and `grade_challenge` — because
that is the minimal "do something" surface an agent needs; catalogue reads
stay MCP-only. The route (`apps/web/app/api/tools/route.ts`) imports the MCP
registry read-only, so limits are identical by construction: 16 qubits, shots
clamped to 1–4096, 20k chars of QASM. Responses:

* `200 {"tool", "ok": true, "result": {…}}` — the same structured payload MCP returns
* `422 {"ok": false, "error"}` — tool-level failure (bad QASM, unknown challenge id)
* `400` — malformed request or unknown tool name; `429` — rate limited (30/min/IP)

## 3. Webhooks — the push half

Register a receiver and Quantum Lab POSTs signed events to it. Everything is
account-scoped: you register with your Supabase access token, and you only
ever receive events about your own account.

### Managing endpoints (`/api/hooks`, token required)

```bash
# Register — the ONLY response that ever contains the secret. Save it.
curl -X POST https://<host>/api/hooks \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"url": "https://agent.example.com/ql-hook", "events": ["exam_passed", "hardware_job_finished"]}'
# → 201 {"endpoint": {…}, "secret": "whsec_…", "durable": true|false}

curl https://<host>/api/hooks -H "Authorization: Bearer $TOKEN"          # list (fingerprints only)
curl -X DELETE "https://<host>/api/hooks?id=whk_…" -H "Authorization: Bearer $TOKEN"
```

`durable: false` means this deployment has no Supabase service role and the
registration lives in one Node process's memory — it will not survive a
restart. Same honesty contract as the exam store.

### Events

| Event | Fires when | Payload `data` |
|-------|-----------|----------------|
| `exam_passed` | a signed-in candidate's attempt is graded as a pass (server-side, after the score is durably written) | `examId, attemptId, score, passed, submittedAt, closedBy` |
| `hardware_job_finished` | the server first observes a hardware job in a terminal state (`done` / `error` / `cancelled`) via the job-status proxy | `provider, jobId, status` — never the measurement counts; those stay behind the authenticated, owner-checked job route |
| `challenge_completed` | **currently never** — see below | reserved |

**`challenge_completed` is declared but has no sender.** In-app challenge
completion is recorded client-side (localStorage); there is no server-side
completion record, so there is no honest seam to fire from — an event fired
from an unauthenticated client claim would be a forgeable credential. The
event type exists so that a future server-side completion path (e.g. an
authenticated "record my pass" endpoint) can fire it without a schema or API
change. Subscribing to it today is accepted and delivers nothing.

### Delivery contract

* `POST` with `content-type: application/json`. Body:
  `{"id": "evt_<hex>", "event": "...", "createdAt": "<ISO>", "data": {…}}`
* Headers: `X-Quantum-Lab-Signature: sha256=<hex>`,
  `X-Quantum-Lab-Event`, `X-Quantum-Lab-Delivery`.
* **At-least-once.** Retries duplicate; a second app instance can re-observe a
  terminal job poll. Deduplicate on `id` (or on `data` for the hardware event).
* Up to 3 attempts per delivery (backoff 0.5s, then 2s; 5s timeout each).
  Any 2xx is success. Redirects are **not** followed.
* 10 consecutive failed deliveries disable the endpoint (`active: false`).
  Re-enable by deleting and re-registering.
* Delivery is fire-and-forget from the emitting request — a slow receiver
  never slows grading or job polling, and ordering is not guaranteed.

### Verifying the signature

Recompute HMAC-SHA256 over the **raw request bytes** with your `whsec_…`
secret and compare constant-time. Do not parse-then-re-serialise the JSON
first; re-serialisation reorders keys and the comparison fails.

```js
// Node / Express-style receiver. Capture the raw body.
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody /* Buffer */, signatureHeader, secret) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = (signatureHeader ?? "").replace(/^sha256=/, "");
  return (
    got.length === expected.length &&
    timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"))
  );
}
```

## 4. Widget-by-another-agent

The zero-integration layer: another product's agent simply links or frames
the public pages (the circuit builder, a challenge, `/verify/<certificate>`).
Nothing to register, nothing to sign; the pages carry their own auth where
they need it. This layer is listed so that "we integrated with Quantum Lab"
claims have a name for it — it grants nothing the anonymous web does not.

## Security posture

* **Management is authenticated; delivery is signed.** `/api/hooks` requires
  a Supabase-verified caller (same `verifiedCallerId` as billing); endpoint
  rows are owner-only (RLS with no policies + service-role writes — see
  `supabase/schema-integrations.sql`).
* **SSRF guard**: webhook URLs must be https, and hostnames that are IP
  literals in private/reserved ranges (10/8, 127/8, 169.254/16, 172.16/12,
  192.168/16, 100.64/10, 0/8), decimal/hex IP spellings, `localhost`, and all
  IPv6 literals are refused — at registration and again at every dispatch.
  Stated limitation: the guard validates the hostname, not what DNS resolves
  it to later; DNS rebinding is out of scope without an egress proxy.
* **Payload minimisation**: webhook bodies carry identifiers and outcomes,
  never lesson bodies, answer keys, or hardware measurement counts.
* **Secrets**: server-generated (`whsec_` + 32 random bytes), returned once,
  stored server-side because HMAC signing needs the raw key (a hash-only
  store cannot sign — the schema file explains the `secret` / `secret_hash`
  pair). Rotation = delete + re-register.
* **The compute surfaces (layers 1–2) are anonymous by design** and bounded
  by the IP-keyed rate limiter, with the honest ceiling described in
  `apps/web/lib/rateLimit.ts`.

Implementation: `apps/web/lib/integrations/webhooks.ts` (dispatch, guard,
store), tests beside it; seams in `apps/web/lib/exams/service.ts` (finalise)
and `apps/web/app/api/hardware/job/[provider]/[...jobId]/route.ts`.
