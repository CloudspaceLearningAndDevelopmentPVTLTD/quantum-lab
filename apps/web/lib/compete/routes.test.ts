/**
 * routes.test.ts — the /api/compete handlers, driven directly.
 *
 * Lives in lib/ because vitest.config.ts only includes lib/** and
 * components/viz/** — same arrangement as lib/exams/attemptRoutes.test.ts.
 * With no Supabase env configured, `verifiedCaller` answers null, so the POST
 * path exercised here is the unauthenticated refusal; the graded happy path is
 * covered at the engine and store layers, which is where its logic lives.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { GET, POST } from '@/app/api/compete/route'
import { __resetCompeteStoreForTests } from './store'

describe('/api/compete', () => {
  beforeEach(() => __resetCompeteStoreForTests())

  it('GET answers anonymously with the derived puzzle and a server clock', async () => {
    const res = await GET(new Request('http://test.local/api/compete'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      competition: { id: string; weekKey: string; par: number; endsAt: string; targetProbabilities: number[] }
      serverNow: string
      durable: boolean
      leaderboard: unknown[]
      you: unknown
    }
    expect(body.competition.id).toBe(`weekly-${body.competition.weekKey}`)
    expect(body.competition.par).toBeGreaterThan(0)
    expect(new Date(body.competition.endsAt).getTime()).toBeGreaterThan(Date.now())
    expect(body.serverNow).toBeTruthy()
    expect(body.durable).toBe(false) // memory fallback in tests
    expect(body.leaderboard).toEqual([])
    expect(body.you).toBeNull()
  })

  it('GET never ships hints or a reference solution', async () => {
    const res = await GET(new Request('http://test.local/api/compete'))
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('hints')
    expect(text).not.toContain('referenceSolution')
  })

  it('POST without a verified caller is a 401, not an anonymous entry', async () => {
    const res = await POST(
      new Request('http://test.local/api/compete', {
        method: 'POST',
        body: JSON.stringify({ qasm: 'OPENQASM 3.0;' }),
      })
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('unauthorized')
  })
})
