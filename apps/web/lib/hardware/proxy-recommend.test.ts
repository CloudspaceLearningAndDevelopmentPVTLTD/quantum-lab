/**
 * proxy-recommend.test.ts — the two read-only proxies added for the Device
 * Advisor and the Resource Estimator: they forward only validated fields to
 * their one upstream path and refuse bad input before a round trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { POST as recommendPOST } from '@/app/api/hardware/recommend/route'
import { POST as resourcesPOST } from '@/app/api/circuits/resources/route'

const UPSTREAM = 'http://localhost:8000'
const QASM = 'OPENQASM 3.0;\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n'

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  })
}

function stubUpstream(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', mock)
  return mock
}

function sent(mock: ReturnType<typeof vi.fn>): [string, Record<string, unknown>] {
  const [url, init] = mock.mock.calls[0] as [string, RequestInit]
  return [url, JSON.parse(String(init.body))]
}

beforeEach(() => {
  __resetRateLimitForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  __resetRateLimitForTests()
})

describe('POST /api/hardware/recommend', () => {
  it('forwards to the recommend path with defaults filled in', async () => {
    const upstream = stubUpstream()
    const res = await recommendPOST(jsonRequest('http://app.test/api/hardware/recommend', { qasm: QASM }))
    expect(res.status).toBe(200)
    const [url, body] = sent(upstream)
    expect(url).toBe(`${UPSTREAM}/api/hardware/recommend`)
    expect(body).toEqual({
      qasm: QASM,
      shots: 1024,
      optimization_level: 1,
      objective: 'min_cost_per_successful_shot',
      include_decoherence: true,
      backends: null,
    })
  })

  it('does not forward fields it did not validate', async () => {
    const upstream = stubUpstream()
    await recommendPOST(jsonRequest('http://app.test/api/hardware/recommend', { qasm: QASM, devices: ['x'], secret: 1 }))
    const [, body] = sent(upstream)
    expect(body).not.toHaveProperty('devices')
    expect(body).not.toHaveProperty('secret')
  })

  it.each([
    [{ qasm: '' }, 'qasm'],
    [{ qasm: QASM, objective: 'cheapest' }, 'objective'],
    [{ qasm: QASM, shots: 0 }, 'shots'],
    [{ qasm: QASM, optimization_level: 4 }, 'optimization_level'],
    [{ qasm: QASM, include_decoherence: 'yes' }, 'include_decoherence'],
    [{ qasm: QASM, backends: [1] }, 'backends'],
  ])('refuses %j before a round trip', async (payload, field) => {
    const upstream = stubUpstream()
    const res = await recommendPOST(jsonRequest('http://app.test/api/hardware/recommend', payload))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { detail: string }).detail).toContain(field)
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('POST /api/circuits/resources', () => {
  it('forwards only the resources path, never /run', async () => {
    const upstream = stubUpstream()
    await resourcesPOST(
      jsonRequest('http://app.test/api/circuits/resources', {
        algorithm_qubits: 100,
        t_count: 1_000_000,
        logical_depth: 1000,
        physical_error_rate: 1e-3,
        code_cycle_seconds: 1e-6,
      })
    )
    const [url, body] = sent(upstream)
    expect(url).toBe(`${UPSTREAM}/api/circuits/resources`)
    expect(body).toEqual({
      algorithm_qubits: 100,
      t_count: 1_000_000,
      logical_depth: 1000,
      physical_error_rate: 1e-3,
      code_cycle_seconds: 1e-6,
    })
  })

  it('drops a blank circuit rather than asking upstream to parse it', async () => {
    const upstream = stubUpstream()
    await resourcesPOST(jsonRequest('http://app.test/api/circuits/resources', { qasm: '   ', algorithm_qubits: 5 }))
    expect(sent(upstream)[1]).toEqual({ algorithm_qubits: 5 })
  })

  it.each([
    [{ physical_error_rate: 1 }, 'physical_error_rate'],
    [{ physical_error_rate: 0 }, 'physical_error_rate'],
    [{ target_total_error: 'x' }, 'target_total_error'],
    [{ algorithm_qubits: 0 }, 'algorithm_qubits'],
    [{ t_count: 1.5 }, 't_count'],
    [{ model_magic_states: 'no' }, 'model_magic_states'],
  ])('refuses %j before a round trip', async (payload, field) => {
    const upstream = stubUpstream()
    const res = await resourcesPOST(jsonRequest('http://app.test/api/circuits/resources', payload))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { detail: string }).detail).toContain(field)
    expect(upstream).not.toHaveBeenCalled()
  })
})
