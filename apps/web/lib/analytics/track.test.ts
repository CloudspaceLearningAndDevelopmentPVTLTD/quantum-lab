/**
 * track.ts — the privacy guarantees, asserted rather than asserted-in-prose.
 *
 * docs/ANALYTICS.md makes four promises to a visitor. Until now nothing
 * checked any of them, which is the same position the entitlement layer was in
 * when it turned out to have no callers. Each promise gets a test that fails if
 * the promise is broken:
 *
 *   1. nothing is transmitted unless an endpoint is configured;
 *   2. DNT and GPC are an opt-out the in-app toggle cannot override;
 *   3. the buffer is capped and drops its OLDEST entries;
 *   4. PII-shaped property keys never reach storage.
 *
 * The environment is faked rather than jsdom'd: vitest runs this project in
 * `node`, and the module only ever touches `window.localStorage`,
 * `window.sessionStorage` and `navigator`, so a small stub is both sufficient
 * and much clearer about what is actually being depended on.
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

interface FakeNavigator {
  doNotTrack?: string | null
  globalPrivacyControl?: boolean
}

let localStorage: MemoryStorage
let sessionStorage: MemoryStorage

function installBrowser(nav: FakeNavigator = {}): void {
  localStorage = new MemoryStorage()
  sessionStorage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage, sessionStorage })
  vi.stubGlobal('navigator', nav)
}

/** Fresh module per test: `REMOTE_INGESTION_CONFIGURED` is read at import. */
async function load() {
  vi.resetModules()
  return import('@/lib/analytics/track')
}

/** Typed stand-in for `fetch`, so `mock.calls[0][1]` is a real RequestInit. */
async function fakeFetch(_input: string, _init?: RequestInit): Promise<Response> {
  return new Response('{}')
}

const EVENTS_KEY = 'quantum-lab.events'
const OPTOUT_KEY = 'quantum-lab.analytics-optout'

beforeEach(() => {
  installBrowser()
  delete process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT
})

describe('nothing leaves the device by default', () => {
  it('flush makes no request when no endpoint is configured', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { track, flush } = await load()
    track('circuit.run', { qubits: 2 })
    await flush()

    // This is the claim on the front of docs/ANALYTICS.md. If it ever fails,
    // the privacy notice is wrong, not the test.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('track itself never calls fetch, endpoint or not', async () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = '/api/analytics'
    const fetchSpy = vi.fn(fakeFetch)
    vi.stubGlobal('fetch', fetchSpy)

    const { track } = await load()
    track('circuit.run', { qubits: 2 })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('flush posts without credentials once an endpoint IS configured', async () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = '/api/analytics'
    const fetchSpy = vi.fn(fakeFetch)
    vi.stubGlobal('fetch', fetchSpy)

    const { track, flush } = await load()
    track('circuit.run', { qubits: 2 })
    await flush()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1]
    // No cookie, no ambient identity travels with the batch.
    expect(init?.credentials).toBe('omit')

    // And the local copy is kept: /insights is this device's own dashboard.
    expect(JSON.parse(localStorage.getItem(EVENTS_KEY) ?? '[]')).toHaveLength(1)
  })
})

describe('opt-out', () => {
  it('honours Do Not Track, and the in-app toggle cannot override it', async () => {
    installBrowser({ doNotTrack: '1' })
    const { track, getEvents, isOptedOut, setOptedOut } = await load()

    setOptedOut(false) // The visitor "turning analytics on" in the app.
    expect(isOptedOut()).toBe(true)

    track('circuit.run')
    expect(getEvents()).toHaveLength(0)
  })

  it('honours Global Privacy Control the same way', async () => {
    installBrowser({ globalPrivacyControl: true })
    const { track, getEvents, isOptedOut } = await load()

    expect(isOptedOut()).toBe(true)
    track('circuit.run')
    expect(getEvents()).toHaveLength(0)
  })

  it('records normally with neither signal present', async () => {
    const { track, getEvents, isOptedOut } = await load()
    expect(isOptedOut()).toBe(false)
    track('circuit.run')
    expect(getEvents()).toHaveLength(1)
  })

  it('opting out deletes what was already collected — off means off, not paused', async () => {
    const { track, setOptedOut, getEvents } = await load()
    track('circuit.run')
    expect(getEvents()).toHaveLength(1)

    setOptedOut(true)

    expect(localStorage.getItem(OPTOUT_KEY)).toBe('1')
    expect(localStorage.getItem(EVENTS_KEY)).toBeNull()
    expect(getEvents()).toHaveLength(0)
  })

  it('flush is a no-op while opted out, even with an endpoint', async () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = '/api/analytics'
    const fetchSpy = vi.fn(fakeFetch)
    vi.stubGlobal('fetch', fetchSpy)

    const { track, flush, setOptedOut } = await load()
    track('circuit.run')
    setOptedOut(true)
    await flush()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the ring buffer', () => {
  it('caps at MAX_EVENTS and drops the OLDEST first', async () => {
    const { track, getEvents, MAX_EVENTS } = await load()

    for (let i = 0; i < MAX_EVENTS + 5; i += 1) track('circuit.run', { qubits: i })

    const events = getEvents()
    expect(events).toHaveLength(MAX_EVENTS)
    // Newest kept, oldest gone. The other way round would mean a long-running
    // visitor's dashboard silently freezes on their first session.
    expect(events[events.length - 1].props.qubits).toBe(MAX_EVENTS + 4)
    expect(events[0].props.qubits).toBe(5)
  })

  it('treats a corrupt buffer as an empty one instead of throwing', async () => {
    const { getEvents, track } = await load()
    localStorage.setItem(EVENTS_KEY, '{ not json')
    expect(getEvents()).toEqual([])
    expect(() => track('circuit.run')).not.toThrow()
  })

  it('drops entries that are not valid events', async () => {
    const { getEvents } = await load()
    localStorage.setItem(
      EVENTS_KEY,
      JSON.stringify([
        { name: 'not.a.real.event', at: new Date().toISOString(), props: {}, sessionId: 'x' },
        { name: 'circuit.run', at: new Date().toISOString(), props: {}, sessionId: 'x' },
      ])
    )
    expect(getEvents().map((e) => e.name)).toEqual(['circuit.run'])
  })
})

describe('no PII reaches storage', () => {
  it('drops PII-shaped property keys entirely', async () => {
    const { track, getEvents } = await load()

    track('circuit.run', {
      qubits: 3,
      email: 'ada@example.com',
      userName: 'Ada Lovelace',
      apiKey: 'sk-live-123',
      accessToken: 'abc',
      secretThing: 'x',
      password: 'hunter2',
      phoneNumber: '555',
      homeAddress: '10 Downing St',
    })

    const props = getEvents()[0].props
    expect(props).toEqual({ qubits: 3 })
  })

  it('truncates long string values so a pasted blob cannot ride along', async () => {
    const { track, getEvents } = await load()
    track('circuit.run', { note: 'x'.repeat(500) })
    expect(String(getEvents()[0].props.note)).toHaveLength(64)
  })

  it('keeps only flat scalars', async () => {
    const { track, getEvents } = await load()
    track('circuit.run', { qubits: 2, ok: true, nested: { a: 1 }, list: [1, 2], nothing: null })
    expect(getEvents()[0].props).toEqual({ qubits: 2, ok: true })
  })
})

describe('the session id', () => {
  it('lives in sessionStorage, so it dies with the tab', async () => {
    const { track, getSessionId } = await load()
    track('circuit.run')

    const id = getSessionId()
    expect(id).not.toBe('')
    expect(sessionStorage.getItem('quantum-lab.analytics-session')).toBe(id)
    // Never written to localStorage: that would make it survive the tab and
    // turn a per-tab id into something much closer to a user id.
    expect(localStorage.getItem('quantum-lab.analytics-session')).toBeNull()
  })

  it('is stable within a tab', async () => {
    const { getSessionId } = await load()
    expect(getSessionId()).toBe(getSessionId())
  })
})
