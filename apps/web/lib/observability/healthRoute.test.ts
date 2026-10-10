/**
 * healthRoute.test.ts — GET /api/health is cheap by default and bounded always.
 *
 * The route used to be unauthenticated, unrate-limited, and to run a live
 * Supabase HEAD count plus two upstream fetches on EVERY request. One cheap
 * anonymous request became three expensive requests against our own
 * dependencies, at whatever rate the caller liked. These tests pin both halves
 * of the fix: shallow makes no network calls, and the limiter refuses a flood.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { GET } from '@/app/api/health/route'

let calls: string[] = []

function request(path: string, ip = '203.0.113.50', headers: Record<string, string> = {}): Request {
  return new Request(`http://app.test${path}`, {
    headers: { 'x-forwarded-for': ip, ...headers },
  })
}

interface Report {
  status: string
  deep: boolean
  checks: Record<string, { status: string; checked: boolean }>
}

beforeEach(() => {
  calls = []
  __resetRateLimitForTests()
  // Configured upstreams, so the probes have somewhere to go if they run.
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
  process.env.AGENT_SERVICE_URL = 'http://agent.test'
  delete process.env.HEALTH_DEEP_TOKEN
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response('{}', { status: 200 })
    })
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete process.env.NEXT_PUBLIC_API_URL
  delete process.env.AGENT_SERVICE_URL
  delete process.env.HEALTH_DEEP_TOKEN
  __resetRateLimitForTests()
})

describe('the default (shallow) health check', () => {
  it('makes no network calls at all', async () => {
    const response = await GET(request('/api/health'))
    const body = (await response.json()) as Report

    expect(response.status).toBe(200)
    expect(calls).toEqual([])
    expect(body.deep).toBe(false)
    // Every probe says so, so nobody mistakes it for a dependency check.
    expect(body.checks.quantumApi?.checked).toBe(false)
    expect(body.checks.agentService?.checked).toBe(false)
    expect(body.checks.database?.checked).toBe(false)
  })

  it('still reports which integrations are absent', async () => {
    delete process.env.AGENT_SERVICE_URL
    const body = (await (await GET(request('/api/health'))).json()) as Report
    expect(body.checks.agentService?.status).toBe('skipped')
  })
})

describe('the deep health check', () => {
  it('probes the upstreams when asked', async () => {
    const body = (await (await GET(request('/api/health?deep=1'))).json()) as Report

    expect(body.deep).toBe(true)
    expect(calls).toContain('http://api.test/api/health')
    expect(calls).toContain('http://agent.test/api/agent/health')
  })

  it('needs the token once one is configured', async () => {
    process.env.HEALTH_DEEP_TOKEN = 'operator-token'

    const body = (await (await GET(request('/api/health?deep=1'))).json()) as Report

    // Falls back to shallow rather than 401-ing: a 401 here would tell an
    // anonymous caller that a token exists, which is itself information.
    expect(body.deep).toBe(false)
    expect(calls).toEqual([])
  })

  it('accepts the token in a header or in the query, for monitors that only take a URL', async () => {
    process.env.HEALTH_DEEP_TOKEN = 'operator-token'

    const viaHeader = (await (
      await GET(request('/api/health?deep=1', '203.0.113.60', { 'x-health-token': 'operator-token' }))
    ).json()) as Report
    const viaQuery = (await (
      await GET(request('/api/health?deep=1&token=operator-token', '203.0.113.61'))
    ).json()) as Report

    expect(viaHeader.deep).toBe(true)
    expect(viaQuery.deep).toBe(true)
  })

  it('rejects a token of the wrong length without a length-dependent shortcut', async () => {
    process.env.HEALTH_DEEP_TOKEN = 'operator-token'
    const body = (await (
      await GET(request('/api/health?deep=1&token=operator-tokenX'))
    ).json()) as Report
    expect(body.deep).toBe(false)
  })
})

describe('rate limiting', () => {
  it('refuses a deep flood long before a shallow one', async () => {
    // DEEP_LIMIT is 6/minute.
    for (let i = 0; i < 6; i += 1) {
      expect((await GET(request('/api/health?deep=1', '198.51.100.77'))).status).toBe(200)
    }
    const refused = await GET(request('/api/health?deep=1', '198.51.100.77'))

    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('keeps the orchestrator’s cheap probe answering after the deep bucket is spent', async () => {
    for (let i = 0; i < 8; i += 1) {
      await GET(request('/api/health?deep=1', '198.51.100.78'))
    }

    // Separate bucket, separate prefix: a monitor hammering ?deep=1 must not be
    // able to make the container's own HEALTHCHECK fail and get it killed.
    const shallow = await GET(request('/api/health', '198.51.100.78'))
    expect(shallow.status).toBe(200)
  })

  it('bounds a shallow flood too', async () => {
    // SHALLOW_LIMIT is 60/minute — 30x what a 30s HEALTHCHECK needs.
    for (let i = 0; i < 60; i += 1) {
      expect((await GET(request('/api/health', '198.51.100.79'))).status).toBe(200)
    }
    expect((await GET(request('/api/health', '198.51.100.79'))).status).toBe(429)
  })

  it('publishes nothing about the caller in the 429 body', async () => {
    for (let i = 0; i < 7; i += 1) {
      await GET(request('/api/health?deep=1', '198.51.100.80'))
    }
    const refused = await GET(request('/api/health?deep=1', '198.51.100.80'))
    expect(await refused.text()).toBe(
      '{"status":"unknown","error":"Too many health checks. Wait a moment and try again."}'
    )
  })
})
