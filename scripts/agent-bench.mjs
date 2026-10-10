#!/usr/bin/env node
/**
 * agent-bench.mjs — the agent-vs-challenge benchmark.
 *
 * "Agents can solve our challenges" is an adjective; this script produces the
 * number. It presents every catalogue challenge (plus N seeded generated ones)
 * to a model through the Anthropic API with a FIXED, documented prompt,
 * extracts the QASM answer, and grades it through the SAME grade path the
 * `grade_challenge` MCP tool uses — `lib/challenges/grade.ts` over a circuit
 * parsed by `lib/quantum.ts`'s `fromQasm`. Not a reimplementation, not an HTTP
 * approximation: the literal modules, loaded the way `export-lessons.mjs`
 * established (transpile with the vendored TypeScript compiler into a temp
 * dir, then dynamic-import), so no dev server needs to be running and no new
 * dependency appears.
 *
 * The rules that make the number publishable (full text: docs/BENCHMARK.md):
 *   · Deterministic ordering — catalogue order, then generated specs that are
 *     a pure function of N (`plannedGenerated` in lib/bench/harness.ts).
 *   · Bounded attempts — at most 2 per challenge. The retry sees the grader's
 *     failed checks plus the FIRST hint, exactly what the MCP tool returns.
 *   · Rate-limit friendly — strictly serial, with a delay between API calls
 *     and a single retry on 429/overloaded.
 *   · The prompt, extraction, and aggregate math live in
 *     `apps/web/lib/bench/harness.ts`, pure and unit-tested; this file only
 *     adds the network, the clock, and the file writes.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/agent-bench.mjs \
 *     [--model claude-sonnet-4-5] [--generated 9] [--delay-ms 1500] \
 *     [--out results/agent-bench.json]
 *
 * Output: results/agent-bench.json — { version, runs: [...] }, appending a run
 * per invocation: { model, date, promptVersion, attemptsPerChallenge,
 * per-challenge pass/fail + attempts, aggregate }. Render at /benchmark.
 */

import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const WEB = path.join(ROOT, 'apps', 'web')

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-5'
const DEFAULT_GENERATED = 9
const DEFAULT_DELAY_MS = 1500
const MAX_TOKENS = 1600

// ────────────────────────────────────────────────────────────
// TS → temp .mjs loader (same technique as export-lessons.mjs)
// ────────────────────────────────────────────────────────────

/**
 * The modules the benchmark needs, transpiled flat into one temp directory.
 * The specifier map is explicit and closed: an import that is not in it is a
 * loud error, because a silently-dropped dependency would grade with a
 * different physics engine than the app ships.
 */
const MODULES = [
  { src: 'lib/quantum.ts', out: 'quantum.mjs' },
  { src: 'lib/challenges/types.ts', out: 'challenges-types.mjs' },
  { src: 'lib/challenges/grade.ts', out: 'challenges-grade.mjs' },
  { src: 'lib/challenges/generate.ts', out: 'challenges-generate.mjs' },
  { src: 'lib/challenges/catalogue.ts', out: 'challenges-catalogue.mjs' },
  { src: 'lib/bench/harness.ts', out: 'bench-harness.mjs' },
]

const SPECIFIER_MAP = {
  '@/lib/quantum': './quantum.mjs',
  './types': './challenges-types.mjs',
  './grade': './challenges-grade.mjs',
  './harness': './bench-harness.mjs',
}

async function loadWebModules() {
  // Hoisted to the workspace root by npm workspaces; resolution walks up.
  const ts = require('typescript')
  const options = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    esModuleInterop: true,
    isolatedModules: true,
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bench-'))
  try {
    for (const { src, out } of MODULES) {
      const source = fs.readFileSync(path.join(WEB, src), 'utf8')
      const emitted = ts.transpileModule(source, { compilerOptions: options, fileName: src })
      const rewritten = emitted.outputText.replace(
        /(from\s+['"])([^'"]+)(['"])/g,
        (whole, before, spec, after) => {
          const mapped = SPECIFIER_MAP[spec]
          if (!mapped) {
            throw new Error(
              `Unmapped import "${spec}" in ${src}. Add it to SPECIFIER_MAP (and MODULES) ` +
                'so the benchmark grades with the real module, not a hole.',
            )
          }
          return `${before}${mapped}${after}`
        },
      )
      fs.writeFileSync(path.join(tmp, out), rewritten, 'utf8')
    }
    const quantum = await import(pathToFileURL(path.join(tmp, 'quantum.mjs')).href)
    const gradeMod = await import(pathToFileURL(path.join(tmp, 'challenges-grade.mjs')).href)
    const generateMod = await import(pathToFileURL(path.join(tmp, 'challenges-generate.mjs')).href)
    const catalogueMod = await import(pathToFileURL(path.join(tmp, 'challenges-catalogue.mjs')).href)
    const harness = await import(pathToFileURL(path.join(tmp, 'bench-harness.mjs')).href)
    return { quantum, gradeMod, generateMod, catalogueMod, harness }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    model: DEFAULT_MODEL,
    generated: DEFAULT_GENERATED,
    delayMs: DEFAULT_DELAY_MS,
    out: path.join(ROOT, 'results', 'agent-bench.json'),
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--model' && value) (args.model = value), i++
    else if (key === '--generated' && value) (args.generated = Number(value)), i++
    else if (key === '--delay-ms' && value) (args.delayMs = Number(value)), i++
    else if (key === '--out' && value) (args.out = path.resolve(value)), i++
    else {
      console.error(`Unknown argument: ${key}`)
      console.error('Usage: node scripts/agent-bench.mjs [--model id] [--generated N] [--delay-ms ms] [--out file]')
      process.exit(2)
    }
  }
  if (!Number.isInteger(args.generated) || args.generated < 0 || args.generated > 50) {
    console.error('--generated must be an integer 0–50.')
    process.exit(2)
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    console.error('--delay-ms must be a non-negative number.')
    process.exit(2)
  }
  return args
}

// ────────────────────────────────────────────────────────────
// Anthropic API (plain fetch — no SDK dependency, by repo rule)
// ────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One message call. Retries ONCE on 429/529 (honouring retry-after when it is
 * sane), because a benchmark that dies at challenge 27 of 31 wastes the spend;
 * everything else is fatal — a wrong key or model id should stop the run
 * immediately, not fail 31 challenges one by one.
 */
async function askModel(apiKey, model, prompt) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (response.status === 429 || response.status === 529) {
      const retryAfter = Number(response.headers.get('retry-after'))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 120
        ? retryAfter * 1000
        : 20_000
      console.error(`  rate limited (${response.status}); waiting ${waitMs / 1000}s…`)
      await sleep(waitMs)
      continue
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 400)}`)
    }
    const payload = await response.json()
    const blocks = Array.isArray(payload.content) ? payload.content : []
    return blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  throw new Error('Anthropic API still rate-limited after one retry; aborting the run.')
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('agent-bench: no ANTHROPIC_API_KEY in the environment, so no model can be called.')
    console.error('Nothing was run and nothing was written. To produce a benchmark run:')
    console.error('')
    console.error('  ANTHROPIC_API_KEY=sk-ant-... node scripts/agent-bench.mjs --model <model-id>')
    console.error('')
    console.error('Methodology and what a pass means: docs/BENCHMARK.md.')
    process.exit(1)
  }

  const { quantum, gradeMod, generateMod, catalogueMod, harness } = await loadWebModules()
  const { fromQasm, toQasm } = quantum
  const { grade } = gradeMod
  const { generateChallenge } = generateMod
  const { CHALLENGES } = catalogueMod
  const {
    ATTEMPTS_PER_CHALLENGE,
    PROMPT_VERSION,
    aggregate,
    buildPrompt,
    extractQasm,
    plannedGenerated,
  } = harness

  // Deterministic task list: catalogue order, then the pure generated plan.
  const tasks = [
    ...CHALLENGES.map((ch) => ({ challenge: ch, source: 'catalogue' })),
    ...plannedGenerated(args.generated).map((spec) => ({
      challenge: generateChallenge(spec.kind, spec.difficulty, spec.seed),
      source: 'generated',
    })),
  ]

  console.log(
    `agent-bench: ${tasks.length} challenges (${CHALLENGES.length} catalogue + ` +
      `${args.generated} generated), model ${args.model}, ≤${ATTEMPTS_PER_CHALLENGE} attempts each, ` +
      `prompt v${PROMPT_VERSION}.`,
  )

  const results = []
  for (const { challenge, source } of tasks) {
    const presentation = {
      id: challenge.id,
      title: challenge.title,
      brief: challenge.brief,
      kind: challenge.kind,
      level: challenge.level,
      numQubits: challenge.numQubits,
      maxGates: challenge.maxGates ?? null,
      tolerance: challenge.tolerance ?? null,
      targetProbabilities: challenge.targetProbabilities ?? null,
      startingCircuitQasm: challenge.startingCircuit ? toQasm(challenge.startingCircuit) : null,
    }

    const attempts = []
    let feedback
    let passedOnAttempt = null
    for (let n = 1; n <= ATTEMPTS_PER_CHALLENGE && passedOnAttempt === null; n++) {
      const reply = await askModel(apiKey, args.model, buildPrompt(presentation, feedback))
      const qasm = extractQasm(reply)
      if (qasm === null) {
        attempts.push({ extracted: false, passed: false, score: null, summary: 'No OpenQASM block in the reply.' })
        feedback = {
          summary: 'Your reply contained no OpenQASM 3 code block, so nothing could be graded.',
          failedChecks: [],
          hint: null,
        }
      } else {
        const verdict = grade(challenge, fromQasm(qasm))
        attempts.push({
          extracted: true,
          passed: verdict.passed,
          score: verdict.score,
          summary: verdict.summary,
        })
        if (verdict.passed) {
          passedOnAttempt = n
        } else {
          feedback = {
            summary: verdict.summary,
            failedChecks: verdict.checks.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`),
            hint: challenge.hints[0] ?? null,
          }
        }
      }
      await sleep(args.delayMs)
    }

    const passed = passedOnAttempt !== null
    results.push({
      id: challenge.id,
      source,
      kind: challenge.kind,
      level: challenge.level,
      passed,
      passedOnAttempt,
      attempts,
    })
    console.log(
      `  ${passed ? 'PASS' : 'FAIL'}  ${challenge.id} (${challenge.kind})` +
        (passed ? ` on attempt ${passedOnAttempt}` : ` after ${attempts.length} attempts`),
    )
  }

  const run = {
    model: args.model,
    date: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    attemptsPerChallenge: ATTEMPTS_PER_CHALLENGE,
    catalogueCount: CHALLENGES.length,
    generatedCount: args.generated,
    challenges: results,
    aggregate: aggregate(results),
  }

  // Append to any existing runs so multiple models accumulate in one file.
  let existing = { version: 1, runs: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(args.out, 'utf8'))
    if (parsed && Array.isArray(parsed.runs)) existing = { version: 1, runs: parsed.runs }
  } catch {
    // First run, or an unreadable file — either way, start clean.
  }
  existing.runs.push(run)
  fs.mkdirSync(path.dirname(args.out), { recursive: true })
  fs.writeFileSync(args.out, JSON.stringify(existing, null, 2) + '\n', 'utf8')

  const agg = run.aggregate
  console.log('')
  console.log(`Overall: ${agg.passed}/${agg.total} (${(agg.passRate * 100).toFixed(1)}%), ` +
    `first-try ${(agg.firstTryPassRate * 100).toFixed(1)}%.`)
  for (const [kind, stat] of Object.entries(agg.byKind)) {
    console.log(`  ${kind}: ${stat.passed}/${stat.total} (${(stat.passRate * 100).toFixed(1)}%)`)
  }
  console.log(`Wrote ${path.relative(ROOT, args.out)}. The /benchmark page renders it.`)
}

main().catch((cause) => {
  console.error(`agent-bench failed: ${cause instanceof Error ? cause.message : cause}`)
  process.exit(1)
})
