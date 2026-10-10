/**
 * The error shape as a contract, not a convention.
 *
 * These tests exist because "every route returns the same shape" is the kind of
 * claim that is true the day it is written and false three merges later. The
 * last two drive real route handlers, so a future edit that reverts a route to
 * `NextResponse.json({ error })` fails here rather than in production.
 */

import { describe, expect, it, vi } from 'vitest'
import { API_ERROR_STATUS, apiError, badRequest, errorForStatus, failure, isApiErrorBody } from '@/lib/apiError'

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('apiError', () => {
  it('returns the code as the status by default', async () => {
    for (const code of Object.keys(API_ERROR_STATUS) as (keyof typeof API_ERROR_STATUS)[]) {
      const res = apiError(code)
      expect(res.status).toBe(API_ERROR_STATUS[code])
      const parsed = await body(res)
      expect(parsed.code).toBe(code)
      expect(typeof parsed.error).toBe('string')
      expect((parsed.error as string).length).toBeGreaterThan(0)
    }
  })

  it('carries Retry-After through unchanged', () => {
    const res = apiError('rate_limited', { headers: { 'retry-after': '30' } })
    expect(res.headers.get('retry-after')).toBe('30')
  })

  it('maps a status back to a code, and 501 to not_configured', async () => {
    expect(await body(errorForStatus(403)).then((b) => b.code)).toBe('forbidden')
    expect(await body(errorForStatus(429)).then((b) => b.code)).toBe('rate_limited')
    // 501 is what the invite routes return for "no service-role key".
    const notImplemented = errorForStatus(501, 'Server-side invites are not configured.')
    expect(notImplemented.status).toBe(501)
    expect((await body(notImplemented)).code).toBe('not_configured')
    // An unmapped 5xx is ours; an unmapped 4xx is the caller's.
    expect((await body(errorForStatus(507))).code).toBe('internal')
    expect((await body(errorForStatus(418))).code).toBe('bad_request')
  })
})

describe('failure', () => {
  it('reports the exception and never puts it in the body', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secret = 'Stripe: no such price rec_1234 for account acct_9876'
    const res = failure('upstream_error', new Error(secret), { route: 'test' })

    const parsed = await body(res)
    expect(res.status).toBe(502)
    expect(parsed.code).toBe('upstream_error')
    expect(JSON.stringify(parsed)).not.toContain('acct_9876')
    expect(JSON.stringify(parsed)).not.toContain('rec_1234')
    spy.mockRestore()
  })
})

describe('isApiErrorBody', () => {
  it('accepts our shape and rejects lookalikes', async () => {
    expect(isApiErrorBody(await body(badRequest('nope')))).toBe(true)
    // The pre-existing shape: a message with no machine-readable code.
    expect(isApiErrorBody({ error: 'nope' })).toBe(false)
    // A code we do not define.
    expect(isApiErrorBody({ error: 'nope', code: 'kaboom' })).toBe(false)
    expect(isApiErrorBody(null)).toBe(false)
  })
})

describe('route handlers actually use it', () => {
  it('/api/orgs rejects a malformed body with error + code', async () => {
    const { POST } = await import('@/app/api/orgs/route')
    const res = await POST(
      new Request('http://app.test/api/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all',
      })
    )
    expect(res.status).toBe(400)
    expect(isApiErrorBody(await res.json())).toBe(true)
  })

  it('/api/analytics rejects a non-object body with error + code', async () => {
    const { POST } = await import('@/app/api/analytics/route')
    const res = await POST(
      new Request('http://app.test/api/analytics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([1, 2, 3]),
      })
    )
    expect(res.status).toBe(400)
    const parsed = (await res.json()) as Record<string, unknown>
    // Analytics adds `stored: false` on top; the two canonical keys must be there.
    expect(parsed.code).toBe('bad_request')
    expect(typeof parsed.error).toBe('string')
  })
})
