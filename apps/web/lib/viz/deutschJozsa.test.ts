import { describe, expect, it } from 'vitest'
import { StateVector } from '@/lib/quantum'
import {
  MAX_INPUT_QUBITS as MAX_QUBITS,
  QUANTUM_QUERIES,
  applyOracle,
  bitParity,
  bitString,
  bvClassicalQueries,
  bvReadout,
  classify,
  djClassicalQueries,
  djSteps,
  djVerdict,
  inputProbabilities,
  isProductWithAncilla,
  maxImaginary,
  nonLinearBalancedTable,
  registerAmplitudes,
  truthTable,
  type OracleSpec,
} from './deutschJozsa'

/**
 * The page claims a constant oracle always answers |0…0⟩, a balanced one never
 * does, and Bernstein–Vazirani hands back the string you hid — in ONE query, at
 * any register size. These tests check those claims against facts established
 * outside this module: enumerated truth tables, the analytic amplitude
 * (−1)^{f(x)}/√N after the kickback, and the definition of U_f as a permutation
 * of computational basis states. Nothing here asserts a djSteps() output back at
 * itself.
 */

/** Every balanced truth table on n bits, by brute force over the subsets. */
function allBalancedTables(n: number): (0 | 1)[][] {
  const dim = 1 << n
  const half = dim / 2
  const out: (0 | 1)[][] = []
  for (let mask = 0; mask < 1 << dim; mask++) {
    let ones = 0
    for (let x = 0; x < dim; x++) ones += (mask >> x) & 1
    if (ones !== half) continue
    out.push(Array.from({ length: dim }, (_, x) => ((mask >> x) & 1) as 0 | 1))
  }
  return out
}

const finalOf = (n: number, spec: OracleSpec) => {
  const steps = djSteps(n, spec)
  return steps[steps.length - 1]
}

describe('the oracle is a real reversible circuit', () => {
  it('implements |x⟩|y⟩ → |x⟩|y ⊕ f(x)⟩ on every basis state', () => {
    for (let n = 1; n <= 3; n++) {
      const dim = 1 << n
      const specs: OracleSpec[] = [
        { kind: 'constant', value: 0 },
        { kind: 'constant', value: 1 },
        { kind: 'parity', s: dim - 1, b: 0 },
        { kind: 'parity', s: 1, b: 1 },
        { kind: 'table', values: nonLinearBalancedTable(n) },
      ]
      for (const spec of specs) {
        const table = truthTable(spec, n)
        for (let x = 0; x < dim; x++) {
          for (const y of [0, 1]) {
            const sv = new StateVector(n + 1)
            // Prepare |x⟩|y⟩ by flipping the bits that should be 1.
            for (let q = 0; q < n; q++) if ((x >> q) & 1) sv.applySingle('X', q)
            if (y === 1) sv.applySingle('X', n)
            applyOracle(sv, spec, n)
            const expected = x + ((y ^ table[x]) << n)
            expect(sv.probability(expected)).toBeCloseTo(1, 12)
          }
        }
      }
    }
  })

  it('is its own inverse — two calls are the identity', () => {
    const n = 3
    const spec: OracleSpec = { kind: 'table', values: nonLinearBalancedTable(n) }
    const sv = new StateVector(n + 1)
    for (let q = 0; q <= n; q++) sv.applySingle('H', q)
    const before = Array.from(sv.data)
    applyOracle(sv, spec, n)
    applyOracle(sv, spec, n)
    for (let i = 0; i < before.length; i++) expect(sv.data[i]).toBeCloseTo(before[i], 12)
  })
})

describe('truth tables', () => {
  it('parity oracles are balanced for every s ≠ 0 and constant for s = 0', () => {
    for (let n = 1; n <= 4; n++) {
      for (let s = 0; s < 1 << n; s++) {
        for (const b of [0, 1] as const) {
          const cls = classify(truthTable({ kind: 'parity', s, b }, n))
          expect(cls).toBe(s === 0 ? 'constant' : 'balanced')
        }
      }
    }
  })

  it('f(x) = x₀ ⊕ (x₁ ∧ … ∧ x_{n−1}) is balanced at every size', () => {
    for (let n = 1; n <= 4; n++) expect(classify(nonLinearBalancedTable(n))).toBe('balanced')
  })

  it('and is NOT a parity for n ≥ 3, which is why Bernstein–Vazirani needs the promise', () => {
    // A function is a parity (affine) iff it equals x ↦ (s·x) ⊕ b for some s, b.
    const isAffine = (table: readonly (0 | 1)[], n: number): boolean => {
      for (let s = 0; s < 1 << n; s++) {
        for (const b of [0, 1] as const) {
          const cand = truthTable({ kind: 'parity', s, b }, n)
          if (cand.every((v, x) => v === table[x])) return true
        }
      }
      return false
    }
    expect(isAffine(nonLinearBalancedTable(2), 2)).toBe(true) // every balanced f on 2 bits is affine
    expect(isAffine(nonLinearBalancedTable(3), 3)).toBe(false)
    expect(isAffine(nonLinearBalancedTable(4), 4)).toBe(false)
  })

  it('bitParity agrees with counting the set bits', () => {
    for (let x = 0; x < 64; x++) {
      const bits = x.toString(2).split('').filter((c) => c === '1').length
      expect(bitParity(x)).toBe((bits % 2) as 0 | 1)
    }
  })
})

describe('phase kickback', () => {
  it('after the single oracle call every amplitude is exactly (−1)^{f(x)}/√N', () => {
    for (let n = 1; n <= 4; n++) {
      const dim = 1 << n
      const specs: OracleSpec[] = [
        { kind: 'constant', value: 1 },
        { kind: 'parity', s: dim - 1, b: 0 },
        { kind: 'parity', s: 1, b: 1 },
        { kind: 'table', values: nonLinearBalancedTable(n) },
      ]
      for (const spec of specs) {
        const table = truthTable(spec, n) // computed classically, not from the state
        const step = djSteps(n, spec).find((s) => s.id === 'oracle')
        expect(step).toBeDefined()
        // A constant-1 oracle flips EVERY sign, which is a global phase; compare
        // against the classical table up to that one overall sign.
        const sign = Math.sign(step!.amplitudes[0]) * (table[0] === 1 ? -1 : 1)
        for (let x = 0; x < dim; x++) {
          const expected = (sign * (table[x] === 1 ? -1 : 1)) / Math.sqrt(dim)
          expect(step!.amplitudes[x]).toBeCloseTo(expected, 12)
        }
      }
    }
  })

  it('leaves the magnitudes flat — a measurement at that point is still uniform', () => {
    const n = 3
    const step = djSteps(n, { kind: 'table', values: nonLinearBalancedTable(n) }).find(
      (s) => s.id === 'oracle'
    )!
    const probs = inputProbabilities(step.state, n)
    for (const p of probs) expect(p).toBeCloseTo(1 / (1 << n), 12)
  })

  it('never entangles the ancilla with the input register, at any step', () => {
    for (let n = 1; n <= 4; n++) {
      for (const spec of [
        { kind: 'constant', value: 1 },
        { kind: 'parity', s: 2 % (1 << n), b: 1 },
        { kind: 'table', values: nonLinearBalancedTable(n) },
      ] as OracleSpec[]) {
        for (const step of djSteps(n, spec)) {
          expect(isProductWithAncilla(step.state, n)).toBe(true)
          expect(maxImaginary(step.state)).toBeLessThan(1e-12)
          const norm = Math.hypot(...step.amplitudes)
          expect(norm).toBeCloseTo(1, 12)
        }
      }
    }
  })
})

describe('Deutsch–Jozsa decides in one query', () => {
  it('a constant oracle returns |0…0⟩ with probability exactly 1', () => {
    for (let n = 1; n <= 4; n++) {
      for (const value of [0, 1] as const) {
        const { pAllZero, reads } = djVerdict(finalOf(n, { kind: 'constant', value }).state, n)
        expect(pAllZero).toBeCloseTo(1, 12)
        expect(reads).toBe('constant')
      }
    }
  })

  it('EVERY balanced function on 2 and 3 bits returns |0…0⟩ with probability exactly 0', () => {
    for (const n of [2, 3]) {
      const tables = allBalancedTables(n)
      // 4 choose 2 = 6 balanced functions on 2 bits; 8 choose 4 = 70 on 3 bits.
      expect(tables.length).toBe(n === 2 ? 6 : 70)
      for (const values of tables) {
        const { pAllZero, reads } = djVerdict(finalOf(n, { kind: 'table', values }).state, n)
        expect(pAllZero).toBeLessThan(1e-24)
        expect(reads).toBe('balanced')
      }
    }
  })

  it('needs 2^{n−1} + 1 classical queries in the worst case against one quantum query', () => {
    expect(djClassicalQueries(1)).toBe(2)
    expect(djClassicalQueries(2)).toBe(3)
    expect(djClassicalQueries(3)).toBe(5)
    expect(djClassicalQueries(4)).toBe(9)
    expect(QUANTUM_QUERIES).toBe(1)
  })

  it('the classical bound is tight: half the inputs agreeing still leaves both answers open', () => {
    // Any 2^{n−1} inputs that all give 0 are consistent BOTH with the constant-0
    // function and with a balanced one, so no deterministic algorithm can stop
    // earlier — this is the fact djClassicalQueries encodes.
    const n = 3
    const half = 1 << (n - 1)
    const seen = Array.from({ length: half }, (_, x) => x)
    const constant = truthTable({ kind: 'constant', value: 0 }, n)
    const balanced: (0 | 1)[] = Array.from({ length: 1 << n }, (_, x) => (x < half ? 0 : 1))
    expect(classify(balanced)).toBe('balanced')
    for (const x of seen) expect(constant[x]).toBe(balanced[x])
    expect(djClassicalQueries(n)).toBe(half + 1)
  })
})

describe('Bernstein–Vazirani reads the whole string in one query', () => {
  it('returns the hidden s with probability 1, for every s and both offsets', () => {
    for (let n = 1; n <= 4; n++) {
      for (let s = 0; s < 1 << n; s++) {
        for (const b of [0, 1] as const) {
          const out = bvReadout(finalOf(n, { kind: 'parity', s, b }).state, n)
          expect(out.s).toBe(s)
          expect(out.probability).toBeCloseTo(1, 12)
        }
      }
    }
  })

  it('the offset b is invisible — it is a global phase, not information', () => {
    const n = 3
    for (let s = 0; s < 8; s++) {
      const p0 = inputProbabilities(finalOf(n, { kind: 'parity', s, b: 0 }).state, n)
      const p1 = inputProbabilities(finalOf(n, { kind: 'parity', s, b: 1 }).state, n)
      for (let x = 0; x < 8; x++) expect(p0[x]).toBeCloseTo(p1[x], 12)
    }
  })

  it('costs n classical queries — one bit per query is the classical information limit', () => {
    for (let n = 1; n <= 4; n++) expect(bvClassicalQueries(n)).toBe(n)
  })

  it('a balanced function that is not a parity gives no usable readout', () => {
    // Deutsch–Jozsa still says "balanced" (checked above); the BV readout is not
    // a hidden string, and the distribution is spread rather than a single spike.
    const n = 3
    const state = finalOf(n, { kind: 'table', values: nonLinearBalancedTable(n) }).state
    const out = bvReadout(state, n)
    expect(out.probability).toBeLessThan(0.99)
    expect(djVerdict(state, n).reads).toBe('balanced')
  })
})

describe('every configuration the page can be put into', () => {
  // The controls offer 2-4 input qubits crossed with four oracles, plus any
  // hidden string in Bernstein-Vazirani mode. If one of those combinations throws
  // — a multi-controlled X the engine rejects, a hidden string wider than the
  // register — the page renders a blank canvas with no error, so run them all.
  it('builds, stays normalised, and answers correctly', () => {
    for (let n = 2; n <= MAX_QUBITS; n++) {
      const specs: OracleSpec[] = [
        { kind: 'constant', value: 0 },
        { kind: 'constant', value: 1 },
        { kind: 'parity', s: (1 << n) - 1, b: 0 },
        { kind: 'table', values: nonLinearBalancedTable(n) },
        ...Array.from({ length: 1 << n }, (_, s) => ({ kind: 'parity', s, b: 0 }) as OracleSpec),
      ]
      for (const spec of specs) {
        const steps = djSteps(n, spec)
        expect(steps).toHaveLength(5)
        const table = truthTable(spec, n)
        const state = steps[4].state
        const expected = classify(table)
        if (expected !== 'neither') expect(djVerdict(state, n).reads).toBe(expected)
        if (spec.kind === 'parity') expect(bvReadout(state, n).s).toBe(spec.s)
      }
    }
  })
})

describe('display helpers', () => {
  it('registerAmplitudes returns a unit vector matching the input-register probabilities', () => {
    const n = 3
    for (const step of djSteps(n, { kind: 'parity', s: 5, b: 0 })) {
      const probs = inputProbabilities(step.state, n)
      const amps = registerAmplitudes(step.state, n)
      for (let x = 0; x < 1 << n; x++) expect(amps[x] * amps[x]).toBeCloseTo(probs[x], 12)
    }
  })

  it('bitString prints MSB first, matching StateVector.label', () => {
    const sv = new StateVector(3)
    for (let x = 0; x < 8; x++) expect(bitString(x, 3)).toBe(sv.label(x))
  })

  it('every step carries a distinct id and a normalised state', () => {
    const steps = djSteps(3, { kind: 'constant', value: 0 })
    expect(steps.map((s) => s.id)).toEqual([
      'init',
      'ancilla',
      'superpose',
      'oracle',
      'interfere',
    ])
    for (const s of steps) {
      const total = s.state.probabilities().reduce((a, b) => a + b, 0)
      expect(total).toBeCloseTo(1, 12)
    }
  })
})
