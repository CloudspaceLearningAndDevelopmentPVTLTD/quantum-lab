/**
 * benchmark-page.test.ts — pins /benchmark's honest empty state.
 *
 * The page's contract is "no results file, no numbers": the empty state must
 * explain how to produce a run and must not contain a single percentage. A
 * regression that sneaks sample data in would quietly convert the benchmark
 * from evidence into marketing, so the render itself is tested, not just the
 * loader. Named `.test.ts` (not `.tsx`) because vitest.config.ts only
 * includes `lib/**\/*.test.ts` — hence createElement instead of JSX.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BenchmarkView } from '@/app/benchmark/page'
import type { BenchRunView } from './results'

describe('BenchmarkView', () => {
  it('renders the empty state — how to run, and no numbers — when runs is null', () => {
    const html = renderToStaticMarkup(createElement(BenchmarkView, { runs: null }))
    expect(html).toContain('No benchmark results yet')
    expect(html).toContain('scripts/agent-bench.mjs')
    expect(html).toContain('ANTHROPIC_API_KEY')
    // The honesty check: an empty state must publish zero pass rates.
    expect(html).not.toMatch(/\d+\.\d%/)
    expect(html).not.toContain('<table')
  })

  it('renders model id, date, overall and per-kind rates when runs exist', () => {
    const run: BenchRunView = {
      model: 'claude-sonnet-4-5',
      date: '2026-08-26T12:00:00.000Z',
      promptVersion: 1,
      attemptsPerChallenge: 2,
      catalogueCount: 22,
      generatedCount: 9,
      aggregate: {
        total: 31,
        passed: 20,
        passRate: 0.6452,
        firstTryPassRate: 0.5161,
        byKind: {
          'target-state': { total: 10, passed: 8, passRate: 0.8 },
          oracle: { total: 4, passed: 1, passRate: 0.25 },
        },
      },
    }
    const html = renderToStaticMarkup(createElement(BenchmarkView, { runs: [run] }))
    expect(html).toContain('claude-sonnet-4-5')
    expect(html).toContain('2026-08-26')
    expect(html).toContain('64.5%')
    expect(html).toContain('51.6%')
    expect(html).toContain('target-state')
    expect(html).toContain('8/10')
    expect(html).toContain('25.0%')
    expect(html).not.toContain('No benchmark results yet')
  })
})
