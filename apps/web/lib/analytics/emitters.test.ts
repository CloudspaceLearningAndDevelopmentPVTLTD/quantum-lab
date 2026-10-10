/**
 * emitters.test.ts — the dedup contracts behind 'circuit.built' and
 * 'viz.interacted'.
 *
 * These two events were declared in the taxonomy and read by /coach and
 * journey.ts long before anything emitted them; the emitters exist to close
 * that gap WITHOUT flooding the 1,000-event ring buffer. So the property under
 * test is not "an event appears" but "exactly one appears": once per session
 * per circuit shape, and once per visualization page visit after the debounce
 * settles. The browser is stubbed the same way track.test.ts stubs it, and
 * events are asserted by reading them back through the real `track` buffer —
 * a mocked `track` would pass with the sanitiser deleted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

function installBrowser(): void {
  vi.stubGlobal('window', {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
  })
  vi.stubGlobal('navigator', {})
}

/** Fresh module registry per test: the emitters hold module-level dedup state. */
async function load() {
  vi.resetModules()
  const emitters = await import('@/lib/analytics/emitters')
  const { getEvents } = await import('@/lib/analytics/track')
  return { ...emitters, getEvents }
}

const BELL = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
  ],
}

beforeEach(() => {
  installBrowser()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('trackCircuitBuilt', () => {
  it('emits once per circuit shape, with counts only', async () => {
    const { trackCircuitBuilt, getEvents } = await load()

    trackCircuitBuilt(BELL)
    trackCircuitBuilt(BELL)
    trackCircuitBuilt({ ...BELL, ops: [...BELL.ops] }) // same shape, new object

    const events = getEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('circuit.built')
    expect(events[0]?.props).toEqual({ numQubits: 2, gateCount: 2 })
  })

  it('a different shape counts again', async () => {
    const { trackCircuitBuilt, getEvents } = await load()

    trackCircuitBuilt(BELL)
    trackCircuitBuilt({ numQubits: 2, ops: [{ name: 'H', qubits: [0] }] })
    trackCircuitBuilt({ ...BELL, numQubits: 3 }) // same ops, wider register

    expect(getEvents().filter((e) => e.name === 'circuit.built')).toHaveLength(3)
  })

  it('an empty circuit is not a built circuit', async () => {
    const { trackCircuitBuilt, getEvents } = await load()
    trackCircuitBuilt({ numQubits: 4, ops: [] })
    expect(getEvents()).toHaveLength(0)
  })

  it('shape key ignores slider wobble on θ but not the angle itself', async () => {
    const { circuitShapeKey } = await load()
    const rx = (theta: number) => ({ numQubits: 1, ops: [{ name: 'RX', qubits: [0], theta }] })
    expect(circuitShapeKey(rx(1.5707999))).toBe(circuitShapeKey(rx(1.5708001)))
    expect(circuitShapeKey(rx(1.571))).not.toBe(circuitShapeKey(rx(3.142)))
  })
})

describe('noteVizInteraction', () => {
  it('debounces a drag into one event with the page slug', async () => {
    const { noteVizInteraction, getEvents, VIZ_INTERACTION_DEBOUNCE_MS } = await load()

    // A slider drag: many input events in quick succession.
    for (let i = 0; i < 40; i += 1) {
      noteVizInteraction('/visualizations/bloch-sphere')
      vi.advanceTimersByTime(10)
    }
    expect(getEvents()).toHaveLength(0) // still dragging — nothing yet

    vi.advanceTimersByTime(VIZ_INTERACTION_DEBOUNCE_MS)
    const events = getEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('viz.interacted')
    expect(events[0]?.props).toEqual({ slug: 'bloch-sphere' })
  })

  it('fires at most once per page visit', async () => {
    const { noteVizInteraction, getEvents, VIZ_INTERACTION_DEBOUNCE_MS } = await load()

    noteVizInteraction('/visualizations/grover')
    vi.advanceTimersByTime(VIZ_INTERACTION_DEBOUNCE_MS + 1)
    noteVizInteraction('/visualizations/grover') // later interaction, same visit
    vi.advanceTimersByTime(VIZ_INTERACTION_DEBOUNCE_MS + 1)

    expect(getEvents()).toHaveLength(1)
  })

  it('a different visualization re-arms it', async () => {
    const { noteVizInteraction, getEvents, VIZ_INTERACTION_DEBOUNCE_MS } = await load()

    noteVizInteraction('/visualizations/grover')
    vi.advanceTimersByTime(VIZ_INTERACTION_DEBOUNCE_MS + 1)
    noteVizInteraction('/visualizations/qft')
    vi.advanceTimersByTime(VIZ_INTERACTION_DEBOUNCE_MS + 1)

    expect(getEvents().map((e) => e.props.slug)).toEqual(['grover', 'qft'])
  })

  it('navigating away mid-debounce cancels the pending event', async () => {
    const { noteVizInteraction, getEvents, VIZ_INTERACTION_DEBOUNCE_MS } = await load()

    noteVizInteraction('/visualizations/grover')
    noteVizInteraction('/visualizations/qft') // navigation before the timer fired
    vi.advanceTimersByTime(VIZ_INTERACTION_DEBOUNCE_MS + 1)

    const events = getEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.props.slug).toBe('qft')
  })

  it('ignores the same controls on non-visualization pages', async () => {
    const { noteVizInteraction, getEvents, VIZ_INTERACTION_DEBOUNCE_MS } = await load()

    noteVizInteraction('/simulator')
    noteVizInteraction('/visualizations') // index page: no slug, no event
    noteVizInteraction(null)
    vi.advanceTimersByTime(VIZ_INTERACTION_DEBOUNCE_MS * 2)

    expect(getEvents()).toHaveLength(0)
  })

  it('strips query and hash from the slug', async () => {
    const { noteVizInteraction, getEvents, VIZ_INTERACTION_DEBOUNCE_MS } = await load()

    noteVizInteraction('/visualizations/shor?n=15#period')
    vi.advanceTimersByTime(VIZ_INTERACTION_DEBOUNCE_MS + 1)

    expect(getEvents()[0]?.props.slug).toBe('shor')
  })
})
