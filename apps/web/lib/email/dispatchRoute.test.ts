/**
 * POST /api/email/dispatch — the refusals, which matter more than the sends.
 *
 * The one this file exists for is the third: in this test environment there
 * is no SUPABASE_SERVICE_ROLE_KEY, so the subscription store is the
 * in-memory fallback, and a correctly-authenticated dispatch call MUST be
 * refused outright — that store forgets opt-outs on restart, and
 * docs/ONBOARDING.md §"Email: nothing is sent, on purpose" forbids sending
 * over exactly that. If this test starts failing because dispatch "works",
 * something removed the refusal; put it back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { getSubscriptionStore } from '@/lib/email/subscriptions'
import { isApiErrorBody } from '@/lib/apiError'

const { POST } = await import('@/app/api/email/dispatch/route')

const SECRET = 'dispatch-secret-for-tests-0123456789'

/** Each request gets its own IP so the per-minute limiter never bleeds. */
let ipCounter = 0
function dispatch(headers: Record<string, string> = {}, body?: unknown): Request {
  ipCounter += 1
  return new Request('http://app.test/api/email/dispatch', {
    method: 'POST',
    headers: { 'x-forwarded-for': `198.51.100.${ipCounter}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function bearer(secret: string): Record<string, string> {
  return { authorization: `Bearer ${secret}` }
}

beforeEach(() => {
  process.env.EMAIL_DISPATCH_SECRET = SECRET
  __resetRateLimitForTests()
})

afterEach(() => {
  delete process.env.EMAIL_DISPATCH_SECRET
})

describe('authentication', () => {
  it('refuses with no Authorization header', async () => {
    const response = await POST(dispatch())
    expect(response.status).toBe(401)
  })

  it('refuses a wrong secret', async () => {
    const response = await POST(dispatch(bearer('wrong-secret-of-any-length-at-all!')))
    expect(response.status).toBe(401)
  })

  it('refuses EVERYONE when the secret is unset — empty never authorises', async () => {
    delete process.env.EMAIL_DISPATCH_SECRET
    for (const headers of [{}, bearer(''), { authorization: 'Bearer' }]) {
      const response = await POST(dispatch(headers))
      expect(response.status).toBe(401)
    }
  })
})

describe('the in-memory store refusal', () => {
  it('this environment really is on the fallback store (test precondition)', () => {
    expect(getSubscriptionStore().durable).toBe(false)
  })

  it('hard-refuses a correctly authenticated call, citing ONBOARDING.md', async () => {
    const response = await POST(dispatch(bearer(SECRET)))
    expect(response.status).toBe(503)
    const body: unknown = await response.json()
    expect(isApiErrorBody(body)).toBe(true)
    const { error, code } = body as { error: string; code: string }
    expect(code).toBe('not_configured')
    // The refusal must explain itself well enough that an operator reading
    // it at 2am knows what to fix and why it is not a bug.
    expect(error).toContain('in-memory')
    expect(error).toContain('forgets unsubscribes on restart')
    expect(error).toContain('docs/ONBOARDING.md')
    expect(error).toContain('Nothing was sent')
  })

  it('the refusal happens even with a valid body and limit', async () => {
    const response = await POST(
      dispatch({ ...bearer(SECRET), 'content-type': 'application/json' }, { limit: 5 })
    )
    expect(response.status).toBe(503)
  })
})

describe('rate limiting', () => {
  it('a burst from one IP is refused before the secret is even checked', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.250' }
    let limited = 0
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await POST(
        new Request('http://app.test/api/email/dispatch', { method: 'POST', headers: ip })
      )
      if (response.status === 429) limited += 1
    }
    expect(limited).toBeGreaterThan(0)
  })
})
