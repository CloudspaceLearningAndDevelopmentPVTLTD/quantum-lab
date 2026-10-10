import { describe, it, expect } from 'vitest'
import { mulberry32, runCircuitOn, simulate, type Circuit, type GateOp } from '@/lib/quantum'
import {
  CPU_MAX_QUBITS,
  CpuBackend,
  ENGINE_MAX_QUBITS,
  recordCircuit,
  runCircuit,
  statevectorBytes,
} from './backend'
import { createBackend, detectWebGpu, selectBackend } from './webgpu'
import { ghzCircuit, randomCircuit } from './webgpu/benchmarks'
import { maxAmplitudeDeviation } from './webgpu/reference'

describe('runCircuitOn (the lib/quantum.ts hook)', () => {
  it('sends one matrix call per gate and skips MEASURE and BARRIER', () => {
    const circuit: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'BARRIER', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'CCX', qubits: [0, 1, 2] },
        { name: 'SWAP', qubits: [1, 2] },
        { name: 'MEASURE', qubits: [2] },
      ],
    }
    const calls: string[] = []
    runCircuitOn(circuit, {
      applyGate: (_m, t) => calls.push(`gate ${t}`),
      applyControlled: (_m, cs, t) => calls.push(`ctrl ${cs.join(',')}→${t}`),
      applySwap: (a, b) => calls.push(`swap ${a} ${b}`),
    })
    expect(calls).toEqual(['gate 0', 'ctrl 0→1', 'ctrl 0,1→2', 'swap 1 2'])
  })

  it('refuses a conditioned op and an arity mismatch, as StateVector.apply does', () => {
    const sink = { applyGate() {}, applyControlled() {}, applySwap() {} }
    expect(() =>
      runCircuitOn({ numQubits: 1, ops: [{ name: 'X', qubits: [0], condition: { bit: 0, value: 1 } }] }, sink)
    ).toThrow(/conditioned/)
    expect(() => runCircuitOn({ numQubits: 2, ops: [{ name: 'CX', qubits: [0] }] }, sink)).toThrow(/takes 2/)
  })
})

describe('CpuBackend', () => {
  it('matches simulate() on random circuits up to 8 qubits, fused and unfused', async () => {
    for (let n = 1; n <= 8; n++) {
      const circuit = randomCircuit(n, 20, 40 + n)
      for (const fuse of [true, false]) {
        const backend = new CpuBackend()
        backend.allocate(n)
        runCircuit(circuit, backend, { fuse })
        await backend.flush()
        expect(maxAmplitudeDeviation(await backend.amplitudes(), simulate(circuit).data)).toBeLessThan(1e-6)
        backend.dispose()
      }
    }
  })

  it('reports float64, its probabilities sum to 1, and topStates finds GHZ\'s two states', async () => {
    const backend = new CpuBackend()
    expect(backend.precision).toBe('float64')
    expect(backend.kind).toBe('cpu')
    backend.allocate(6)
    runCircuit(ghzCircuit(6), backend)
    const probs = await backend.probabilities()
    expect(probs.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12)
    const top = await backend.topStates(3)
    expect(top.map((s) => s.index)).toEqual([0, 63, 1])
    expect(top[0].probability).toBeCloseTo(0.5, 12)
    expect(top[2].probability).toBe(0)
    expect(await backend.marginal(3)).toBeCloseTo(0.5, 12)
    backend.dispose()
  })

  it('measure() collapses with the given rng and the outcome is consistent with the marginal', async () => {
    const backend = new CpuBackend()
    backend.allocate(3)
    runCircuit(ghzCircuit(3), backend)
    expect(await backend.measure(0, () => 0.01)).toBe(1) // rng < p1 = 0.5 reads 1
    const amps = await backend.amplitudes()
    expect(amps[2 * 7]).toBeCloseTo(1, 12)
    expect(await backend.marginal(2)).toBeCloseTo(1, 12)
    backend.dispose()
  })

  it('runs above the engine ceiling on a raw array: GHZ-17 has its two states, QFT-17 on |0⟩ is uniform', async () => {
    const n = ENGINE_MAX_QUBITS + 1
    const backend = new CpuBackend()
    backend.allocate(n)
    runCircuit(ghzCircuit(n), backend)
    const top = await backend.topStates(2)
    expect(top.map((s) => s.index)).toEqual([0, (1 << n) - 1])
    expect(top[0].probability).toBeCloseTo(0.5, 12)
    expect(await backend.marginal(n - 1)).toBeCloseTo(0.5, 12)
    // H on every qubit is the QFT of |0⟩ — uniform, every state at 2^-n.
    backend.allocate(n)
    runCircuit({ numQubits: n, ops: Array.from({ length: n }, (_, q) => ({ name: 'H' as const, qubits: [q] })) }, backend)
    const probs = await backend.probabilities()
    expect(probs[0]).toBeCloseTo(2 ** -n, 12)
    expect(probs[probs.length - 1]).toBeCloseTo(2 ** -n, 12)
    backend.dispose()
  })

  it('rejects use before allocate(), after dispose(), and past its ceiling', async () => {
    const backend = new CpuBackend()
    expect(() => backend.applySwap(0, 1)).toThrow(/allocate/)
    expect(() => backend.allocate(CPU_MAX_QUBITS + 1)).toThrow(/at most/)
    expect(() => runCircuit(ghzCircuit(2), backend)).toThrow(/allocate/)
    backend.allocate(2)
    backend.dispose()
    expect(() => backend.allocate(2)).toThrow(/disposed/)
  })

  it('statevectorBytes is 2^N × 16 (float64) and 2^N × 8 (float32)', () => {
    expect(statevectorBytes(20, 'float64')).toBe(16 * 1024 * 1024)
    expect(statevectorBytes(20, 'float32')).toBe(8 * 1024 * 1024)
  })
})

describe('recordCircuit', () => {
  it('preserves gate order and copies control lists', () => {
    const ops: GateOp[] = [{ name: 'CX', qubits: [1, 0] }, { name: 'T', qubits: [1] }]
    const recorded = recordCircuit({ numQubits: 2, ops })
    expect(recorded.map((o) => o.kind)).toEqual(['controlled', 'gate'])
    expect(recorded[0]).toMatchObject({ controls: [1], target: 0 })
  })
})

describe('backend selection and fallback', () => {
  it('detects the absence of WebGPU in Node', () => {
    const support = detectWebGpu(undefined)
    expect(support.available).toBe(false)
    expect(support.reason).toMatch(/browser/)
    const noGpu = detectWebGpu({} as Navigator)
    expect(noGpu.available).toBe(false)
    expect(noGpu.reason).toMatch(/Firefox/)
  })

  it('selectBackend honours an explicit CPU request and falls back without support', () => {
    const yes = { available: true, reason: '' }
    const no = { available: false, reason: 'nope' }
    expect(selectBackend('cpu', yes)).toBe('cpu')
    expect(selectBackend('webgpu', yes)).toBe('webgpu')
    expect(selectBackend('auto', yes)).toBe('webgpu')
    expect(selectBackend('auto', no)).toBe('cpu')
    expect(selectBackend('webgpu', no)).toBe('cpu')
  })

  it('createBackend returns a CpuBackend with a reason when navigator.gpu is missing', async () => {
    const sel = await createBackend({ prefer: 'webgpu', navigator: {} as Navigator })
    expect(sel.backend.kind).toBe('cpu')
    expect(sel.fallbackReason).toMatch(/WebGPU/)
    sel.backend.dispose()
  })

  it('createBackend falls back when the GPU factory throws, and passes through when it succeeds', async () => {
    const nav = { gpu: {} } as unknown as Navigator
    const failed = await createBackend({
      prefer: 'auto',
      navigator: nav,
      webgpuFactory: async () => { throw new Error('no adapter offered') },
    })
    expect(failed.backend.kind).toBe('cpu')
    expect(failed.fallbackReason).toBe('no adapter offered')

    const fake = new CpuBackend()
    const ok = await createBackend({ prefer: 'webgpu', navigator: nav, webgpuFactory: async () => fake })
    expect(ok.backend).toBe(fake)
    expect(ok.fallbackReason).toBeUndefined()
  })

  it('an explicit CPU request never touches the GPU factory', async () => {
    let called = false
    const sel = await createBackend({
      prefer: 'cpu',
      navigator: { gpu: {} } as unknown as Navigator,
      webgpuFactory: async () => { called = true; return new CpuBackend() },
    })
    expect(called).toBe(false)
    expect(sel.backend.kind).toBe('cpu')
    expect(sel.fallbackReason).toBeUndefined()
  })
})

describe('determinism', () => {
  it('mulberry32-seeded random circuits are identical across calls', () => {
    const a = randomCircuit(5, 20, 99)
    const b = randomCircuit(5, 20, 99)
    expect(a).toEqual(b)
    expect(mulberry32(1)()).toBe(mulberry32(1)())
  })
})
