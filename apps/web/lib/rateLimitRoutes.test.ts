/**
 * The rate limit as the expensive routes actually apply it.
 *
 * lib/rateLimit.test.ts proves the counter. This proves the wiring: that
 * /api/agent and /api/email really call it, really answer 429 with a
 * Retry-After, and really leave a caller under the limit alone.
 *
 * The billing routes are not driven here. Both return early with
 * `configured: false` before the limiter when STRIPE_SECRET_KEY is absent, and
 * it is absent in this container and in CI — a test that drove them would be
 * testing the unconfigured branch and proving nothing. Their limiter call is
 * the same two lines as the ones below, and `isStripeConfigured` is read at
 * module load so it cannot be stubbed per test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { POST as agentPOST } from '@/app/api/agent/route'
import { POST as emailPOST } from '@/app/api/email/route'

function post(url: string, body: unknown, ip: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

const ASK = { messages: [{ role: 'user', content: 'What is a qubit?' }], level: 'beginner' }

beforeEach(() => {
  __resetRateLimitForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // No agent service and no Anthropic key in this container: every accepted
  // request falls through to the offline tier, which is a 200. That is exactly
  // the signal we want — "not refused".
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  __resetRateLimitForTests()
})

describe('/api/agent', () => {
  it('leaves a caller under the limit alone', async () => {
    for (let i = 0; i < 12; i += 1) {
      const response = await agentPOST(post('http://app.test/api/agent', ASK, '203.0.113.20'))
      expect(response.status).toBe(200)
    }
  })

  it('answers 429 with Retry-After once the per-minute limit is passed', async () => {
    for (let i = 0; i < 12; i += 1) {
      await agentPOST(post('http://app.test/api/agent', ASK, '203.0.113.21'))
    }

    const refused = await agentPOST(post('http://app.test/api/agent', ASK, '203.0.113.21'))
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('counts each caller separately', async () => {
    for (let i = 0; i < 13; i += 1) {
      await agentPOST(post('http://app.test/api/agent', ASK, '203.0.113.22'))
    }

    const other = await agentPOST(post('http://app.test/api/agent', ASK, '203.0.113.23'))
    expect(other.status).toBe(200)
  })

  it('refuses without naming a key, a count or a window', async () => {
    for (let i = 0; i < 13; i += 1) {
      await agentPOST(post('http://app.test/api/agent', ASK, '203.0.113.24'))
    }

    const refused = await agentPOST(post('http://app.test/api/agent', ASK, '203.0.113.24'))
    const body = (await refused.json()) as { reply: string }
    expect(body.reply).not.toMatch(/203\.0\.113|\d+ *(requests|per)/)
  })
})

describe('/api/email', () => {
  const MAIL = { type: 'welcome', to: 'learner@example.com', data: { name: 'Ada' } }

  it('leaves a caller under the limit alone', async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await emailPOST(post('http://app.test/api/email', MAIL, '203.0.113.30'))
      // 401, not 200: the route now requires a verified caller and will only
      // send to that caller's own address (lib/email/route.test.ts drives that
      // gate directly). What matters here is that these five were NOT refused
      // by the limiter — 401 is the auth gate answering, 429 would be the
      // limiter, and the difference is the whole point of this test.
      expect(response.status).toBe(401)
    }
  })

  it('answers 429 with Retry-After once over the limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await emailPOST(post('http://app.test/api/email', MAIL, '203.0.113.31'))
    }

    const refused = await emailPOST(post('http://app.test/api/email', MAIL, '203.0.113.31'))
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
    await expect(refused.json()).resolves.toEqual({
      sent: false,
      error: 'Too many messages from this address. Wait a while and retry.',
      code: 'rate_limited',
    })
  })
})
