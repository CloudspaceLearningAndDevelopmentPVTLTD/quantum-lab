# Agent benchmark

Quantum Lab publishes **real agent pass rates on its challenge set** instead of
adjectives. "Works great with AI agents" is marketing; "model X passed 24 of 31
challenges under these exact rules, and here is the harness so you can check"
is evidence. This document is the methodology; the numbers live at
`/benchmark`, rendered from `results/agent-bench.json`.

| Piece | Where |
| --- | --- |
| Harness (runnable by any operator) | `scripts/agent-bench.mjs` |
| Pure core: prompt, extraction, aggregate math | `apps/web/lib/bench/harness.ts` (unit-tested in `harness.test.ts`) |
| Results file | `results/agent-bench.json` (git-ignored territory until you choose to commit a run) |
| Public page | `apps/web/app/benchmark/page.tsx` → `/benchmark` |
| Grader (the same one, not a copy) | `apps/web/lib/challenges/grade.ts` |

## How to run

```bash
ANTHROPIC_API_KEY=sk-ant-... node scripts/agent-bench.mjs \
  [--model claude-sonnet-4-5] \
  [--generated 9] \
  [--delay-ms 1500] \
  [--out results/agent-bench.json]
```

Requirements: `npm install` has run (the harness uses the repo's vendored
TypeScript compiler to load the web app's grading modules — the same
transpile-to-temp technique as `scripts/export-lessons.mjs`, so **no dev server
needs to be running** and no new dependency is declared) and Node ≥ 18.17 for
global `fetch`. Without `ANTHROPIC_API_KEY` the script prints what is missing
and exits without calling anything or writing anything.

A default run is 31 challenges (22 catalogue + 9 generated) at up to 2 API
calls each, made **strictly serially** with a delay between calls and a single
retry on 429/529 — deliberately rate-limit friendly, deliberately slow. Budget
a few minutes and roughly 60 model calls.

## Methodology

### Challenge set and ordering

Deterministic, always the same, in this order:

1. Every challenge in `lib/challenges/catalogue.ts`, in catalogue order
   (currently 22, spanning `target-state`, `target-distribution`,
   `fix-the-bug`, `oracle`, `gate-golf`).
2. `--generated N` seeded generated challenges (default 9) from the same
   verified generator the `generate_challenge` MCP tool uses. The specs are a
   pure function of N (`plannedGenerated`): kinds rotate fastest, difficulty
   ramps 1→3, seeds start at 1000. Same N on any machine, same puzzles.

### The prompt

Fixed, versioned (`PROMPT_VERSION` in `lib/bench/harness.ts`, stamped into
every run), built by `buildPrompt`. The model is shown what the public MCP
surface shows a solver — no more:

- an instruction to reply with **one complete OpenQASM 3 circuit in a single
  ` ```qasm ` fenced block**, no `measure` instructions (the grader inspects
  the final statevector);
- the supported gate set, the `qubit[N] q;` register form, and the MSB-first
  labelling convention;
- the challenge title, kind, level, and full brief;
- the register size; par (marked as *enforced* only for `gate-golf`, a target
  otherwise — mirroring `grade.ts`);
- `targetProbabilities` and tolerance where the challenge defines them
  (basis-state order 0…2ⁿ−1, MSB-first labels);
- the starting circuit as QASM, where the challenge provides apparatus.

Hints are **not** shown up front. Oracle challenges' `targetSigns` are not
listed numerically; the brief states the required signs in words, which is
exactly what a human solver gets.

### Attempts

**At most 2 per challenge.** After a failed first attempt, the retry prompt
appends the grader's own verdict — the summary, every failed check's detail,
and the challenge's **first hint** — which is byte-for-byte the escalation the
`grade_challenge` MCP tool returns on a fail. Nothing else changes between
attempts. A reply with no extractable QASM counts as a failed attempt.

### Answer extraction

`extractQasm` (pure, tested): the last fenced block containing `OPENQASM`,
else the last block labelled `qasm`, else bare text from the first `OPENQASM`
through the last `;`-terminated line. If nothing QASM-shaped exists the
attempt fails — the harness never guesses on the model's behalf.

### Grading — what a pass means

The extracted QASM is parsed with `fromQasm` and graded by
`grade(challenge, circuit)` from `lib/challenges/grade.ts` — **the identical
code path behind the app's challenge workbench and the `grade_challenge` MCP
tool**, loaded from the same source files, not reimplemented. A **pass** means
`verdict.passed === true` under that grader's real rules: correct register
width; every basis-state probability within the challenge's tolerance;
amplitude signs where the challenge is an oracle; the gate limit enforced for
`gate-golf` and only there. Global phase is ignored, and the grader sees only
the final state — the same known limits the catalogue documents for human
solvers apply here.

### Reported numbers

Per run (`results/agent-bench.json`, appended per invocation):

- `model`, `date` (ISO), `promptVersion`, `attemptsPerChallenge`,
  `catalogueCount`, `generatedCount`;
- per challenge: id, source (`catalogue`/`generated`), kind, level, pass/fail,
  which attempt passed, and each attempt's extraction/verdict summary;
- `aggregate`: overall pass rate, **first-try pass rate** (the stricter
  no-retry number), and a per-kind breakdown — all computed by the tested
  `aggregate` function.

## Caveats, stated up front

- Runs at different `PROMPT_VERSION`s are **not comparable**; the version is
  in every run for exactly this reason.
- Model sampling is not seeded — the API offers no determinism guarantee — so
  re-running the same model can move a few percentage points. The challenge
  set, prompt, and grading are deterministic; the model is the only noise
  source.
- This measures a model with **one fixed prompt and one feedback round**, not
  a full agent loop with simulator access. An agent using the MCP tools
  (`run_circuit`, iterative grading) should do better; this benchmark is the
  conservative floor, which is the honest number to publish.
- Pass rates on `generated` challenges depend on `--generated N`; compare runs
  at the same N (the run records it).

## Submitting results

1. Run the harness against the model you want to report, with defaults
   (`--generated 9`, stock prompt — an edited prompt is a different benchmark
   and a bumped `PROMPT_VERSION`).
2. Open a PR containing the updated `results/agent-bench.json` (the harness
   appends; do not hand-edit runs) and nothing else, with the model id, date,
   and headline rate in the PR description.
3. Reviewers can spot-check any per-challenge verdict by replaying the
   attempt's QASM through `grade_challenge` (over MCP or `lib/mcp/server.ts`
   directly) — the grader is deterministic, so the verdict must reproduce.

Runs render at `/benchmark`, newest first. When no results file exists the
page shows an honest empty state — there is no sample data anywhere in the
pipeline, by design.
