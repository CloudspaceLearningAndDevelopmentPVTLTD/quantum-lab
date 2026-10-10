import { describe, it, expect } from 'vitest'
import { c, cExp, mulberry32, simulate, type Circuit, type GateOp, type Matrix2x2 } from '@/lib/quantum'
import { recordCircuit, replayOps } from '../backend'
import {
  applyControlledRef,
  applyGateRef,
  applySwapRef,
  collapseRef,
  marginalRef,
  maxAmplitudeDeviation,
  probabilitiesRef,
  topStatesRef,
} from './reference'
import { ghzCircuit, qftCircuit, randomCircuit } from './benchmarks'

const H: Matrix2x2 = [c(Math.SQRT1_2), c(Math.SQRT1_2), c(Math.SQRT1_2), c(-Math.SQRT1_2)]
const X: Matrix2x2 = [c(0), c(1), c(1), c(0)]

/** Run a circuit through the reference kernels on a fresh float64 array. */
function runReference(circuit: Circuit, data?: Float32Array | Float64Array) {
  const n = circuit.numQubits
  const amps = data ?? new Float64Array(2 << n)
  if (!data) amps[0] = 1
  replayOps(recordCircuit(circuit), {
    applyGate: (m, t) => applyGateRef(amps, n, m, t),
    applyControlled: (m, cs, t) => applyControlledRef(amps, n, m, cs, t),
    applySwap: (a, b) => applySwapRef(amps, n, a, b),
  })
  return amps
}

describe('reference kernels against analytic states', () => {
  it('H on |0⟩ gives (1, 1)/√2', () => {
    const amps = new Float64Array([1, 0, 0, 0])
    applyGateRef(amps, 1, H, 0)
    expect(amps[0]).toBeCloseTo(Math.SQRT1_2, 12)
    expect(amps[2]).toBeCloseTo(Math.SQRT1_2, 12)
    expect(amps[1]).toBe(0)
    expect(amps[3]).toBe(0)
  })

  it('X on qubit 1 of a 3-qubit |000⟩ moves the amplitude to index 2', () => {
    const amps = new Float64Array(16)
    amps[0] = 1
    applyGateRef(amps, 3, X, 1)
    expect(Array.from(amps)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('a controlled X does nothing when the control is 0 and flips when it is 1', () => {
    const amps = new Float64Array(8)
    amps[0] = 1
    applyControlledRef(amps, 2, X, [0], 1)
    expect(amps[0]).toBe(1)
    applyGateRef(amps, 2, X, 0) // |01⟩ (qubit 0 set)
    applyControlledRef(amps, 2, X, [0], 1)
    expect(amps[2 * 3]).toBe(1) // |11⟩
  })

  it('SWAP moves |01⟩ to |10⟩ in a 4-qubit register', () => {
    const amps = new Float64Array(32)
    amps[2 * 1] = 1 // qubit 0 set
    applySwapRef(amps, 4, 0, 3)
    expect(amps[2 * 1]).toBe(0)
    expect(amps[2 * 8]).toBe(1)
    applySwapRef(amps, 4, 2, 2) // identity
    expect(amps[2 * 8]).toBe(1)
  })

  it('GHZ-5 has amplitude 1/√2 on |00000⟩ and |11111⟩ and nothing else', () => {
    const amps = runReference(ghzCircuit(5))
    for (let i = 0; i < 32; i++) {
      const expected = i === 0 || i === 31 ? Math.SQRT1_2 : 0
      expect(amps[2 * i]).toBeCloseTo(expected, 12)
      expect(amps[2 * i + 1]).toBeCloseTo(0, 12)
    }
  })

  it('QFT-4 on |x⟩ gives e^{2πi xk/16}/4 on |k⟩', () => {
    const n = 4
    for (const x of [0, 1, 5, 11, 15]) {
      const prep: GateOp[] = []
      for (let q = 0; q < n; q++) if ((x >> q) & 1) prep.push({ name: 'X', qubits: [q] })
      const qft = qftCircuit(n)
      const amps = runReference({ numQubits: n, ops: [...prep, ...qft.ops] })
      for (let k = 0; k < 16; k++) {
        const expected = cExp((2 * Math.PI * x * k) / 16)
        expect(amps[2 * k]).toBeCloseTo(expected.re / 4, 10)
        expect(amps[2 * k + 1]).toBeCloseTo(expected.im / 4, 10)
      }
    }
  })

  it('marginal, probabilities, collapse and topStates agree with the Bell state by hand', () => {
    const amps = runReference(ghzCircuit(2))
    expect(marginalRef(amps, 2, 0)).toBeCloseTo(0.5, 12)
    expect(marginalRef(amps, 2, 1)).toBeCloseTo(0.5, 12)
    expect(Array.from(probabilitiesRef(amps))).toEqual([0.5, 0, 0, 0.5].map((p) => expect.closeTo(p, 12)))
    expect(topStatesRef(amps, 2)).toEqual([
      { index: 0, probability: expect.closeTo(0.5, 12) },
      { index: 3, probability: expect.closeTo(0.5, 12) },
    ])
    collapseRef(amps, 2, 0, 1)
    expect(amps[2 * 3]).toBeCloseTo(1, 12)
    expect(amps[0]).toBe(0)
    expect(() => collapseRef(amps, 2, 0, 0)).toThrow(/cannot collapse/)
  })

  it('topStates ranks highest first and breaks ties by lower index', () => {
    const amps = new Float64Array([0.1, 0, 0.5, 0, 0.5, 0, 0.7, 0])
    expect(topStatesRef(amps, 3).map((s) => s.index)).toEqual([3, 1, 2])
    expect(topStatesRef(amps, 0)).toEqual([])
    expect(topStatesRef(amps, 99)).toHaveLength(4)
  })
})

describe('reference kernels against lib/quantum.ts on random circuits', () => {
  it('match simulate() to 1e-6 for random depth-20 circuits on 1..8 qubits', () => {
    for (let n = 1; n <= 8; n++) {
      for (let seed = 1; seed <= 6; seed++) {
        const circuit = randomCircuit(n, 20, seed * 101 + n)
        const engine = simulate(circuit)
        const ref = runReference(circuit)
        expect(maxAmplitudeDeviation(ref, engine.data)).toBeLessThan(1e-6)
      }
    }
  })

  it('match simulate() on QFT-N and GHZ-N for N up to 8', () => {
    for (let n = 1; n <= 8; n++) {
      for (const circuit of [qftCircuit(n), ghzCircuit(n)]) {
        expect(maxAmplitudeDeviation(runReference(circuit), simulate(circuit).data)).toBeLessThan(1e-9)
      }
    }
  })

  it('cover SWAP, CCX, CY and CZ against the engine', () => {
    const rng = mulberry32(7)
    for (let trial = 0; trial < 20; trial++) {
      const n = 3 + Math.floor(rng() * 4)
      const ops: GateOp[] = []
      const pick = () => Math.floor(rng() * n)
      const distinct = (k: number): number[] => {
        const s = new Set<number>()
        while (s.size < k) s.add(pick())
        return [...s]
      }
      for (let g = 0; g < 30; g++) {
        const r = rng()
        if (r < 0.3) ops.push({ name: 'H', qubits: [pick()] })
        else if (r < 0.45) ops.push({ name: 'RY', qubits: [pick()], theta: rng() * 6 })
        else if (r < 0.6) ops.push({ name: 'SWAP', qubits: distinct(2) })
        else if (r < 0.75) ops.push({ name: 'CCX', qubits: distinct(3) })
        else if (r < 0.87) ops.push({ name: 'CY', qubits: distinct(2) })
        else ops.push({ name: 'CZ', qubits: distinct(2) })
      }
      const circuit: Circuit = { numQubits: n, ops }
      expect(maxAmplitudeDeviation(runReference(circuit), simulate(circuit).data)).toBeLessThan(1e-9)
    }
  })

  it('float32 storage stays within 1e-5 of the float64 engine on 8 qubits', () => {
    const circuit = randomCircuit(8, 20, 3)
    const f32 = new Float32Array(2 << 8)
    f32[0] = 1
    runReference(circuit, f32)
    expect(maxAmplitudeDeviation(f32, simulate(circuit).data)).toBeLessThan(1e-5)
  })
})
