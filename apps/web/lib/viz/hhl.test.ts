import { describe, expect, it } from 'vitest'
import {
  CLOCK_DIM,
  C_CONST,
  MATRIX_A,
  TOTAL_QUBITS,
  VECTOR_B,
  ancillaProbabilities,
  classicalSolve,
  clockProbabilities,
  eigenSym2x2,
  eigenvalueForClockValue,
  extractSolution,
  hhlStages,
  normalize2,
  rotationAngle,
  solveSym2x2,
  stateProbabilities,
} from './hhl'

/**
 * The ground truth this page's central claim rests on: post-select on the
 * ancilla reading |1⟩, and the state register holds a vector proportional to
 * the classical solution of Ax = b — checked here against an independent
 * classical solve, not against this module's own eigendecomposition.
 */

describe('classical linear algebra sanity', () => {
  it('solveSym2x2 matches Cramer’s rule by hand for MATRIX_A, VECTOR_B', () => {
    const [x0, x1] = classicalSolve()
    // A·x should equal b exactly (up to floating point).
    expect(MATRIX_A.a * x0 + MATRIX_A.b * x1).toBeCloseTo(VECTOR_B[0], 12)
    expect(MATRIX_A.b * x0 + MATRIX_A.d * x1).toBeCloseTo(VECTOR_B[1], 12)
  })

  it('eigenSym2x2 finds eigenvalues 1 and 2 for MATRIX_A', () => {
    const [e1, e2] = eigenSym2x2(MATRIX_A)
    expect([e1.value, e2.value].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('eigenvectors are orthonormal and diagonalize A', () => {
    const [e1, e2] = eigenSym2x2(MATRIX_A)
    const dot = e1.vector[0] * e2.vector[0] + e1.vector[1] * e2.vector[1]
    expect(dot).toBeCloseTo(0, 12)
    for (const { value, vector } of [e1, e2]) {
      const av0 = MATRIX_A.a * vector[0] + MATRIX_A.b * vector[1]
      const av1 = MATRIX_A.b * vector[0] + MATRIX_A.d * vector[1]
      expect(av0).toBeCloseTo(value * vector[0], 12)
      expect(av1).toBeCloseTo(value * vector[1], 12)
    }
  })

  it('rejects a singular matrix rather than dividing by zero', () => {
    expect(() => solveSym2x2({ a: 1, b: 1, d: 1 }, [1, 0])).toThrow(/singular/)
  })
})

describe('the eigenvalue ↔ clock-reading map', () => {
  it('maps clock reading y to eigenvalue y exactly, for this EVOLUTION_TIME', () => {
    for (let y = 0; y < CLOCK_DIM; y++) expect(eigenvalueForClockValue(y)).toBeCloseTo(y, 12)
  })

  it('both eigenvalues of MATRIX_A land on integer clock readings', () => {
    const [e1, e2] = eigenSym2x2(MATRIX_A)
    for (const { value } of [e1, e2]) {
      const y = Math.round(value)
      expect(eigenvalueForClockValue(y)).toBeCloseTo(value, 12)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(CLOCK_DIM)
    }
  })
})

describe('rotationAngle', () => {
  it('gives sin(θ/2) = C/λ exactly', () => {
    for (const lambda of [0.5, 1, 1.3, 2, 5]) {
      const theta = rotationAngle(lambda, C_CONST)
      if (Math.abs(C_CONST / lambda) <= 1) {
        expect(Math.sin(theta / 2)).toBeCloseTo(C_CONST / lambda, 12)
      } else {
        expect(theta).toBe(0)
      }
    }
  })

  it('is 0 at λ = 0 rather than throwing or returning NaN', () => {
    expect(rotationAngle(0)).toBe(0)
  })

  it('hits the two angles this demo relies on: π at λ=1, π/3 at λ=2', () => {
    expect(rotationAngle(1)).toBeCloseTo(Math.PI, 10)
    expect(rotationAngle(2)).toBeCloseTo(Math.PI / 3, 10)
  })
})

describe('hhlStages builds a real circuit on a real statevector', () => {
  const stages = hhlStages()

  it('produces one stage per gate layer with unit-norm states throughout', () => {
    expect(stages.length).toBeGreaterThan(5)
    for (const stage of stages) {
      expect(stage.state.numQubits).toBe(TOTAL_QUBITS)
      let norm = 0
      for (let i = 0; i < stage.state.dim; i++) norm += stage.state.probability(i)
      expect(norm).toBeCloseTo(1, 9)
    }
  })

  it('clock register is a clean, sharp two-peak distribution after the inverse QFT', () => {
    const iqftStage = stages.find((s) => s.id === 'iqft')!
    const probs = clockProbabilities(iqftStage.state)
    // Exact phases ⇒ exact interference: only y=1 (λ=1) and y=2 (λ=2) survive.
    expect(probs[0]).toBeCloseTo(0, 9)
    expect(probs[3]).toBeCloseTo(0, 9)
    expect(probs[1] + probs[2]).toBeCloseTo(1, 9)
    // |b⟩ splits evenly across both eigenvectors of A (see module header), so
    // both clock readings are equally likely.
    expect(probs[1]).toBeCloseTo(0.5, 9)
    expect(probs[2]).toBeCloseTo(0.5, 9)
  })

  it('rotation stage does not touch the clock register', () => {
    const iqft = clockProbabilities(stages.find((s) => s.id === 'iqft')!.state)
    const rotation = clockProbabilities(stages.find((s) => s.id === 'rotation')!.state)
    for (let y = 0; y < CLOCK_DIM; y++) expect(rotation[y]).toBeCloseTo(iqft[y], 9)
  })

  it('uncompute returns the clock register exactly to |0…0⟩', () => {
    const last = stages.find((s) => s.id === 'uncompute-hadamard')!
    const probs = clockProbabilities(last.state)
    expect(probs[0]).toBeCloseTo(1, 9)
    for (let y = 1; y < CLOCK_DIM; y++) expect(probs[y]).toBeCloseTo(0, 9)
  })

  it('the ancilla success probability matches the closed-form Σ (b_j·sin(θ_j/2))²', () => {
    const final = stages[stages.length - 1].state
    const [, pSuccess] = ancillaProbabilities(final)
    // b = |0⟩ splits as (|+⟩+|−⟩)/√2 with coefficients 1/√2 each; |+⟩ has
    // λ=2 (θ=π/3), |−⟩ has λ=1 (θ=π). Independent of this module's own code.
    const expected = 0.5 * Math.sin(Math.PI / 3 / 2) ** 2 + 0.5 * Math.sin(Math.PI / 2) ** 2
    expect(pSuccess).toBeCloseTo(expected, 9)
    expect(pSuccess).toBeCloseTo(0.625, 9)
  })
})

describe('extractSolution — the honest payoff', () => {
  const stages = hhlStages()
  const final = stages[stages.length - 1].state
  const solution = extractSolution(final)
  const classical = normalize2(classicalSolve())

  it('has essentially zero residual leakage to a nonzero clock reading', () => {
    expect(solution.residualClockLeakage).toBeLessThan(1e-9)
  })

  it('matches the closed-form success probability', () => {
    expect(solution.successProbability).toBeCloseTo(0.625, 9)
  })

  it('the post-selected state register is proportional to the classical solve of Ax=b', () => {
    // HHL's state can differ from the "canonical" classical vector by an
    // overall sign (a global phase, and everything here is real) — align on
    // sign before comparing componentwise.
    const sign = Math.sign(solution.amplitudes[0]) === Math.sign(classical[0]) ? 1 : -1
    expect(solution.amplitudes[0]).toBeCloseTo(sign * classical[0], 9)
    expect(solution.amplitudes[1]).toBeCloseTo(sign * classical[1], 9)
  })

  it('matches the specific numbers this problem produces: x ∝ (0.75, −0.25)', () => {
    const expected = normalize2([0.75, -0.25])
    const sign = Math.sign(solution.amplitudes[0]) === Math.sign(expected[0]) ? 1 : -1
    expect(sign * solution.amplitudes[0]).toBeCloseTo(expected[0], 9)
    expect(sign * solution.amplitudes[1]).toBeCloseTo(expected[1], 9)
  })
})

describe('stateProbabilities and ancillaProbabilities stay well-formed at every stage', () => {
  const stages = hhlStages()
  it('are valid probability pairs throughout the whole run', () => {
    for (const stage of stages) {
      const [s0, s1] = stateProbabilities(stage.state)
      const [a0, a1] = ancillaProbabilities(stage.state)
      expect(s0 + s1).toBeCloseTo(1, 9)
      expect(a0 + a1).toBeCloseTo(1, 9)
      expect(s0).toBeGreaterThanOrEqual(-1e-9)
      expect(a0).toBeGreaterThanOrEqual(-1e-9)
    }
  })

  it('the ancilla is exactly |0⟩ until the rotation stage runs', () => {
    for (const stage of stages) {
      if (stage.id === 'prepare' || stage.id === 'hadamard' || stage.id === 'kickback' || stage.id === 'iqft') {
        const [a0] = ancillaProbabilities(stage.state)
        expect(a0).toBeCloseTo(1, 9)
      }
    }
  })
})
