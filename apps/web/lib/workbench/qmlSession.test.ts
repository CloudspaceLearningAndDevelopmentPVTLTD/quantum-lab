import { describe, expect, it } from 'vitest'
import { COMPARISON_DEFAULT, type ComparisonConfig } from './qml'
import { GRID_RES, runQmlSession, type SessionMessage } from './qmlSession'

/** A short configuration so a whole session runs in well under a second. */
const QUICK: ComparisonConfig = {
  ...COMPARISON_DEFAULT,
  dataset: 'circles',
  size: 60,
  mlp: { ...COMPARISON_DEFAULT.mlp, maxSteps: 20 },
  vqcOptions: { ...COMPARISON_DEFAULT.vqcOptions, maxSteps: 12, restarts: 2, restartSteps: 3 },
}

function fakeClock() {
  let t = 0
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('runQmlSession', () => {
  it('trains all three models to their step budgets and reports every one as done', async () => {
    const clock = fakeClock()
    const messages: SessionMessage[] = []
    let yields = 0
    await runQmlSession(QUICK, (m) => messages.push(m), {
      shouldStop: () => false,
      yieldNow: async () => {
        yields++
        clock.advance(5)
      },
      now: () => {
        clock.advance(1)
        return clock.now()
      },
      sliceMs: 10,
      budgetMs: 1e9,
      progressEveryMs: 0,
    })
    expect(messages[0].type).toBe('started')
    const finished = messages.at(-1)
    expect(finished?.type).toBe('finished')
    if (finished?.type !== 'finished') return
    expect(finished.cutOff).toBe(false)
    expect(finished.reports.logreg.done).toBe(true)
    expect(finished.reports.mlp.step).toBe(20)
    expect(finished.reports.vqc.step).toBe(12)
    expect(finished.grids.vqc.length).toBe(GRID_RES * GRID_RES)
    expect(yields).toBeGreaterThan(0)
    // Progress arrived for every model, in training order.
    const order = messages.filter((m) => m.type === 'progress').map((m) => (m as { model: string }).model)
    expect(order.indexOf('logreg')).toBeLessThan(order.indexOf('mlp'))
    expect(order.indexOf('mlp')).toBeLessThan(order.indexOf('vqc'))
  })

  it('stops at the time budget and says so, leaving unreached models untrained', async () => {
    const clock = fakeClock()
    const messages: SessionMessage[] = []
    await runQmlSession(QUICK, (m) => messages.push(m), {
      shouldStop: () => false,
      yieldNow: async () => undefined,
      // Every clock read costs 30 ms: a single slice already blows the budget.
      now: () => {
        clock.advance(30)
        return clock.now()
      },
      sliceMs: 10,
      budgetMs: 100,
      progressEveryMs: 0,
    })
    const finished = messages.at(-1)
    expect(finished?.type).toBe('finished')
    if (finished?.type !== 'finished') return
    expect(finished.cutOff).toBe(true)
    expect(finished.reports.vqc.done).toBe(false)
    expect(finished.reports.vqc.step).toBeLessThan(12)
    // Nothing is extrapolated: an untrained model reports NaN loss, not a number.
    if (finished.reports.vqc.step === 0) expect(Number.isNaN(finished.reports.vqc.loss)).toBe(true)
  })

  it('honours a stop request between slices', async () => {
    const clock = fakeClock()
    const messages: SessionMessage[] = []
    let slices = 0
    await runQmlSession(QUICK, (m) => messages.push(m), {
      shouldStop: () => slices >= 2,
      yieldNow: async () => {
        slices++
      },
      now: () => {
        clock.advance(1)
        return clock.now()
      },
      sliceMs: 3,
      budgetMs: 1e9,
    })
    const finished = messages.at(-1)
    expect(finished?.type).toBe('finished')
    if (finished?.type !== 'finished') return
    expect(finished.cutOff).toBe(true)
  })
})
