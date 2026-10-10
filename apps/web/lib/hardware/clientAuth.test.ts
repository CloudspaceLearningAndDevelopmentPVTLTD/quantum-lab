/**
 * clientAuth.test.ts — THE OTHER HALF OF THE FIX, and the easy one to forget.
 *
 * `/api/hardware/submit` and `/api/hardware/job/*` now require a Supabase-
 * verified caller. If `lib/hardware/client.ts` keeps sending its requests with
 * a bare `fetch`, the effect of that hardening is: every attacker stays exactly
 * as refused as before, and every PAYING CUSTOMER gets a 401. The gate would
 * look like a success in the security tests and read as a total outage in the
 * support queue.
 *
 * So these tests pin the token actually arriving. They drive the real client
 * functions with a stubbed global `fetch` and assert on the header that reaches
 * the wire, rather than asserting that `authFetch` was called — a spy on the
 * wrapper would still pass if the wrapper stopped attaching anything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session: { token: string | null } = { token: null }

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getSession: async () =>
        session.token
          ? { data: { session: { access_token: session.token } }, error: null }
          : { data: { session: null }, error: null },
    },
  }),
}))

const { estimate, listDevices, pollJob, submit } = await import('@/lib/hardware/client')

const QASM = 'OPENQASM 3.0;\nqubit[1] q;\nh q[0];\n'

let seen: Array<{ url: string; headers: Headers }> = []

beforeEach(() => {
  seen = []
  session.token = 'jwt-abc'
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the hardware client carries the session token', () => {
  it('sends a bearer token on submit — without this every Pro user gets a 401', async () => {
    await submit(QASM, 'ibm_brisbane', 1024)

    expect(seen[0]?.url).toBe('/api/hardware/submit')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer jwt-abc')
    // The body still has to be JSON, or the route's shape check refuses it
    // before it ever reaches the entitlement gate.
    expect(seen[0]?.headers.get('content-type')).toBe('application/json')
  })

  it('sends a bearer token when polling a job, which is ownership-checked', async () => {
    await pollJob('braket', 'arn:aws:braket:us-east-1:1:quantum-task/abc')

    expect(seen[0]?.headers.get('authorization')).toBe('Bearer jwt-abc')
    // Each ARN segment is encoded separately so the slash stays a path
    // separator — the route rebuilds the id by joining the segments back.
    expect(seen[0]?.url).toBe(
      '/api/hardware/job/braket/arn%3Aaws%3Abraket%3Aus-east-1%3A1%3Aquantum-task/abc'
    )
  })

  it('sends the token on the open endpoints too, so one code path serves all', async () => {
    await listDevices()
    await estimate('ibm_brisbane', 1024, QASM)

    expect(seen[0]?.headers.get('authorization')).toBe('Bearer jwt-abc')
    expect(seen[1]?.headers.get('authorization')).toBe('Bearer jwt-abc')
  })

  it('sends no credential when nobody is signed in, and does not throw', async () => {
    session.token = null

    const result = await submit(QASM, 'ibm_brisbane', 1024)

    expect(seen[0]?.headers.get('authorization')).toBeNull()
    // The route will answer 401 and the page renders its `detail`. That is the
    // designed signed-out outcome, not a client fault.
    expect(result.ok).toBe(true)
  })

  it('still targets same-origin paths, so a reverse proxy or preview URL works', async () => {
    await submit(QASM, 'ibm_brisbane', 1024)
    expect(seen[0]?.url.startsWith('/')).toBe(true)
  })
})
