import { describe, it, expect } from 'vitest'
import { c, cExp, simulate, type Circuit, type Matrix2x2 } from '@/lib/quantum'
import { CpuBackend, recordCircuit, runCircuit, type BackendOp } from '../backend'
import { IDENTITY, fuseSingleQubitGates, matmul } from './fusion'
import { randomCircuit } from './benchmarks'
import { maxAmplitudeDeviation } from './reference'

const r = Math.SQRT1_2
const H: Matrix2x2 = [c(r), c(r), c(r), c(-r)]
const X: Matrix2x2 = [c(0), c(1), c(1), c(0)]
const Z: Matrix2x2 = [c(1), c(0), c(0), c(-1)]
const S: Matrix2x2 = [c(1), c(0), c(0), c(0, 1)]
const T: Matrix2x2 = [c(1), c(0), c(0), cExp(Math.PI / 4)]

function expectMatrix(got: Matrix2x2, want: Matrix2x2, digits = 12): void {
  for (let i = 0; i < 4; i++) {
    expect(got[i].re).toBeCloseTo(want[i].re, digits)
    expect(got[i].im).toBeCloseTo(want[i].im, digits)
  }
}

describe('matmul', () => {
  it('H·H = I, S·S = Z, T·T = S — textbook identities', () => {
    expectMatrix(matmul(H, H), IDENTITY)
    expectMatrix(matmul(S, S), Z)
    expectMatrix(matmul(T, T), S)
  })

  it('H·X·H = Z, in the "apply X then ..." order the pass uses', () => {
    // apply H, then X, then H  →  H·X·H
    expectMatrix(matmul(H, matmul(X, H)), Z)
  })

  it('is not commutative: X·S ≠ S·X', () => {
    const xs = matmul(X, S)
    const sx = matmul(S, X)
    expect(xs[1].im).toBeCloseTo(1, 12)
    expect(sx[1].im).toBeCloseTo(0, 12)
  })
})

describe('fuseSingleQubitGates', () => {
  it('folds H, X, H on one qubit into a single Z', () => {
    const ops: BackendOp[] = [
      { kind: 'gate', matrix: H, target: 0 },
      { kind: 'gate', matrix: X, target: 0 },
      { kind: 'gate', matrix: H, target: 0 },
    ]
    const fused = fuseSingleQubitGates(ops)
    expect(fused).toHaveLength(1)
    expect(fused[0].kind).toBe('gate')
    if (fused[0].kind === 'gate') expectMatrix(fused[0].matrix, Z)
  })

  it('keeps per-qubit order and flushes before a multi-qubit op that touches the qubit', () => {
    const ops: BackendOp[] = [
      { kind: 'gate', matrix: S, target: 1 },
      { kind: 'gate', matrix: X, target: 0 },
      { kind: 'controlled', matrix: X, controls: [0], target: 1 },
      { kind: 'gate', matrix: H, target: 0 },
      { kind: 'swap', a: 0, b: 2 },
    ]
    const fused = fuseSingleQubitGates(ops)
    expect(fused.map((o) => o.kind)).toEqual(['gate', 'gate', 'controlled', 'gate', 'swap'])
    // Pending gates flush in qubit order: X on 0 before S on 1.
    expect(fused[0]).toMatchObject({ kind: 'gate', target: 0 })
    expect(fused[1]).toMatchObject({ kind: 'gate', target: 1 })
  })

  it('does not flush a pending gate on a qubit the multi-qubit op does not touch', () => {
    const ops: BackendOp[] = [
      { kind: 'gate', matrix: H, target: 2 },
      { kind: 'controlled', matrix: X, controls: [0], target: 1 },
      { kind: 'gate', matrix: H, target: 2 },
    ]
    const fused = fuseSingleQubitGates(ops)
    // H·H on qubit 2 fused into one identity gate, emitted after the CX.
    expect(fused.map((o) => o.kind)).toEqual(['controlled', 'gate'])
    if (fused[1].kind === 'gate') expectMatrix(fused[1].matrix, IDENTITY)
  })

  it('leaves the state unchanged on random circuits and reduces the op count', async () => {
    for (let n = 2; n <= 8; n++) {
      const circuit: Circuit = randomCircuit(n, 20, 900 + n)
      const recorded = recordCircuit(circuit)
      const fused = fuseSingleQubitGates(recorded)
      // At 2 qubits every layer's CX touches both qubits, so nothing can fuse.
      if (n === 2) expect(fused.length).toBe(recorded.length)
      else expect(fused.length).toBeLessThan(recorded.length)

      const backend = new CpuBackend()
      backend.allocate(n)
      const dispatches = runCircuit(circuit, backend, { fuse: true })
      expect(dispatches).toBe(fused.length)
      const amps = await backend.amplitudes()
      expect(maxAmplitudeDeviation(amps, simulate(circuit).data)).toBeLessThan(1e-9)
      backend.dispose()
    }
  })

  it('an empty list fuses to an empty list', () => {
    expect(fuseSingleQubitGates([])).toEqual([])
  })
})
