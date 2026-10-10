/**
 * tools.test.ts — the MCP surface, tested at both layers.
 *
 * Layer 1 exercises the tool registry (lib/mcp/server.ts) directly: the same
 * functions the route dispatches to, with no HTTP in the way. Layer 2 drives
 * the actual route handler with JSON-RPC messages, because the protocol
 * plumbing — initialize, notifications, unknown tools, the 405s — is exactly
 * the code an SDK would have provided and therefore exactly the code that
 * needs its own tests here.
 *
 * The physics assertions are deliberately loose only where sampling is
 * involved (counts) and exact-to-1e-9 where the answer is analytic
 * (amplitudes): a Bell state's amplitudes are 1/√2 to machine precision, and
 * a test that tolerates 0.1 there would also tolerate a broken H gate.
 */

import { describe, expect, it } from 'vitest'
import {
  MCP_MAX_SHOTS,
  MCP_TOOLS,
  callTool,
  callToolAsync,
  getTool,
  listToolsResult,
  type ToolResult,
} from './server'
import { POST, GET } from '@/app/api/mcp/[transport]/route'
import { generateChallenge } from '@/lib/challenges/generate'
import { toQasm } from '@/lib/quantum'

const BELL_QASM = [
  'OPENQASM 3.0;',
  'include "stdgates.inc";',
  '',
  'qubit[2] q;',
  'bit[2] c;',
  '',
  'h q[0];',
  'cx q[0], q[1];',
  '',
  'c = measure q;',
].join('\n')

const INV_SQRT2 = Math.SQRT1_2

/** Narrow a ToolResult to its structured payload, failing loudly otherwise. */
function structured(result: ToolResult): Record<string, unknown> {
  expect(result.isError, result.content[0]?.text).not.toBe(true)
  expect(result.structuredContent).toBeDefined()
  return result.structuredContent as Record<string, unknown>
}

type AmplitudeRow = { state: string; re: number; im: number; probability: number }

function amplitudeByState(rows: AmplitudeRow[], state: string): AmplitudeRow | undefined {
  return rows.find((row) => row.state === state)
}

// ────────────────────────────────────────────────────────────
// run_circuit
// ────────────────────────────────────────────────────────────

describe('run_circuit', () => {
  it('runs a Bell circuit: ~50/50 counts on 00/11 and 1/√2 amplitudes', async () => {
    const out = structured(await callToolAsync('run_circuit', { qasm: BELL_QASM, shots: 4096, seed: 42 }))

    expect(out.numQubits).toBe(2)
    expect(out.shots).toBe(4096)

    const counts = out.counts as Record<string, number>
    // A Bell state NEVER measures 01 or 10 — one stray count is a real bug.
    expect(Object.keys(counts).sort()).toEqual(['00', '11'])
    expect(counts['00'] + counts['11']).toBe(4096)
    // p=0.5, σ=32 at 4096 shots; ±200 is >6σ, so a failure means broken
    // physics or a broken sampler, not bad luck.
    expect(counts['00']).toBeGreaterThan(1848)
    expect(counts['00']).toBeLessThan(2248)

    const sv = out.statevector as AmplitudeRow[]
    expect(sv).toHaveLength(2)
    expect(out.omittedNearZeroAmplitudes).toBe(2)
    for (const state of ['00', '11']) {
      const amp = amplitudeByState(sv, state)
      expect(amp, `missing amplitude for |${state}⟩`).toBeDefined()
      expect(amp!.re).toBeCloseTo(INV_SQRT2, 9)
      expect(amp!.im).toBeCloseTo(0, 9)
      expect(amp!.probability).toBeCloseTo(0.5, 9)
    }
  })

  it('is reproducible with a seed', async () => {
    const a = structured(await callToolAsync('run_circuit', { qasm: BELL_QASM, shots: 512, seed: 7 }))
    const b = structured(await callToolAsync('run_circuit', { qasm: BELL_QASM, shots: 512, seed: 7 }))
    expect(a.counts).toEqual(b.counts)
  })

  it('clamps shots into [1, 4096] instead of rejecting', async () => {
    const high = structured(await callToolAsync('run_circuit', { qasm: BELL_QASM, shots: 1_000_000 }))
    expect(high.shots).toBe(MCP_MAX_SHOTS)
    const low = structured(await callToolAsync('run_circuit', { qasm: BELL_QASM, shots: -3 }))
    expect(low.shots).toBe(1)
  })

  it('rejects a register wider than 16 qubits with a named error', async () => {
    const wide = 'OPENQASM 3.0;\nqubit[17] q;\nh q[0];'
    const result = await callToolAsync('run_circuit', { qasm: wide })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('16')
  })

  it('rejects input that parses to no gates rather than running |0…0⟩', async () => {
    const result = await callToolAsync('run_circuit', { qasm: 'this is not qasm at all' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('OpenQASM')
  })
})

// ────────────────────────────────────────────────────────────
// get_statevector_at_step
// ────────────────────────────────────────────────────────────

describe('get_statevector_at_step', () => {
  it('step 0 is |00⟩, step 1 is the H superposition, step 2 is the Bell state', async () => {
    const step0 = structured(await callToolAsync('get_statevector_at_step', { qasm: BELL_QASM, step: 0 }))
    expect(step0.totalSteps).toBe(2)
    expect(step0.appliedGate).toBeNull()
    const sv0 = step0.statevector as AmplitudeRow[]
    expect(sv0).toHaveLength(1)
    expect(sv0[0].state).toBe('00')
    expect(sv0[0].re).toBeCloseTo(1, 9)

    const step1 = structured(await callToolAsync('get_statevector_at_step', { qasm: BELL_QASM, step: 1 }))
    expect((step1.appliedGate as { name: string }).name).toBe('H')
    const sv1 = step1.statevector as AmplitudeRow[]
    // After H on q0: |00⟩ and |01⟩ (labels are MSB-first, q0 rightmost).
    expect(sv1.map((row) => row.state).sort()).toEqual(['00', '01'])
    for (const row of sv1) expect(row.re).toBeCloseTo(INV_SQRT2, 9)

    const step2 = structured(await callToolAsync('get_statevector_at_step', { qasm: BELL_QASM, step: 2 }))
    const sv2 = step2.statevector as AmplitudeRow[]
    expect(sv2.map((row) => row.state).sort()).toEqual(['00', '11'])

    // The inspector's teaching payload: entanglement appears exactly at step 2.
    const bloch1 = step1.blochVectors as { qubit: number; entanglementEntropy: number }[]
    const bloch2 = step2.blochVectors as { qubit: number; entanglementEntropy: number }[]
    expect(bloch1[0].entanglementEntropy).toBeCloseTo(0, 6)
    expect(bloch2[0].entanglementEntropy).toBeCloseTo(1, 6)
  })

  it('rejects a step outside 0..totalSteps and names the valid range', async () => {
    const result = await callToolAsync('get_statevector_at_step', { qasm: BELL_QASM, step: 3 })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('0–2')
  })
})

// ────────────────────────────────────────────────────────────
// Challenges
// ────────────────────────────────────────────────────────────

describe('challenges', () => {
  it('list_challenges returns the catalogue without leaking hints', async () => {
    const out = structured(await callToolAsync('list_challenges', {}))
    const challenges = out.challenges as Record<string, unknown>[]
    expect(challenges.length).toBeGreaterThanOrEqual(10)
    const flipIt = challenges.find((ch) => ch.id === 'flip-it')
    expect(flipIt).toBeDefined()
    expect(flipIt).not.toHaveProperty('hints')
    expect(flipIt).toHaveProperty('hintCount')
  })

  it('grade_challenge passes a correct flip-it solution with the UI feedback shape', async () => {
    const solution = 'OPENQASM 3.0;\nqubit[1] q;\nx q[0];'
    const out = structured(await callToolAsync('grade_challenge', { challenge_id: 'flip-it', qasm: solution }))
    expect(out.passed).toBe(true)
    expect(out.score).toBe(1)
    expect(out.successNote).toBeTruthy()
    expect(out.hint).toBeNull()
    const checks = out.checks as { label: string; passed: boolean }[]
    expect(checks.every((check) => check.passed)).toBe(true)
  })

  it('grade_challenge fails a wrong solution with a hint and a specific check', async () => {
    const wrong = 'OPENQASM 3.0;\nqubit[1] q;\nh q[0];'
    const out = structured(await callToolAsync('grade_challenge', { challenge_id: 'flip-it', qasm: wrong }))
    expect(out.passed).toBe(false)
    expect(out.successNote).toBeNull()
    expect(typeof out.hint).toBe('string')
    const checks = out.checks as { label: string; passed: boolean; detail: string }[]
    expect(checks.some((check) => !check.passed)).toBe(true)
  })

  it('grade_challenge names the valid ids on an unknown id', async () => {
    const result = await callToolAsync('grade_challenge', { challenge_id: 'nope', qasm: 'x q[0];' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('flip-it')
  })
})

// ────────────────────────────────────────────────────────────
// Lessons — the paywall boundary is the point of these tests
// ────────────────────────────────────────────────────────────

describe('lessons', () => {
  it('list_lessons marks the foundations free and the advanced track paid', async () => {
    const out = structured(await callToolAsync('list_lessons', {}))
    const lessons = out.lessons as { slug: string; free: boolean }[]
    expect(lessons.length).toBeGreaterThanOrEqual(11)
    expect(lessons.find((l) => l.slug === 'what-is-a-qubit')?.free).toBe(true)
    expect(lessons.find((l) => l.slug === 'shor')?.free).toBe(false)
  })

  it('get_lesson serves a free lesson body in full', async () => {
    const out = structured(await callToolAsync('get_lesson', { slug: 'what-is-a-qubit' }))
    expect(out.free).toBe(true)
    expect(out.bodyWithheld).toBe(false)
    const body = out.body as { kind: string }[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    // A real body has prose text, not just an outline.
    expect(body.some((block) => block.kind === 'prose')).toBe(true)
  })

  it("REFUSES a paid slug's body: metadata only, body null", async () => {
    const out = structured(await callToolAsync('get_lesson', { slug: 'shor' }))
    expect(out.free).toBe(false)
    expect(out.body).toBeNull()
    expect(out.bodyWithheld).toBe(true)
    expect(out.title).toBe("Shor's Algorithm")
    // Belt and braces: no body BLOCKS anywhere in the serialised result. Every
    // prose block carries a `paragraphs` key and metadata never does, so this
    // catches a future "helpful" field that smuggles the paid text back in.
    expect(JSON.stringify(out)).not.toContain('"paragraphs"')
  })

  it('get_lesson rejects an unknown slug and lists the valid ones', async () => {
    const result = await callToolAsync('get_lesson', { slug: 'not-a-lesson' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('what-is-a-qubit')
  })
})

// ────────────────────────────────────────────────────────────
// Gate reference + registry shape
// ────────────────────────────────────────────────────────────

describe('gate reference and registry', () => {
  it('get_gate_reference returns every library entry with QASM names', async () => {
    const out = structured(await callToolAsync('get_gate_reference', {}))
    // 18 in wave 1; wave 2 appended 10 (√X, √X†, CSWAP, MCX, custom matrix,
    // +k, ×k, QFT, QFT†, barrier); wave 3 appended 3 more (RESET, POSTSELECT,
    // U3). Pinned so a silent drop is caught.
    expect(out.count).toBe(31)
    const gates = out.gates as { name: string; qasmName: string; arity: number }[]
    expect(gates.find((g) => g.name === 'CCX')).toMatchObject({ qasmName: 'ccx', arity: 3 })
    expect(gates.find((g) => g.name === 'SDG')?.qasmName).toBe('sdg')
  })

  it('lists the eleven core tools (plus any workbench additions), each with a schema', async () => {
    const { tools } = listToolsResult()
    expect(tools.map((tool) => tool.name).sort()).toEqual(expect.arrayContaining([
      'export_notebook',
      'generate_challenge',
      'generate_verified_circuit',
      'get_gate_reference',
      'get_lesson',
      'get_session_plan',
      'get_statevector_at_step',
      'grade_challenge',
      'list_challenges',
      'list_lessons',
      'run_circuit',
      'submit_hardware_job',
    ]))
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(tool.description.length).toBeGreaterThan(20)
    }
    expect(MCP_TOOLS.length).toBeGreaterThanOrEqual(11)
    expect(new Set(MCP_TOOLS.map((tool) => tool.name)).size).toBe(MCP_TOOLS.length)
    expect(getTool('run_circuit')).toBeDefined()
    expect(getTool('submit_to_hardware')).toBeUndefined()
  })

  it('a throwing handler surfaces as an isError result, never a rejection', async () => {
    // step: NaN slips past clampInt paths into int(), which rejects it; the
    // registry contract is that NOTHING a caller sends can make callTool throw
    // or reject.
    await expect(
      callToolAsync('get_statevector_at_step', { qasm: BELL_QASM, step: Number.NaN })
    ).resolves.toBeDefined()
    const result = await callToolAsync('get_statevector_at_step', { qasm: BELL_QASM, step: Number.NaN })
    expect(result.isError).toBe(true)
  })

  it('the sync callTool still serves sync tools and refuses the async one honestly', () => {
    // app/api/tools/route.ts (the REST facade) calls callTool without awaiting;
    // its contract — a plain ToolResult, never a throw — must survive the async
    // tools' arrival.
    const sync = callTool('run_circuit', { qasm: BELL_QASM, shots: 16, seed: 1 })
    expect(sync.isError).not.toBe(true)
    expect(sync.structuredContent).toBeDefined()

    const asyncTool = callTool('submit_hardware_job', { qasm: BELL_QASM, backend: 'ibm_brisbane' })
    expect(asyncTool.isError).toBe(true)
    expect(asyncTool.content[0].text).toContain('/api/mcp/mcp')
  })
})

// ────────────────────────────────────────────────────────────
// The route: JSON-RPC over Streamable HTTP, stateless mode
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// generate_challenge — determinism and the grading round trip
// ────────────────────────────────────────────────────────────

describe('generate_challenge', () => {
  it('is deterministic and withholds hints and the reference solution', async () => {
    const a = structured(await callToolAsync('generate_challenge', { kind: 'target-state', difficulty: 1, seed: 5 }))
    const b = structured(await callToolAsync('generate_challenge', { kind: 'target-state', difficulty: 1, seed: 5 }))
    expect(a).toEqual(b)
    expect(a.id).toBe('gen-target-state-d1-s5')
    expect(a.numQubits).toBe(1)
    expect(a).not.toHaveProperty('hints')
    expect(a).not.toHaveProperty('referenceSolution')
    // The target is a real distribution over 2^1 basis states.
    const target = a.targetProbabilities as number[]
    expect(target).toHaveLength(2)
    expect(target[0] + target[1]).toBeCloseTo(1, 9)
  })

  it('ROUND-TRIPS through grading: the reference solution passes under the returned id', async () => {
    for (const [kind, difficulty] of [
      ['target-state', 1],
      ['target-distribution', 2],
      ['fix-the-bug', 2],
    ] as const) {
      const out = structured(await callToolAsync('generate_challenge', { kind, difficulty, seed: 11 }))
      // The tool withholds the solution, so fetch it from the same pure
      // generator the tool wraps — determinism guarantees it is THE solution
      // for the id the tool returned.
      const generated = generateChallenge(kind, difficulty, 11)
      expect(out.id).toBe(generated.id)
      const verdict = structured(
        await callToolAsync('grade_challenge', {
          challenge_id: out.id,
          qasm: toQasm(generated.referenceSolution),
        })
      )
      expect(verdict.passed, `${kind} reference solution must grade as a pass`).toBe(true)
      expect(verdict.score).toBe(1)
    }
  })

  it('the broken fix-the-bug starting circuit FAILS grading (the puzzle is real)', async () => {
    const out = structured(await callToolAsync('generate_challenge', { kind: 'fix-the-bug', difficulty: 2, seed: 3 }))
    expect(typeof out.startingCircuitQasm).toBe('string')
    const verdict = structured(
      await callToolAsync('grade_challenge', { challenge_id: out.id, qasm: out.startingCircuitQasm as string })
    )
    expect(verdict.passed).toBe(false)
    // The fail path escalates exactly like the catalogue: first hint only.
    expect(typeof verdict.hint).toBe('string')
  })

  it('rejects a bad kind, difficulty, or seed with a named error', async () => {
    expect((await callToolAsync('generate_challenge', { kind: 'oracle', difficulty: 1 })).isError).toBe(true)
    expect((await callToolAsync('generate_challenge', { kind: 'target-state', difficulty: 9 })).isError).toBe(true)
    expect((await callToolAsync('generate_challenge', { kind: 'target-state', difficulty: 1, seed: -1 })).isError).toBe(true)
  })

  it('grade_challenge still rejects ids that are neither catalogue nor generated', async () => {
    const result = await callToolAsync('grade_challenge', {
      challenge_id: 'gen-oracle-d1-s1',
      qasm: 'OPENQASM 3.0;\nqubit[1] q;\nx q[0];',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('gen-<kind>')
  })
})

// ────────────────────────────────────────────────────────────
// get_session_plan — stateless and deterministic
// ────────────────────────────────────────────────────────────

describe('get_session_plan', () => {
  it('is deterministic: the same snapshot yields deep-equal plans', async () => {
    const snapshot = {
      progress: {
        completed: ['what-is-a-qubit'],
        quizScores: { 'what-is-a-qubit': 0.5 },
      },
    }
    const a = structured(await callToolAsync('get_session_plan', snapshot))
    const b = structured(await callToolAsync('get_session_plan', snapshot))
    expect(a).toEqual(b)
    const steps = a.suggestedSession as { kind: string; ref: Record<string, string>; note: string }[]
    expect(steps.length).toBeGreaterThan(0)
    // A 50% quiz is below the 70% mastery bar → the plan opens by diagnosing it.
    expect(steps[0]).toMatchObject({ kind: 'diagnose', ref: { lessonSlug: 'what-is-a-qubit' } })
    const weak = a.weakSkills as { id: string; mastery: number }[]
    expect(weak.map((w) => w.id)).toContain('what-is-a-qubit')
  })

  it('answers an empty snapshot with a start-here plan, storing nothing', async () => {
    const out = structured(await callToolAsync('get_session_plan', { progress: {} }))
    expect(out.nextConcepts).toContain('what-is-a-qubit')
    const steps = out.suggestedSession as { kind: string; ref: { lessonSlug?: string } }[]
    expect(steps.some((s) => s.kind === 'teach' && s.ref.lessonSlug === 'what-is-a-qubit')).toBe(true)
    expect(String(out.stateless)).toContain('nothing was stored')
  })

  it('drops junk fields instead of crashing on them', async () => {
    const out = structured(
      await callToolAsync('get_session_plan', {
        progress: { completed: ['what-is-a-qubit', 42], quizScores: { x: 'NaN-ish' } },
        exam_attempts: ['not-a-record', { examId: 'nope', score: 0.9 }],
      })
    )
    expect(Array.isArray(out.suggestedSession)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// export_notebook
// ────────────────────────────────────────────────────────────

describe('export_notebook', () => {
  it('exports a Bell circuit as parseable nbformat-4.5 JSON with the QASM embedded', async () => {
    for (const variant of ['qiskit', 'pennylane'] as const) {
      const out = structured(await callToolAsync('export_notebook', { qasm: BELL_QASM, variant, name: 'Bell pair' }))
      expect(out.variant).toBe(variant)
      expect(out.filename).toBe(`bell-pair.${variant}.ipynb`)
      const nb = JSON.parse(out.notebook as string) as {
        nbformat: number
        nbformat_minor: number
        cells: { id: string; source: string[] }[]
      }
      expect(nb.nbformat).toBe(4)
      expect(nb.nbformat_minor).toBe(5)
      expect(nb.cells.length).toBeGreaterThan(2)
      for (const cell of nb.cells) expect(cell.id.length).toBeGreaterThan(0)
      // The exported source must carry the circuit itself.
      const all = nb.cells.map((c) => c.source.join('')).join('\n')
      expect(all).toContain('OPENQASM 3')
    }
  })

  it('is byte-identical across calls (deterministic cell ids)', async () => {
    const a = structured(await callToolAsync('export_notebook', { qasm: BELL_QASM, variant: 'qiskit' }))
    const b = structured(await callToolAsync('export_notebook', { qasm: BELL_QASM, variant: 'qiskit' }))
    expect(a.notebook).toBe(b.notebook)
  })

  it('rejects an unknown variant and non-QASM input', async () => {
    expect((await callToolAsync('export_notebook', { qasm: BELL_QASM, variant: 'cirq' })).isError).toBe(true)
    expect((await callToolAsync('export_notebook', { qasm: 'not qasm', variant: 'qiskit' })).isError).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// submit_hardware_job — the auth boundary IS the test
// ────────────────────────────────────────────────────────────

describe('submit_hardware_job', () => {
  const JOB_ARGS = { qasm: BELL_QASM, backend: 'ibm_brisbane', shots: 100 }

  it('REFUSES without a Bearer token, naming exactly what is needed', async () => {
    const result = await callToolAsync('submit_hardware_job', JOB_ARGS)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Authorization: Bearer')
    expect(result.content[0].text).toContain('nothing was submitted')
  })

  it('refuses a malformed Authorization header the same way', async () => {
    for (const authorization of ['', 'Bearer', 'Basic dXNlcg==', 'token abc']) {
      const result = await callToolAsync('submit_hardware_job', JOB_ARGS, { authorization })
      expect(result.isError, `header "${authorization}" must be refused`).toBe(true)
      expect(result.content[0].text).toContain('Authorization: Bearer')
    }
  })

  it('with a token, the request reaches the REAL gate chain and its verdict comes back', async () => {
    // No Supabase env is configured in tests, so `requireCaller` inside
    // app/api/hardware/submit/route.ts rejects the token — proving the call
    // went THROUGH the route's gates rather than around them. (A bypass would
    // have forwarded upstream and failed with a connection error instead.)
    const result = await callToolAsync('submit_hardware_job', JOB_ARGS, {
      authorization: 'Bearer not-a-real-token',
      forwardedFor: '203.0.113.7',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/HTTP (401|429|503)/)
  })

  it('refuses over the route too, without touching the billing stack', async () => {
    const res = await POST(
      post({
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: { name: 'submit_hardware_job', arguments: JOB_ARGS },
      }),
      CTX,
    )
    const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('Authorization: Bearer')
  })
})

const CTX = { params: Promise.resolve({ transport: 'mcp' }) }

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/mcp/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('MCP route (streamable HTTP, stateless)', () => {
  it('answers initialize with a supported protocol version and tool capability', async () => {
    const res = await POST(
      post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      }),
      CTX,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      result: { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } }
    }
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.serverInfo.name).toBe('quantum-lab')
  })

  it('accepts notifications/initialized with 202 and no body', async () => {
    const res = await POST(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), CTX)
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('serves tools/list and an end-to-end tools/call', async () => {
    const list = await POST(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), CTX)
    const listBody = (await list.json()) as { result: { tools: { name: string }[] } }
    expect(listBody.result.tools.length).toBe(MCP_TOOLS.length)

    const call = await POST(
      post({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'run_circuit', arguments: { qasm: BELL_QASM, shots: 128, seed: 1 } },
      }),
      CTX,
    )
    const callBody = (await call.json()) as {
      result: { isError?: boolean; structuredContent: { counts: Record<string, number> } }
    }
    expect(callBody.result.isError).not.toBe(true)
    const counts = callBody.result.structuredContent.counts
    expect(Object.keys(counts).sort()).toEqual(['00', '11'])
  })

  it('rejects an unknown tool with -32602 and an unknown method with -32601', async () => {
    const tool = await POST(
      post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }),
      CTX,
    )
    expect(((await tool.json()) as { error: { code: number } }).error.code).toBe(-32602)

    const method = await POST(post({ jsonrpc: '2.0', id: 5, method: 'resources/list' }), CTX)
    expect(((await method.json()) as { error: { code: number } }).error.code).toBe(-32601)
  })

  it('rejects malformed bodies, batches, and unsupported protocol headers', async () => {
    const garbage = await POST(post('not json'), CTX)
    expect(garbage.status).toBe(400)

    const batch = await POST(post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]), CTX)
    expect(batch.status).toBe(400)

    const version = await POST(
      post({ jsonrpc: '2.0', id: 6, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' }),
      CTX,
    )
    expect(version.status).toBe(400)
  })

  it('blocks cross-site browser origins but not origin-less MCP clients', async () => {
    const evil = await POST(
      post({ jsonrpc: '2.0', id: 7, method: 'ping' }, { origin: 'https://evil.example' }),
      CTX,
    )
    expect(evil.status).toBe(403)

    const clean = await POST(post({ jsonrpc: '2.0', id: 8, method: 'ping' }), CTX)
    expect(clean.status).toBe(200)
  })

  it('404s an unknown transport segment and 405s GET', async () => {
    const wrong = await POST(post({ jsonrpc: '2.0', id: 9, method: 'ping' }), {
      params: Promise.resolve({ transport: 'sse' }),
    })
    expect(wrong.status).toBe(404)

    const get = await GET()
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
  })
})
