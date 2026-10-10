/**
 * route.test.ts — POST /api/workbench/generate, driven directly.
 *
 * The identity, entitlement and provider layers are mocked at their module
 * seams; the loop, the verifier and the NDJSON framing are real. No network:
 * the "model" is the same scripted adapter generate.test.ts uses.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import type { ProviderAdapter } from './generate'
import { presetById } from './specs'

const replies: string[] = []
const fakeAdapter: ProviderAdapter = {
  label: 'scripted',
  complete: async () => {
    const next = replies.shift()
    if (next === undefined) throw new Error('script exhausted')
    return next
  },
}

let liveKey = 'test-key'

vi.mock('@/lib/security/auth', () => ({ verifiedCaller: async () => null }))
vi.mock('@/lib/billing/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/entitlements')>()
  return { ...actual, getEntitlement: async () => null }
})
vi.mock('@/lib/platform/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform/settings')>()
  return {
    ...actual,
    effectiveLlmSettings: async () => ({
      settings: actual.envLlmSettings({ GEMINI_API_KEY: liveKey } as unknown as NodeJS.ProcessEnv),
      keySource: {},
      unreadable: [],
      stored: null,
    }),
  }
})
vi.mock('@/lib/workbench/liveProvider', () => ({ adapterFor: () => fakeAdapter }))

import { POST } from '@/app/api/workbench/generate/route'

function post(body: unknown): Request {
  return new Request('http://localhost/api/workbench/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function ndjson(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text()
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

const X_ONLY = '```json\n{"numQubits": 2, "ops": [{"name": "X", "qubits": [0]}]}\n```'
const BELL = '{"numQubits": 2, "ops": [{"name": "H", "qubits": [0]}, {"name": "CX", "qubits": [0, 1]}]}'

describe('POST /api/workbench/generate', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
    replies.length = 0
    liveKey = 'test-key'
  })

  it('streams one line per attempt, then the result', async () => {
    replies.push(X_ONLY, BELL)
    const res = await POST(post({ spec: presetById('bell')!.spec, maxAttempts: 3 }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('ndjson')
    const lines = await ndjson(res)
    expect(lines.map((l) => l.type)).toEqual(['attempt', 'attempt', 'result'])
    const a1 = lines[0].attempt as { verdict: { pass: boolean } }
    expect(a1.verdict.pass).toBe(false)
    const result = lines[2] as { ok: boolean; modelCalls: number; tier: string; attempts: unknown[] }
    expect(result.ok).toBe(true)
    expect(result.modelCalls).toBe(2)
    expect(result.tier).toBe('anonymous')
    expect(result.attempts).toHaveLength(2)
  })

  it('reports offline when the tier has no provider, and still verifies a candidate-only request', async () => {
    liveKey = ''
    const off = await POST(post({ spec: presetById('bell')!.spec }))
    expect(off.status).toBe(200)
    const body = (await off.json()) as { offline: boolean; reason: string }
    expect(body.offline).toBe(true)
    expect(body.reason).toMatch(/verify a pasted circuit/)

    const verifyOnly = await POST(
      post({
        spec: presetById('bell')!.spec,
        maxAttempts: 1,
        candidateQasm: 'OPENQASM 3.0;\nqubit[2] q;\nh q[0];\ncx q[0], q[1];',
      }),
    )
    const r = (await verifyOnly.json()) as { ok: boolean; modelCalls: number }
    expect(r.ok).toBe(true)
    expect(r.modelCalls).toBe(0)
  })

  it('rejects an invalid spec with 400 and every error', async () => {
    const res = await POST(post({ spec: { numQubits: 2, target: { kind: 'distribution', probabilities: { '0': 1 } } } }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/not a 2-character bitstring/)
  })

  it('validates the candidate does what the developer thinks before calling the model', async () => {
    replies.push(BELL)
    const res = await POST(
      post({
        spec: presetById('bell')!.spec,
        maxAttempts: 2,
        candidateQasm: 'OPENQASM 3.0;\nqubit[2] q;\nx q[0];',
      }),
    )
    const lines = await ndjson(res)
    const sources = lines.filter((l) => l.type === 'attempt').map((l) => (l.attempt as { source: string }).source)
    expect(sources).toEqual(['candidate', 'model'])
    expect((lines.at(-1) as { ok: boolean }).ok).toBe(true)
  })
})
