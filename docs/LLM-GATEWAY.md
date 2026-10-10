# The tutor's LLM provider — cheapest first, open-source gateways, not hand-rolled logic

Until 2026-08 this app only spoke to Anthropic — not for any principled
reason, just because that was what got wired in first, in both places that
call an LLM. With zero paying users, that meant paying full per-token rates
for every tutor question, when a free tier would have covered the same
traffic. This doc is the fix: the tutor now tries the cheapest configured
provider first, and provider selection is one environment variable, not a
code change, because both call sites go through an open-source gateway
library instead of a hand-rolled per-provider integration.

## The two call sites, two gateways

The tutor has two independent places that call an LLM, and they needed two
different gateways because they run on two different runtimes:

| Call site | Runtime | Gateway | Package |
| --- | --- | --- | --- |
| `services/agent/agent/core.py` — the tool-calling agent (can run circuits to check its own answers) | Python | [LiteLLM](https://github.com/BerriAI/litellm) | `langchain-litellm` |
| `apps/web/app/api/agent/route.ts` — the direct-call tier (no tools, used when the agent service is unreachable) | Node/Next.js | [Vercel AI SDK](https://github.com/vercel/ai) | `ai` + `@ai-sdk/google` + `@ai-sdk/groq` + `@ai-sdk/anthropic` |

Both are open source, both are the standard, actively-maintained way to call
"whichever LLM provider is configured" from their respective ecosystem, and
neither required writing retry, request-shaping, or provider-selection logic
by hand — that is the point of using a gateway instead of three SDKs.

## Provider order, and why

Cheapest first, since there are no real customers yet to justify eating
Anthropic's per-token rate as a default:

1. **Gemini Flash** (`GEMINI_API_KEY`) — Google AI Studio has a genuinely
   free tier, rate-limited but real. This is the default the moment any key
   is set and nothing else overrides `MODEL`/`TUTOR_MODEL`.
2. **Groq** (`GROQ_API_KEY`) — open-weight models (Llama) served on Groq's
   hardware. Extremely cheap, extremely fast, a notch below Gemini/Claude on
   nuanced physics explanations.
3. **Anthropic** (`ANTHROPIC_API_KEY`) — the premium option, kept as a
   selectable fallback, not removed.

Set only one key and that is the tier that runs. Set more than one and the
order above wins — Gemini beats Groq beats Anthropic — in both
`services/agent/agent/config.py` (env var `MODEL`, LiteLLM-style id like
`gemini/gemini-2.5-flash`) and `apps/web/app/api/agent/route.ts`
(`selectDirectProvider()`, env var `TUTOR_MODEL` for the per-provider model
id override). The two are independent settings — you can run the Python
agent on Gemini and the Next.js direct tier on Groq if you want to, though
there is no reason to.

## Switching providers

No code change, no redeploy of logic — only environment variables:

```bash
# services/agent (LiteLLM-style id — provider prefix picks the key it reads)
MODEL=gemini/gemini-2.5-flash        # default
MODEL=groq/llama-3.3-70b-versatile
MODEL=anthropic/claude-sonnet-4-6

# apps/web direct tier (bare model id — provider comes from which key is set,
# checked in the order above; TUTOR_MODEL overrides the per-provider default)
TUTOR_MODEL=gemini-2.5-flash          # default, if GEMINI_API_KEY is set
TUTOR_MODEL=llama-3.3-70b-versatile   # if GROQ_API_KEY is set
TUTOR_MODEL=claude-sonnet-4-6         # if ANTHROPIC_API_KEY is set
```

Both services still work with **zero** keys set — that is the offline tier,
same as before this change. `is_configured()` (Python) and
`hasDirectProviderKey()` (TypeScript) now check all three key names, not
just `ANTHROPIC_API_KEY`.

## Forcing a provider (admin override)

Cheapest-first is the right *default*, but an operator sometimes needs to
pin the tutor to a specific provider regardless of what is cheapest — to
force Azure for a demo, to route around a rate-limited Gemini key for a day,
or to A/B two providers' answer quality. Both services already support this,
one via a setting that predates this doc, the other newly added:

- **`services/agent`**: already fully overridable. `MODEL` *is* the
  provider — set `MODEL=azure/<deployment-name>` (or
  `anthropic/claude-sonnet-4-6`, `groq/llama-3.3-70b-versatile`) and LiteLLM
  reads that key's env vars directly. No separate override flag needed; this
  was true before this section was written.
- **`apps/web`**: `selectDirectProvider()` previously had no override —
  `TUTOR_MODEL` only changed *which model* a provider used, not which
  provider ran. Set `FORCE_LLM_PROVIDER` to pin it:

```bash
FORCE_LLM_PROVIDER=azure       # or gemini, groq, anthropic
```

Case-insensitive, whitespace-trimmed. If the forced provider's key isn't
actually configured (typo, stale value, key removed), selection falls back
to the normal cheapest-first order rather than taking the tutor offline —
a misconfigured override degrades to "ignored," not "broken." Covered by
`apps/web/lib/security/agentProviderSelection.test.ts`.

The two settings are independent, same as `MODEL`/`TUTOR_MODEL` above — you
can force the Python agent onto one provider and the Next.js direct tier
onto another, though there is no reason to.

## Runtime configuration — the platform console (`/admin/platform`)

Everything above is the **env layer**: what `infra/azure/deploy.sh` wires at
deploy time. Since 2026-09 there is a second layer on top of it that an
operator edits in the browser, live, with no redeploy:

| What | Where it lives | Who reads it |
|---|---|---|
| Provider API keys (Gemini / Groq / Anthropic / Azure OpenAI), model or deployment per provider, on/off | `platform_settings.llm` in Supabase, keys sealed with AES-256-GCM (`apps/web/lib/platform/secretBox.ts`) | `apps/web/lib/platform/settings.ts` → `effectiveLlmSettings()` (30 s cache) |
| Routing order and a "force one provider" switch | same row | `apps/web/lib/llm/resolve.ts` → `pickProvider()` |
| Access **by tier** — signed out / free / launch trial / paid: `live`, `offline` or `off`; a pinned provider; messages per day; whether the circuit-running agent is offered | same row | `resolveForTier()` in `/api/agent` (POST *and* the GET status probe) |

Precedence, highest first: the tier's `access` (an `off` tier never calls a
model) → `forceProvider` → the tier's pinned provider → the order, first
ready provider wins. A pinned or forced provider with no usable key is
skipped rather than taking the tutor offline — the same rule the old
`FORCE_LLM_PROVIDER` env var followed, which still works as the env-layer
default for `forceProvider`.

**Both runtimes follow one decision.** The web route resolves the provider,
then forwards `{ model, api_key, api_base, api_version }` to
`services/agent` as an `llm` field on `/api/agent/chat`; the Python service
hands it straight to `ChatLiteLLM` (`agent/core.py`, `LlmOverride`). Without
that the Python agent would keep using its own env vars and a change in the
console would only reach the direct fallback. An older agent build ignores
the field and behaves as before.

**Who is a platform admin.** `PLATFORM_ADMIN_EMAILS` on the web app —
comma-separated, matched against the *verified* email Supabase returns for
the caller's token (`apps/web/lib/platform/admin.ts`). This is deliberately
not `team.admin` (any Team buyer has that) and deliberately env, not a
table: the first admin has to come from somewhere, and a table an admin
edits is a table a stolen session can lock everyone out of. Admins see a
"Platform console" card on `/account`; nobody else sees anything.

**What the learner sees.** The status line under the tutor says which model
answers and today's allowance (`via Gemini · 10 messages a day signed out —
sign in for more`); the daily quota is counted per verified user id, or per
address when signed out, through `lib/rateLimit.ts` (Redis when configured).
The 429 body carries the offline answer so a capped learner still gets
something, plus `code: "quota"` and `tier` for the UI.

**Defaults when nothing is saved** (`DEFAULT_TIERS` in
`lib/platform/llmConfig.ts`): signed out 10/day, free accounts 20/day, the
launch trial and paid plans unlimited, everyone live, tools on. Change them
in the console; the row wins over the constants.

**Operational notes.** Health (`/api/health?deep=1`) reports the effective
provider per tier and whether the stored keys decrypt. Rotating
`SETTINGS_ENCRYPTION_KEY` makes every saved key unreadable — the console and
health both say so, and the tutor falls back to env keys for those
providers rather than to nothing. Saves carry the version the admin loaded
and are refused with 409 if someone else saved first. "Test" sends one
8-token prompt through the provider with the key in the form (or the stored
one) and persists nothing.

## What did NOT change

- The prompt-injection clamps (`INJ-1`: tool-round ceiling, wall-clock
  ceiling, history/character bounds, output token cap) — unaffected by
  provider. `apps/web/lib/security/agentClamps.test.ts` exercises them
  against the new AI-SDK request shape (content-part arrays, not plain
  strings — see that file's `partsToText()` helper) and all pass.
- The CORS wildcard refusal in both services.
- The `AgentExecutor` security-relevant parameters
  (`max_iterations`, `max_execution_time`, `early_stopping_method="force"`,
  `return_intermediate_steps=True`) in `services/agent/agent/core.py`.

## A bug this surfaced, unrelated to providers

While wiring this up, `services/agent/agent/core.py`'s
`from langchain.agents import AgentExecutor, create_tool_calling_agent`
turned out to be silently broken: `requirements.txt` pins `langchain>=0.3`
with no upper bound, and by 2026-08 that resolves to langchain 1.x, which
moved `AgentExecutor`/`create_tool_calling_agent` out to the separate
`langchain-classic` package. The import would `ImportError` the moment
`build_agent()` was actually called — caught only because this change
exercised that path directly. Fixed by adding `langchain-classic>=1.0` to
`requirements.txt` and importing from there instead; the legacy
`AgentExecutor` API (and every INJ-1 clamp written against it) still behaves
identically. Worth knowing: any other `langchain*` import in this codebase
pinned with an open `>=` range is a candidate for the same kind of drift.

## Cost note

At near-zero traffic, Gemini Flash's free tier should cover the tutor
entirely. `MAX_TOOL_ROUNDS`, `MAX_AGENT_SECONDS`, `MAX_HISTORY_TURNS`,
`MAX_MESSAGE_CHARS`, `MAX_SHOTS` (Python) and the matching constants in
`apps/web/app/api/agent/route.ts` are the actual spend caps regardless of
provider — they bound worst-case cost per request, not just steer it toward
a cheap model.
