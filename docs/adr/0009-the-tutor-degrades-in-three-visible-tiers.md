# ADR-0009 — The tutor degrades in three tiers, and says which one answered

**Status:** accepted · **Applies to:** `apps/web/app/api/agent/route.ts`, `app/api/agent/offlineFaq.ts`, `services/agent`

## Context

`/tutor` is the one page whose quality depends on configuration the operator may not have. Three
things can be true:

- `services/agent` is up, so the model can call `run_quantum_circuit` and **check its own answer**
  by executing the circuit;
- only `ANTHROPIC_API_KEY` is set, so there is a model but no tools;
- neither, so there is a built-in answer set covering roughly fifteen core topics.

The usual product answers are "require a key" (which breaks the promise that the whole app runs
with an empty environment) or "fail quietly to the weakest tier and say nothing".

## The failure this avoids

An AI tutor that answers confidently about a circuit it never ran, in a UI indistinguishable from
one that did, is teaching physics on the strength of a plausible-sounding string. `/simulator`
metadata used to promise that every tutor answer was verified by running the circuit; only the top
tier does that, and the copy has been corrected.

## Decision

Three tiers, tried in order, with **silent fall-through between them and the surviving tier named
on screen**.

| Tier | Condition | `source` | Status line |
| --- | --- | --- | --- |
| 1 | `AGENT_SERVICE_URL` reachable, 200, non-empty reply | `agent` | *Full tutor — can run circuits to check its answers* |
| 2 | `ANTHROPIC_API_KEY` set and the call succeeds | `anthropic` | *Direct model — no circuit execution* |
| 3 | anything else | `offline` | the offline set, named as such |

- **Fall-through is silent.** A network error, a timeout, a non-ok status, an unconfigured service
  or an empty reply all return `null` from `tryAgentService`; the learner never sees a failure for
  any of them.
- **A tier-2 network failure prepends an honest sentence** to the offline answer ("I couldn't reach
  the Anthropic API just now") rather than pretending the offline answer is the model's.
- **A 429 still carries a `reply`.** Without it the tutor renders a blank bubble. The body carries
  the canonical `{ error, code }` *and* `reply` + `source`.
- **`GET /api/agent` reports the tier that would serve a request right now**, which is what the
  status line reads. On a rate-limited probe it answers `offline` rather than 429: the UI treats a
  non-200 as no information, and "offline" is the honest floor.
- **`/api/agent` answers 200 on failure, deliberately.** The tutor's contract is "you always get a
  reply", and a 500 would replace its own honest degradation message with the browser's generic
  failure path. The failure is still reported to the error tracker.

Inside tier 1, `services/agent` degrades again and reports it: an unreachable `services/api` makes
`run_quantum_circuit` fall back to a local Aer run in-process, and a missing RAG index makes
`search_concepts` fall back to the 18-concept keyword base. `GET /api/agent/health` reports both as
`degraded`, never as `ok`, because retrieval **fails open** — the tutor keeps answering, and the
answers quietly stop being grounded in the course.

## Consequences

- Three code paths to maintain and three answer qualities to keep acceptable. The offline set is a
  real deliverable, not a stub.
- The status line is load-bearing UI. Removing it turns an honest degradation into a silent one.
- `docs/OPERATIONS.md` § Health endpoints, and `services/agent/docs/RAG.md`, hold the probe
  detail.

## What must not be undone

Do not make the tutor return a non-2xx on failure, do not remove `reply` from the 429 body, and do
not remove the tier indicator from the UI. Do not turn a tier-1 failure into a visible error — the
whole point is that the learner gets an answer.
