/**
 * lib/bench/results.ts — server-side loader for `results/agent-bench.json`.
 *
 * `/benchmark` is a public page whose whole claim is "these numbers came out
 * of the real grader". That claim survives only if the page cannot invent
 * data: this loader reads the file the harness wrote, validates every run
 * defensively (the file is operator-supplied — a hand-edited or truncated
 * file must degrade to the empty state, never to a crash or a half-rendered
 * lie), and returns null when there is nothing trustworthy to show. There is
 * deliberately NO fallback sample data anywhere in this module.
 *
 * Path handling: the harness writes to `<repo root>/results/agent-bench.json`.
 * Next runs with cwd at `apps/web` in this workspace, so both the repo-root
 * location and an `apps/web/results/` copy (useful for deployments that only
 * upload the app directory) are probed, in that order.
 */

import fs from 'node:fs'
import path from 'node:path'

import type { BenchAggregate, KindStat } from './harness'

export interface BenchRunView {
  model: string
  /** ISO date-time the run finished. */
  date: string
  promptVersion: number | null
  attemptsPerChallenge: number | null
  catalogueCount: number | null
  generatedCount: number | null
  aggregate: BenchAggregate
}

/** Default probe order; see the header comment. */
export function defaultResultPaths(): string[] {
  return [
    path.resolve(process.cwd(), '..', '..', 'results', 'agent-bench.json'),
    path.resolve(process.cwd(), 'results', 'agent-bench.json'),
  ]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Validate one aggregate; null (drop the run) if the shape is off. */
function parseAggregate(v: unknown): BenchAggregate | null {
  if (!isRecord(v)) return null
  const total = num(v.total)
  const passed = num(v.passed)
  const passRate = num(v.passRate)
  const firstTryPassRate = num(v.firstTryPassRate)
  if (total === null || passed === null || passRate === null || firstTryPassRate === null) {
    return null
  }
  const byKind: Record<string, KindStat> = {}
  if (isRecord(v.byKind)) {
    for (const [kind, stat] of Object.entries(v.byKind)) {
      if (!isRecord(stat)) continue
      const kTotal = num(stat.total)
      const kPassed = num(stat.passed)
      const kRate = num(stat.passRate)
      if (kTotal === null || kPassed === null || kRate === null) continue
      byKind[kind] = { total: kTotal, passed: kPassed, passRate: kRate }
    }
  }
  return { total, passed, passRate, firstTryPassRate, byKind }
}

function parseRun(v: unknown): BenchRunView | null {
  if (!isRecord(v)) return null
  if (typeof v.model !== 'string' || v.model.length === 0) return null
  if (typeof v.date !== 'string' || v.date.length === 0) return null
  const aggregate = parseAggregate(v.aggregate)
  if (!aggregate) return null
  return {
    model: v.model,
    date: v.date,
    promptVersion: num(v.promptVersion),
    attemptsPerChallenge: num(v.attemptsPerChallenge),
    catalogueCount: num(v.catalogueCount),
    generatedCount: num(v.generatedCount),
    aggregate,
  }
}

/**
 * Read runs from the first path that exists. Newest first, so the page leads
 * with the most recent evidence. Any unreadable file or malformed run is
 * dropped silently — the page's empty state explains how to produce a real
 * one, which is more useful than an error page about a broken JSON file.
 */
export function loadBenchResultsFrom(paths: string[]): BenchRunView[] | null {
  for (const file of paths) {
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.runs)) return null
    const runs = parsed.runs
      .map(parseRun)
      .filter((r): r is BenchRunView => r !== null)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return runs.length > 0 ? runs : null
  }
  return null
}

export function loadBenchResults(): BenchRunView[] | null {
  return loadBenchResultsFrom(defaultResultPaths())
}
