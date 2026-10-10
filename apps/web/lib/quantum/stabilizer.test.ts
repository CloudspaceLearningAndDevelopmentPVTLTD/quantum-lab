import { describe, expect, it } from 'vitest'
import { StateVector, mulberry32 } from '@/lib/quantum'
import {
  SINGLE_QUBIT_CLIFFORDS,
  TWO_QUBIT_CLIFFORD_COUNT,
  Tableau,
  applyCliffordOp,
  applyTwoQubitClifford,
  applyTwoQubitCliffordGates,
  clusterChainProgram,
  clusterGridProgram,
  ghzProgram,
  parseCliffordProgram,
  randomBrickwork,
  runCliffordProgram,
  type CliffordOp,
} from './stabilizer'

/**
 * The tableau is checked against the statevector engine, not against itself:
 * the same random Clifford circuit goes through both, and every stabilizer the
 * tableau reports must actually stabilize the amplitudes, sign included.
 */

function randomOps(n: number, count: number, rng: () => number): CliffordOp[] {
  const one = ['H', 'S', 'SDG', 'X', 'Y', 'Z', 'SX', 'SXDG'] as const
  const two = ['CX', 'CY', 'CZ', 'SWAP'] as const
  const ops: CliffordOp[] = []
  for (let i = 0; i < count; i++) {
    const a = Math.floor(rng() * n)
    if (n > 1 && rng() < 0.4) {
      let b = Math.floor(rng() * (n - 1))
      if (b >= a) b++
      ops.push({ gate: two[Math.floor(rng() * two.length)], qubits: [a, b] })
    } else {
      ops.push({ gate: one[Math.floor(rng() * one.length)], qubits: [a] })
    }
  }
  return ops
}

function applyToStateVector(sv: StateVector, op: CliffordOp): void {
  const [a, b] = op.qubits
  switch (op.gate) {
    case 'CX':
      sv.applyControlled('X', [a], b)
      break
    case 'CY':
      sv.applyControlled('Y', [a], b)
      break
    case 'CZ':
      sv.applyControlled('Z', [a], b)
      break
    case 'SWAP':
      sv.applySwap(a, b)
      break
    case 'M':
    case 'RESET':
      throw new Error('not used here')
    default:
      sv.applySingle(op.gate, a)
  }
}

/** ⟨ψ|P|ψ⟩ for a Pauli string like "+XZY" — must be exactly +1 for a stabilizer. */
function stabilizerExpectation(sv: StateVector, pauli: string): number {
  const after = sv.clone()
  for (let q = 0; q < sv.numQubits; q++) {
    const p = pauli[q + 1]
    if (p !== 'I') after.applySingle(p as 'X' | 'Y' | 'Z', q)
  }
  let re = 0
  for (let i = 0; i < sv.data.length; i += 2) {
    re += sv.data[i] * after.data[i] + sv.data[i + 1] * after.data[i + 1]
  }
  return pauli[0] === '-' ? -re : re
}

/** −log2 Tr ρ_A² for A = qubits 0..k-1. Equals S(A) for a stabilizer state. */
function renyi2(sv: StateVector, k: number): number {
  const dimA = 1 << k
  const dimB = sv.dim / dimA
  let purity = 0
  for (let i = 0; i < dimA; i++) {
    for (let j = 0; j < dimA; j++) {
      let re = 0
      let im = 0
      for (let e = 0; e < dimB; e++) {
        const p = 2 * (i + e * dimA)
        const q = 2 * (j + e * dimA)
        re += sv.data[p] * sv.data[q] + sv.data[p + 1] * sv.data[q + 1]
        im += sv.data[p + 1] * sv.data[q] - sv.data[p] * sv.data[q + 1]
      }
      purity += re * re + im * im
    }
  }
  return -Math.log2(purity)
}

describe('Tableau against the statevector engine', () => {
  for (const n of [1, 2, 3, 5, 6]) {
    it(`agrees on random ${n}-qubit Clifford circuits`, () => {
      const rng = mulberry32(1000 + n)
      for (let trial = 0; trial < 25; trial++) {
        const ops = randomOps(n, 8 * n, rng)
        const t = new Tableau(n)
        const sv = new StateVector(n)
        for (const op of ops) {
          applyCliffordOp(t, op)
          applyToStateVector(sv, op)
        }

        for (const s of t.stabilizers()) {
          expect(stabilizerExpectation(sv, s), `${s} after ${JSON.stringify(ops)}`).toBeCloseTo(1, 9)
        }

        const profile = t.entropyProfile()
        for (let k = 0; k <= n; k++) {
          expect(profile[k]).toBeCloseTo(renyi2(sv, k), 9)
        }

        for (let q = 0; q < n; q++) {
          const p1 = sv.qubitProbability(q)
          if (t.isDeterministic(q)) {
            expect(t.clone().measure(q).outcome).toBe(Math.round(p1))
            expect(Math.abs(p1 - Math.round(p1))).toBeLessThan(1e-9)
          } else {
            expect(p1).toBeCloseTo(0.5, 9)
          }
        }
      }
    })
  }

  it('collapses the way the statevector does', () => {
    const rng = mulberry32(77)
    for (let trial = 0; trial < 40; trial++) {
      const n = 4
      const ops = randomOps(n, 30, rng)
      const t = new Tableau(n)
      const sv = new StateVector(n)
      for (const op of ops) {
        applyCliffordOp(t, op)
        applyToStateVector(sv, op)
      }
      // Measure every qubit on the tableau, force the same outcomes on the
      // amplitudes; an outcome the statevector calls impossible would throw.
      for (let q = 0; q < n; q++) {
        const { outcome } = t.measure(q, rng)
        sv.collapseQubit(q, outcome)
        for (const s of t.stabilizers()) {
          expect(stabilizerExpectation(sv, s)).toBeCloseTo(1, 9)
        }
      }
    }
  })
})

describe('Tableau basics', () => {
  it('starts in |0…0⟩ and X flips a deterministic outcome', () => {
    const t = new Tableau(3)
    expect(t.stabilizers()).toEqual(['+ZII', '+IZI', '+IIZ'])
    expect(t.measure(1)).toEqual({ outcome: 0, deterministic: true })
    t.x_(1)
    expect(t.measure(1)).toEqual({ outcome: 1, deterministic: true })
  })

  it('a random outcome is random once and then repeats', () => {
    const t = new Tableau(1).h(0)
    const first = t.measure(0, () => 0.9)
    expect(first).toEqual({ outcome: 1, deterministic: false })
    expect(t.measure(0, () => 0.1)).toEqual({ outcome: 1, deterministic: true })
  })

  it('rejects out-of-range qubits and sizes', () => {
    expect(() => new Tableau(0)).toThrow()
    expect(() => new Tableau(2).h(2)).toThrow()
    expect(() => new Tableau(2).cx(1, 1)).toThrow()
  })

  it('runs a 1000-qubit GHZ state and every qubit agrees', () => {
    const { tableau } = runCliffordProgram(ghzProgram(1000))
    const profile = tableau.entropyProfile()
    expect(profile[0]).toBe(0)
    expect(profile[1000]).toBe(0)
    for (let k = 1; k < 1000; k++) expect(profile[k]).toBe(1)
    const rng = mulberry32(5)
    const first = tableau.measure(0, rng).outcome
    for (let q = 1; q < 1000; q++) {
      expect(tableau.measure(q, rng)).toEqual({ outcome: first, deterministic: true })
    }
  })

  it('gives the cluster states their known cut entropies', () => {
    const chain = runCliffordProgram(clusterChainProgram(40)).tableau.entropyProfile()
    for (let k = 1; k < 40; k++) expect(chain[k]).toBe(1)
    // A row-major cut through a 6×6 grid at a row boundary severs 6 bonds.
    const grid = runCliffordProgram(clusterGridProgram(6)).tableau.entropyProfile()
    expect(grid[18]).toBe(6)
  })

  it('a deep random brickwork is close to maximally entangled', () => {
    const t = randomBrickwork(24, 48, mulberry32(11))
    expect(t.entropy(12)).toBeGreaterThanOrEqual(10)
    expect(t.entropy(12)).toBeLessThanOrEqual(12)
  })
})

describe('uniform Clifford sampling', () => {
  it('finds exactly 24 single-qubit Cliffords', () => {
    expect(SINGLE_QUBIT_CLIFFORDS).toHaveLength(24)
  })

  it('enumerates 11520 distinct two-qubit Cliffords', () => {
    const seen = new Set<string>()
    for (let i = 0; i < TWO_QUBIT_CLIFFORD_COUNT; i++) {
      const t = new Tableau(2)
      applyTwoQubitClifford(t, 0, 1, i)
      seen.add(t.destabilizers().join() + t.stabilizers().join())
    }
    expect(seen.size).toBe(11520)
  })

  it('the lookup-table path is the same gate as the H/S/CNOT sequence', () => {
    const rng = mulberry32(31)
    for (let trial = 0; trial < 300; trial++) {
      const index = Math.floor(rng() * TWO_QUBIT_CLIFFORD_COUNT)
      const viaTable = new Tableau(5)
      const viaGates = new Tableau(5)
      for (const op of randomOps(5, 30, rng)) {
        applyCliffordOp(viaTable, op)
        applyCliffordOp(viaGates, op)
      }
      // Qubits in both orders, and far enough apart to not be neighbours.
      const [a, b] = trial % 2 ? [3, 0] : [1, 4]
      applyTwoQubitClifford(viaTable, a, b, index)
      applyTwoQubitCliffordGates(viaGates, a, b, index)
      expect(viaTable.stabilizers()).toEqual(viaGates.stabilizers())
      expect(viaTable.destabilizers()).toEqual(viaGates.destabilizers())
    }
  })
})

describe('parseCliffordProgram', () => {
  it('reads OpenQASM 3 and 2 forms', () => {
    const q3 = parseCliffordProgram('OPENQASM 3;\nqubit[3] q;\nbit[3] c;\nh q[0]; cx q[0], q[1];\nc[0] = measure q[0];')
    expect(q3).toEqual({
      numQubits: 3,
      ops: [
        { gate: 'H', qubits: [0] },
        { gate: 'CX', qubits: [0, 1] },
        { gate: 'M', qubits: [0] },
      ],
    })
    const q2 = parseCliffordProgram('qreg r[2];\ncreg c[2];\nh r; // both\nmeasure r[1] -> c[1];')
    expect(q2.ops).toEqual([
      { gate: 'H', qubits: [0] },
      { gate: 'H', qubits: [1] },
      { gate: 'M', qubits: [1] },
    ])
  })

  it('explains why a T gate cannot run', () => {
    expect(() => parseCliffordProgram('qubit[1] q;\nt q[0];')).toThrow(/Line 2: t is not a Clifford gate/)
    expect(() => parseCliffordProgram('qubit[1] q;\nrz(0.3) q[0];')).toThrow(/not a Clifford gate/)
  })

  it('names the line of a bad statement', () => {
    expect(() => parseCliffordProgram('h q[0];')).toThrow(/Line 1: declare the register/)
    expect(() => parseCliffordProgram('qubit[2] q;\ncx q[0], q[0];')).toThrow(/Line 2/)
    expect(() => parseCliffordProgram('qubit[2] q;\nh q[5];')).toThrow(/outside the 2-qubit register/)
    expect(() => parseCliffordProgram('')).toThrow(/Declare a register/)
  })
})
