/**
 * results.test.ts — the loader must degrade to "nothing", never to a crash or
 * a partial render, because /benchmark's empty state is a product feature.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { loadBenchResultsFrom } from './results'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-results-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const write = (name: string, content: string): string => {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

const validRun = (model: string, date: string) => ({
  model,
  date,
  promptVersion: 1,
  attemptsPerChallenge: 2,
  catalogueCount: 22,
  generatedCount: 9,
  aggregate: {
    total: 31,
    passed: 20,
    passRate: 0.6452,
    firstTryPassRate: 0.5161,
    byKind: { 'target-state': { total: 10, passed: 8, passRate: 0.8 } },
  },
})

describe('loadBenchResultsFrom', () => {
  it('returns null when no candidate path exists', () => {
    expect(loadBenchResultsFrom([path.join(tmp, 'missing.json')])).toBeNull()
  })

  it('returns null for malformed JSON and for a shape without runs', () => {
    expect(loadBenchResultsFrom([write('broken.json', '{not json')])).toBeNull()
    expect(loadBenchResultsFrom([write('norun.json', '{"hello":1}')])).toBeNull()
  })

  it('parses valid runs newest first and drops malformed ones', () => {
    const file = write(
      'good.json',
      JSON.stringify({
        version: 1,
        runs: [
          validRun('model-a', '2026-08-01T00:00:00Z'),
          { model: 'no-aggregate', date: '2026-08-02T00:00:00Z' },
          validRun('model-b', '2026-08-20T00:00:00Z'),
        ],
      }),
    )
    const runs = loadBenchResultsFrom([file])
    expect(runs).not.toBeNull()
    expect(runs!.map((r) => r.model)).toEqual(['model-b', 'model-a'])
    expect(runs![0].aggregate.byKind['target-state'].passRate).toBe(0.8)
  })

  it('returns null when every run is malformed — never an empty table', () => {
    const file = write('allbad.json', JSON.stringify({ runs: [{ model: 'x' }] }))
    expect(loadBenchResultsFrom([file])).toBeNull()
  })
})
