/**
 * Tests for the shared-store rate limiter.
 *
 * Two things are worth stating about what these can and cannot prove:
 *
 *  - The Redis path is exercised against a STUBBED `fetch`. That proves the
 *    request shape, the decision arithmetic and the fallback behaviour. It does
 *    not prove that a real Upstash instance behaves as assumed, and no Redis has
 *    been available in this container. The pipeline body and the shape of the
 *    reply are both from Upstash's documented REST protocol.
 *  - The clock is injected everywhere. A test that sleeps to cross a window
 *    boundary is a test that takes a minute and fails on a loaded machine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetRateLimitForTests,
  callerKey,
  rateLimit,
  rateLimitStore,
  retryAfterHeaders,
} from '@/lib/rateLimit'

const REDIS_VARS = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
] as const

function clearRedisEnv(): void {
  for (const name of REDIS_VARS) delete process.env[name]
}

function headersWith(ip: string): Headers {
  return new Headers({ 'x-forwarded-for': ip })
}

beforeEach(() => {
  clearRedisEnv()
  __resetRateLimitForTests()
  // The memory-store warning is deliberate and loud; it is not test output.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  clearRedisEnv()
  __resetRateLimitForTests()
})

describe('in-process fallback', () => {
  it('warns, once, that the store does not survive a deploy or span instances', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await rateLimit('k', { limit: 5, windowMs: 60_000 }, 0)
    await rateLimit('k', { limit: 5, windowMs: 60_000 }, 0)

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('DOES NOT SURVIVE A DEPLOY')
    expect(message).toContain('DOES NOT SPAN INSTANCES')
  })

  it('allows a caller under the limit and leaves the count visible', async () => {
    const rule = { limit: 3, windowMs: 60_000 }
    const first = await rateLimit('under', rule, 0)
    const second = await rateLimit('under', rule, 10)
    const third = await rateLimit('under', rule, 20)

    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true])
    expect([first.remaining, second.remaining, third.remaining]).toEqual([2, 1, 0])
  })

  it('refuses the request that goes over the limit', async () => {
    const rule = { limit: 3, windowMs: 60_000 }
    for (let i = 0; i < 3; i += 1) await rateLimit('over', rule, 0)

    const fourth = await rateLimit('over', rule, 0)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
  })

  it('does not let one caller exhaust another caller', async () => {
    const rule = { limit: 1, windowMs: 60_000 }
    await rateLimit('a:1', rule, 0)
    expect((await rateLimit('a:1', rule, 0)).allowed).toBe(false)
    expect((await rateLimit('a:2', rule, 0)).allowed).toBe(true)
  })

  it('starts a fresh allowance in the next window', async () => {
    const rule = { limit: 1, windowMs: 60_000 }
    await rateLimit('roll', rule, 0)
    expect((await rateLimit('roll', rule, 59_999)).allowed).toBe(false)
    expect((await rateLimit('roll', rule, 60_000)).allowed).toBe(true)
  })

  it('clamps a nonsensical rule instead of allowing everything', async () => {
    const broken = { limit: Number.NaN, windowMs: -5 }
    expect((await rateLimit('junk', broken, 0)).allowed).toBe(true)
    expect((await rateLimit('junk', broken, 0)).allowed).toBe(false)
  })
})

describe('Redis (Upstash REST) store', () => {
  function useRedis(): void {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token-value'
    __resetRateLimitForTests()
  }

  function pipelineReply(count: number): Response {
    return new Response(JSON.stringify([{ result: count }, { result: 1 }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('is selected as soon as both variables are present', () => {
    expect(rateLimitStore()).toBe('memory')
    useRedis()
    expect(rateLimitStore()).toBe('redis')
  })

  it('INCRs a window-scoped key with a TTL, authenticated with the token', async () => {
    useRedis()
    const fetchMock = vi.fn(async () => pipelineReply(1))
    vi.stubGlobal('fetch', fetchMock)

    const decision = await rateLimit('agent:ip:1.2.3.4', { limit: 5, windowMs: 60_000 }, 120_000)

    expect(decision).toMatchObject({ allowed: true, remaining: 4, store: 'redis' })
    // The stub declares no parameters, so vitest types its call tuple as empty.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.upstash.io/pipeline')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-value')
    // Window index 2 at t=120000 with a 60s window; the key must carry it, or a
    // counter would never reset.
    expect(JSON.parse(String(init.body))).toEqual([
      ['INCR', 'rl:agent:ip:1.2.3.4:60000:2'],
      ['EXPIRE', 'rl:agent:ip:1.2.3.4:60000:2', '61'],
    ])
  })

  it('refuses once the shared counter passes the limit', async () => {
    useRedis()
    vi.stubGlobal('fetch', vi.fn(async () => pipelineReply(6)))

    const decision = await rateLimit('k', { limit: 5, windowMs: 60_000 }, 0)
    expect(decision.allowed).toBe(false)
    expect(decision.store).toBe('redis')
  })

  it('falls back to the in-process counter when the store does not answer', async () => {
    useRedis()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )

    const rule = { limit: 1, windowMs: 60_000 }
    const first = await rateLimit('degraded', rule, 0)
    const second = await rateLimit('degraded', rule, 0)

    // Degraded, not open: the request is still counted, just not across
    // instances. Failing closed here would take the tutor down with Redis.
    expect(first).toMatchObject({ allowed: true, store: 'memory' })
    expect(second).toMatchObject({ allowed: false, store: 'memory' })
  })

  it('treats a command-level error inside a 200 body as no answer', async () => {
    useRedis()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ error: 'WRONGTYPE' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    )

    expect((await rateLimit('k', { limit: 5, windowMs: 60_000 }, 0)).store).toBe('memory')
  })
})

describe('callerKey', () => {
  it('takes the first hop of x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })
    expect(callerKey(headers, 'agent')).toBe('agent:ip:203.0.113.7')
  })

  it('falls back to x-real-ip, then to a single shared bucket', () => {
    expect(callerKey(new Headers({ 'x-real-ip': '198.51.100.4' }), 'p')).toBe('p:ip:198.51.100.4')
    expect(callerKey(new Headers(), 'p')).toBe('p:ip:unknown')
  })

  it('collapses IPv6 to a /64, because rotating inside one costs nothing', () => {
    const a = callerKey(headersWith('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd'), 'p')
    const b = callerKey(headersWith('2001:db8:1234:5678:1111:2222:3333:4444'), 'p')
    const other = callerKey(headersWith('2001:db8:1234:9999::1'), 'p')

    expect(a).toBe(b)
    expect(a).toBe('p:ip:2001:0db8:1234:5678::/64')
    expect(other).not.toBe(a)
  })

  it('expands a compressed IPv6 address before truncating it', () => {
    expect(callerKey(headersWith('2001:db8::1'), 'p')).toBe('p:ip:2001:0db8:0000:0000::/64')
  })

  it('buckets two zero-padding spellings of the same /64 together', () => {
    // 2001:db8:: and 2001:0db8:: are the same address. Without zero-padding
    // each group before truncating, the first landed in "2001:db8:0:0::/64"
    // and the second in "2001:0db8:0:0::/64" — different buckets for the same
    // network, letting a client split its traffic across two allowances just
    // by choosing which spelling to send.
    const compact = callerKey(headersWith('2001:db8::1'), 'p')
    const padded = callerKey(headersWith('2001:0db8::1'), 'p')
    expect(compact).toBe(padded)
    expect(compact).toBe('p:ip:2001:0db8:0000:0000::/64')
  })

  it('namespaces by prefix so two routes never share a bucket', () => {
    expect(callerKey(headersWith('1.1.1.1'), 'agent')).not.toBe(
      callerKey(headersWith('1.1.1.1'), 'email')
    )
  })

  it('bounds a caller-controlled header so the key cannot grow without limit', () => {
    const key = callerKey(headersWith('9'.repeat(500)), 'p')
    expect(key.length).toBeLessThanOrEqual('p:ip:'.length + 64)
  })

  it('prefers a verified subject over the IP when one is given', () => {
    const key = callerKey(headersWith('1.1.1.1'), 'p', '11111111-2222-3333-4444-555555555555')
    expect(key).toBe('p:u:11111111-2222-3333-4444-555555555555')
  })
})

describe('retryAfterHeaders', () => {
  it('rounds Retry-After up and never emits zero', () => {
    const headers = retryAfterHeaders(
      { allowed: false, remaining: 0, resetAt: 60_000, store: 'redis' },
      59_500
    )
    expect(headers['retry-after']).toBe('1')
    expect(headers['x-ratelimit-reset']).toBe('60')
  })

  it('carries nothing that identifies the caller or their bucket', () => {
    const headers = retryAfterHeaders(
      { allowed: false, remaining: 0, resetAt: 120_000, store: 'memory' },
      60_000
    )
    expect(Object.keys(headers).sort()).toEqual(['retry-after', 'x-ratelimit-reset'])
  })
})
