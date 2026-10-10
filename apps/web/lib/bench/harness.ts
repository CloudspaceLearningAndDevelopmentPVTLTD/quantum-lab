/**
 * lib/bench/harness.ts — the PURE core of `scripts/agent-bench.mjs`.
 *
 * The benchmark's credibility rests on two things: the grading is the real
 * grader (`lib/challenges/grade.ts`, imported by the script through the same
 * transpile loader `scripts/export-lessons.mjs` established), and everything
 * that shapes a result — the prompt, the answer extraction, the aggregate
 * math — is deterministic and testable. That second half lives HERE, as
 * dependency-free functions, so `harness.test.ts` can pin it without an API
 * key, a network, or a dev server. The script keeps only what cannot be pure:
 * the Anthropic HTTP call, the delays, and the file writes.
 *
 * PROMPT_VERSION is part of every published result. If any function in this
 * file changes in a way that could move a pass rate (different prompt wording,
 * looser extraction), bump it — two runs are only comparable at the same
 * version, and a silent prompt tweak is exactly the kind of thumb-on-the-scale
 * this benchmark exists to rule out.
 */

/** Bump when the prompt or extraction changes in a rate-moving way. */
export const PROMPT_VERSION = 1

/** Attempts per challenge. Fixed, not configurable: a published pass rate at
 *  "up to 2 attempts, grader feedback in between" means one specific thing. */
export const ATTEMPTS_PER_CHALLENGE = 2

// ────────────────────────────────────────────────────────────
// Challenge presentation → prompt
// ────────────────────────────────────────────────────────────

/**
 * What the model is shown. Mirrors the public MCP surface (`list_challenges` /
 * `generate_challenge` in lib/mcp/server.ts): brief, register size, par,
 * target probabilities and tolerance where the challenge defines them, and the
 * starting circuit as QASM. Hints are NOT shown up front — same as MCP, a
 * failed grade earns the first hint (and only the first) in the retry
 * feedback. `targetSigns` for oracle challenges is not listed numerically
 * because the brief already states the required signs in words, which is the
 * same information a human solver gets.
 */
export interface ChallengePresentation {
  id: string
  title: string
  brief: string
  kind: string
  level: string
  numQubits: number
  maxGates: number | null
  tolerance: number | null
  targetProbabilities: number[] | null
  startingCircuitQasm: string | null
}

/**
 * Feedback carried into the second attempt: the grader's own words, plus the
 * first hint — exactly what the `grade_challenge` MCP tool returns on a fail.
 */
export interface AttemptFeedback {
  summary: string
  failedChecks: string[]
  hint: string | null
}

/**
 * The fixed benchmark prompt. Documented verbatim in docs/BENCHMARK.md; keep
 * the two in sync and bump PROMPT_VERSION if this changes.
 */
export function buildPrompt(p: ChallengePresentation, feedback?: AttemptFeedback): string {
  const lines: string[] = [
    'You are attempting a circuit challenge from Qubit16. Reply with ONE complete',
    'OpenQASM 3 circuit that solves it, inside a single ```qasm fenced code block.',
    'Do not include measure instructions — the grader inspects the final statevector.',
    '',
    'Supported gates: h x y z s sdg t tdg rx ry rz p cx cy cz swap ccx (controls listed',
    'first, e.g. cx q[0], q[1];). Declare the register as qubit[N] q;. Bitstring labels',
    'are MSB-first — qubit 0 is the rightmost character — matching Qiskit.',
    '',
    `Challenge: ${p.title} [${p.kind}, ${p.level}]`,
    p.brief,
    '',
    `Register: ${p.numQubits} qubit${p.numQubits === 1 ? '' : 's'}.`,
  ]
  if (p.maxGates !== null) {
    lines.push(
      p.kind === 'gate-golf'
        ? `Gate limit: at most ${p.maxGates} gates (enforced).`
        : `Par: ${p.maxGates} gates (a target, not a pass condition).`,
    )
  }
  if (p.targetProbabilities) {
    lines.push(
      'Target probabilities, basis states 0..2^n-1 with MSB-first labels: ' +
        `[${p.targetProbabilities.map((v) => Number(v.toFixed(6))).join(', ')}]` +
        (p.tolerance !== null ? ` (per-state tolerance ±${p.tolerance})` : ''),
    )
  }
  if (p.startingCircuitQasm) {
    lines.push('', 'Starting circuit (build on it by appending gates; do not assume you can', 'insert in the middle):', '```qasm', p.startingCircuitQasm.trim(), '```')
  }
  if (feedback) {
    lines.push('', 'Your previous attempt FAILED the grader:', `- ${feedback.summary}`)
    for (const check of feedback.failedChecks) lines.push(`- ${check}`)
    if (feedback.hint) lines.push(`Hint: ${feedback.hint}`)
    lines.push('Reply with a corrected, complete circuit in one ```qasm block.')
  }
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────
// Answer extraction
// ────────────────────────────────────────────────────────────

/** Matches fenced code blocks, capturing the info string and the body. */
const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g

/**
 * Pull the QASM answer out of a model reply.
 *
 * Preference order, chosen to reward the LAST thing the model committed to
 * (models often quote the starting circuit first and answer at the end):
 *   1. the last fenced block whose body contains "OPENQASM";
 *   2. the last fenced block whose info string names qasm;
 *   3. bare text: from the first "OPENQASM" through the last line that ends in
 *      a semicolon (trailing prose is dropped).
 * Returns null when nothing QASM-shaped exists — the attempt is then a fail,
 * never a guess.
 */
export function extractQasm(text: string): string | null {
  const fences: { info: string; body: string }[] = []
  let match: RegExpExecArray | null
  FENCE_RE.lastIndex = 0
  while ((match = FENCE_RE.exec(text)) !== null) {
    fences.push({ info: match[1].trim().toLowerCase(), body: match[2].trim() })
  }
  for (let i = fences.length - 1; i >= 0; i--) {
    if (/OPENQASM/i.test(fences[i].body)) return fences[i].body
  }
  for (let i = fences.length - 1; i >= 0; i--) {
    if (/^(open)?qasm/.test(fences[i].info)) return fences[i].body
  }
  const start = text.search(/OPENQASM/i)
  if (start === -1) return null
  const tail = text.slice(start).split('\n')
  let lastStatement = -1
  for (let i = 0; i < tail.length; i++) {
    if (/;\s*$/.test(tail[i])) lastStatement = i
  }
  if (lastStatement === -1) return null
  return tail.slice(0, lastStatement + 1).join('\n').trim()
}

// ────────────────────────────────────────────────────────────
// Results + aggregate math
// ────────────────────────────────────────────────────────────

export interface BenchAttempt {
  /** Whether a QASM block could be extracted from the reply at all. */
  extracted: boolean
  passed: boolean
  score: number | null
  summary: string | null
}

export interface BenchChallengeResult {
  id: string
  source: 'catalogue' | 'generated'
  kind: string
  level: string
  passed: boolean
  /** 1-based attempt index that passed, or null. */
  passedOnAttempt: number | null
  attempts: BenchAttempt[]
}

export interface KindStat {
  total: number
  passed: number
  passRate: number
}

export interface BenchAggregate {
  total: number
  passed: number
  passRate: number
  /** Pass rate counting only first attempts — the stricter, no-retry number. */
  firstTryPassRate: number
  byKind: Record<string, KindStat>
}

/** Ratio rounded to 4 decimals; 0 for an empty denominator, never NaN. */
function rate(passed: number, total: number): number {
  return total === 0 ? 0 : Math.round((passed / total) * 10000) / 10000
}

export function aggregate(results: BenchChallengeResult[]): BenchAggregate {
  const byKind: Record<string, KindStat> = {}
  let passed = 0
  let firstTry = 0
  for (const r of results) {
    const stat = (byKind[r.kind] ??= { total: 0, passed: 0, passRate: 0 })
    stat.total += 1
    if (r.passed) {
      stat.passed += 1
      passed += 1
      if (r.passedOnAttempt === 1) firstTry += 1
    }
  }
  for (const kind of Object.keys(byKind)) {
    byKind[kind].passRate = rate(byKind[kind].passed, byKind[kind].total)
  }
  return {
    total: results.length,
    passed,
    passRate: rate(passed, results.length),
    firstTryPassRate: rate(firstTry, results.length),
    byKind,
  }
}

// ────────────────────────────────────────────────────────────
// Generated-challenge plan
// ────────────────────────────────────────────────────────────

export interface GeneratedSpec {
  kind: 'target-state' | 'target-distribution' | 'fix-the-bug'
  difficulty: 1 | 2 | 3
  seed: number
}

const GEN_KINDS: GeneratedSpec['kind'][] = ['target-state', 'target-distribution', 'fix-the-bug']

/**
 * The N seeded generated challenges a run includes, as a pure function of N —
 * same N, same puzzles, on every machine. Kinds rotate fastest, difficulty
 * ramps every full rotation, seeds are 1000+i so the default seed-0 puzzles
 * (the ones the docs use as examples) never leak into the benchmark set.
 */
export function plannedGenerated(n: number): GeneratedSpec[] {
  const out: GeneratedSpec[] = []
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    out.push({
      kind: GEN_KINDS[i % GEN_KINDS.length],
      difficulty: ((Math.floor(i / GEN_KINDS.length) % 3) + 1) as GeneratedSpec['difficulty'],
      seed: 1000 + i,
    })
  }
  return out
}
