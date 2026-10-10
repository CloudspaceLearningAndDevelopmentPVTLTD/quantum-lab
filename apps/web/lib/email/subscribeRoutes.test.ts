/**
 * The subscribe and unsubscribe ROUTES — the HTTP skin over subscriptions.ts.
 *
 * subscriptions.test.ts proves the state machine; these tests prove the
 * route-level promises that live above it:
 *
 *   1. POST answers IDENTICALLY whether the address was new, repeated, or
 *      already confirmed — no address-probing oracle, no re-mail primitive;
 *   2. the confirm mail's links are built from the app's own origin, never
 *      from anything in the request (the MAIL-1 rule, by construction);
 *   3. GET /unsubscribe returns the same 200 page for a fresh opt-out, a
 *      repeat click and an unknown token — and the fresh one actually wrote;
 *   4. the signup rate limit refuses a per-IP burst.
 *
 * `sendEmail` is mocked, same as lib/email/route.test.ts: pass/fail is
 * decided by whether delivery was ATTEMPTED and with what, not by whether
 * this container has a provider key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rateLimit'
import {
  __resetSubscriptionStoreForTests,
  getSubscriptionStore,
} from '@/lib/email/subscriptions'

interface SentMessage {
  to: string
  subject: string
  html: string
  text: string
}

const sendEmail = vi.fn(async (_input: SentMessage) => ({ sent: true as const, id: 'msg_test' }))

vi.mock('@/lib/email/client', () => ({
  sendEmail: (input: SentMessage) => sendEmail(input),
  isEmailConfigured: true,
  FROM_ADDRESS: 'Qubit16 <test@example.com>',
}))

const { POST, GET: CONFIRM } = await import('@/app/api/email/subscribe/route')
const { GET: UNSUBSCRIBE } = await import('@/app/api/email/unsubscribe/route')

/** Each test gets its own IP so the shared per-minute limiter never bleeds. */
let ipCounter = 0
function post(body: unknown, ip?: string): Request {
  ipCounter += 1
  return new Request('http://app.test/api/email/subscribe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip ?? `203.0.113.${ipCounter}`,
    },
    body: JSON.stringify(body),
  })
}

function confirmReq(token: string): Request {
  return new Request(`http://app.test/api/email/subscribe?token=${token}`)
}

function unsubscribeReq(token: string): Request {
  return new Request(`http://app.test/api/email/unsubscribe?token=${token}`)
}

/** Pull the minted token back out of the mailed text body. */
function tokenFromMail(): string {
  const text = sendEmail.mock.calls.at(-1)?.[0]?.text ?? ''
  const match = text.match(/token=([0-9a-f]{64})/)
  if (!match) throw new Error('no token found in the mailed body')
  return match[1] as string
}

const EMAIL = 'learner@example.com'

beforeEach(() => {
  __resetRateLimitForTests()
  __resetSubscriptionStoreForTests()
  sendEmail.mockClear()
})

afterEach(() => {
  __resetRateLimitForTests()
  __resetSubscriptionStoreForTests()
})

describe('POST /api/email/subscribe', () => {
  it('stores an unconfirmed row and mails ONE confirm message to the submitted address', async () => {
    const response = await POST(post({ email: EMAIL }))

    expect(response.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({ to: EMAIL })

    const row = await getSubscriptionStore().getByEmail(EMAIL, 'course-7day')
    expect(row?.confirmedAt).toBeNull()
  })

  it('builds both links from the app origin, nothing from the request (MAIL-1 rule)', async () => {
    await POST(post({ email: EMAIL }))
    const mail = sendEmail.mock.calls[0]?.[0]
    const token = tokenFromMail()

    // NEXT_PUBLIC_APP_URL is unset in tests, so APP_URL is the localhost
    // default — and NOT http://app.test, the origin the request claimed.
    expect(mail?.text).toContain(`http://localhost:3000/api/email/subscribe?token=${token}`)
    expect(mail?.text).toContain(`http://localhost:3000/api/email/unsubscribe?token=${token}`)
    expect(mail?.text).not.toContain('app.test')
    expect(mail?.html).not.toContain('app.test')
  })

  it('answers identically for a fresh, repeated and already-confirmed address', async () => {
    const first = await POST(post({ email: EMAIL }))
    const firstBody = await first.json()

    const repeat = await POST(post({ email: EMAIL }))
    expect(await repeat.json()).toEqual(firstBody)

    await CONFIRM(confirmReq(tokenFromMail()))
    sendEmail.mockClear()

    const confirmed = await POST(post({ email: EMAIL }))
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toEqual(firstBody)
    // …and the confirmed subscriber was NOT mailed again.
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rejects a malformed address with a 400 and sends nothing', async () => {
    const response = await POST(post({ email: 'not-an-address' }))
    expect(response.status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses a per-IP burst with a 429', async () => {
    const ip = '198.51.100.200'
    for (let i = 0; i < 3; i += 1) {
      expect((await POST(post({ email: `a${i}@example.com` }, ip))).status).toBe(200)
    }
    const fourth = await POST(post({ email: 'a3@example.com' }, ip))
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('retry-after')).toBeTruthy()
    expect(sendEmail).toHaveBeenCalledTimes(3)
  })
})

describe('GET /api/email/subscribe (the confirm click)', () => {
  it('confirms with the mailed token and persists it', async () => {
    await POST(post({ email: EMAIL }))
    const response = await CONFIRM(confirmReq(tokenFromMail()))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const row = await getSubscriptionStore().getByEmail(EMAIL, 'course-7day')
    expect(row?.confirmedAt).not.toBeNull()
  })

  it('refuses a token that was never minted', async () => {
    await POST(post({ email: EMAIL }))
    const response = await CONFIRM(confirmReq('0'.repeat(64)))
    expect(response.status).toBe(400)
    const row = await getSubscriptionStore().getByEmail(EMAIL, 'course-7day')
    expect(row?.confirmedAt).toBeNull()
  })
})

describe('GET /api/email/unsubscribe', () => {
  it('persists the opt-out and confirms with a plain 200 page', async () => {
    await POST(post({ email: EMAIL }))
    const token = tokenFromMail()
    await CONFIRM(confirmReq(token))

    const response = await UNSUBSCRIBE(unsubscribeReq(token))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')

    const row = await getSubscriptionStore().getByEmail(EMAIL, 'course-7day')
    expect(row?.unsubscribedAt).not.toBeNull()
  })

  it('returns the SAME 200 page for a repeat click and for an unknown token', async () => {
    await POST(post({ email: EMAIL }))
    const token = tokenFromMail()

    const fresh = await UNSUBSCRIBE(unsubscribeReq(token))
    const repeat = await UNSUBSCRIBE(unsubscribeReq(token))
    const unknown = await UNSUBSCRIBE(unsubscribeReq('0'.repeat(64)))

    const freshHtml = await fresh.text()
    expect(repeat.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await repeat.text()).toBe(freshHtml)
    expect(await unknown.text()).toBe(freshHtml)
  })

  it('after an unsubscribe, the old confirm link is dead', async () => {
    await POST(post({ email: EMAIL }))
    const token = tokenFromMail()
    await CONFIRM(confirmReq(token))
    await UNSUBSCRIBE(unsubscribeReq(token))

    const response = await CONFIRM(confirmReq(token))
    expect(response.status).toBe(400)
    const row = await getSubscriptionStore().getByEmail(EMAIL, 'course-7day')
    expect(row?.unsubscribedAt).not.toBeNull()
  })
})
