import { describe, expect, it } from 'vitest'
import { StateVector, mulberry32 } from '@/lib/quantum'
import {
  blochLengthFromPurity,
  blochState,
  blochVector,
  computationalProbabilities,
  densityFromBloch,
  densityFromState,
  dephase,
  fromMatrix,
  hermiticityDefect,
  isHermitian,
  maximallyMixed,
  mixture,
  pairState,
  partialTrace,
  pauliMeasurement,
  projectionProbability,
  purity,
  qubitEntropyBits,
  trace,
  type DensityMatrix,
} from './densityMatrix'

/**
 * Every expected value below is derived by hand from the definitions —
 * ρ = Σ pᵢ|ψᵢ⟩⟨ψᵢ|, Tr ρ² = Σ|ρᵢⱼ|², ρ = (I + r·σ)/2 — or is a textbook
 * result (a Bell pair's reduced state is I/2). None re-runs the module's own
 * output through itself to produce the expectation.
 */

const TOL = 1e-12

const rand = mulberry32(0xd3a5)

/** A random single-qubit pure state with a random Bloch direction. */
function randomQubit(): { theta: number; phi: number; state: StateVector } {
  const theta = Math.acos(1 - 2 * rand())
  const phi = rand() * 2 * Math.PI
  return { theta, phi, state: blochState(theta, phi) }
}

/** A random 2-qubit pure state built from gates, so it is normalised. */
function randomPair(): StateVector {
  const sv = new StateVector(2)
  sv.applySingle('RY', 0, rand() * Math.PI)
  sv.applySingle('RY', 1, rand() * Math.PI)
  sv.applySingle('P', 0, rand() * 2 * Math.PI)
  sv.applyControlled('X', [0], 1)
  sv.applySingle('RZ', 1, rand() * 2 * Math.PI)
  sv.applySingle('H', 1)
  return sv
}

/** A random single-qubit mixed state: a few random pure states with random weights. */
function randomMixedQubit(): DensityMatrix {
  const parts = Array.from({ length: 3 }, () => ({ weight: rand(), state: randomQubit().state }))
  return mixture(parts)
}

function expectMatrix(m: DensityMatrix, expected: number[][][], tol = 1e-12): void {
  expect(m.dim).toBe(expected.length)
  for (let i = 0; i < m.dim; i++) {
    for (let j = 0; j < m.dim; j++) {
      expect(m.rho[i][j].re, `re[${i}][${j}]`).toBeCloseTo(expected[i][j][0], 10)
      expect(m.rho[i][j].im, `im[${i}][${j}]`).toBeCloseTo(expected[i][j][1], 10)
      expect(Math.abs(m.rho[i][j].re - expected[i][j][0])).toBeLessThan(tol)
    }
  }
}

describe('trace and Hermiticity hold for every state this page can build', () => {
  const cases: [string, () => DensityMatrix][] = [
    ['random pure qubit', () => densityFromState(randomQubit().state)],
    ['random mixed qubit', randomMixedQubit],
    ['dephased random qubit', () => dephase(randomMixedQubit(), rand())],
    ['random 2-qubit pure state', () => densityFromState(randomPair())],
    ['partial trace of a random pair', () => partialTrace(densityFromState(randomPair()), [1])],
    ['maximally mixed on 3 qubits', () => maximallyMixed(3)],
    ['Bloch vector at random depth', () => {
      const { theta, phi } = randomQubit()
      const r = rand()
      return densityFromBloch([
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(theta),
      ])
    }],
  ]

  for (const [name, build] of cases) {
    it(`${name}: Tr ρ = 1 and ρ = ρ†`, () => {
      for (let k = 0; k < 20; k++) {
        const m = build()
        const t = trace(m)
        expect(t.re).toBeCloseTo(1, 12)
        expect(t.im).toBeCloseTo(0, 12)
        expect(hermiticityDefect(m)).toBeLessThan(TOL)
        expect(isHermitian(m)).toBe(true)
        // Diagonals are real probabilities.
        for (const p of computationalProbabilities(m)) {
          expect(p).toBeGreaterThanOrEqual(0)
          expect(p).toBeLessThanOrEqual(1)
        }
      }
    })
  }

  it('flags a matrix that is not Hermitian', () => {
    const bad = fromMatrix([
      [{ re: 0.5, im: 0 }, { re: 0.5, im: 0.1 }],
      [{ re: 0.5, im: 0.1 }, { re: 0.5, im: 0 }],
    ])
    expect(isHermitian(bad)).toBe(false)
    expect(hermiticityDefect(bad)).toBeCloseTo(0.2, 12)
  })
})

describe('purity', () => {
  it('is exactly 1 for a pure state, any direction', () => {
    for (let k = 0; k < 25; k++) {
      expect(purity(densityFromState(randomQubit().state))).toBeCloseTo(1, 12)
    }
    expect(purity(densityFromState(randomPair()))).toBeCloseTo(1, 12)
  })

  it('is 1/2 for the maximally mixed qubit, however it was prepared', () => {
    const z0 = new StateVector(1)
    const z1 = new StateVector(1).applySingle('X', 0)
    const zMix = mixture([
      { weight: 1, state: z0 },
      { weight: 1, state: z1 },
    ])
    expect(purity(zMix)).toBeCloseTo(0.5, 12)

    // The same ρ from a different decomposition: half |+⟩, half |−⟩.
    const plus = new StateVector(1).applySingle('H', 0)
    const minus = new StateVector(1).applySingle('X', 0).applySingle('H', 0)
    const xMix = mixture([
      { weight: 0.5, state: plus },
      { weight: 0.5, state: minus },
    ])
    expect(purity(xMix)).toBeCloseTo(0.5, 12)
    expectMatrix(xMix, [
      [[0.5, 0], [0, 0]],
      [[0, 0], [0.5, 0]],
    ])
    expectMatrix(zMix, [
      [[0.5, 0], [0, 0]],
      [[0, 0], [0.5, 0]],
    ])
    expect(purity(maximallyMixed(1))).toBeCloseTo(0.5, 12)
  })

  it('is 1/d for the maximally mixed state on d dimensions', () => {
    expect(purity(maximallyMixed(2))).toBeCloseTo(1 / 4, 12)
    expect(purity(maximallyMixed(3))).toBeCloseTo(1 / 8, 12)
  })

  it('of p|0⟩⟨0| + (1−p)|1⟩⟨1| is p² + (1−p)²', () => {
    const z0 = new StateVector(1)
    const z1 = new StateVector(1).applySingle('X', 0)
    for (const p of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
      const m = mixture([
        { weight: p, state: z0 },
        { weight: 1 - p, state: z1 },
      ])
      expect(purity(m)).toBeCloseTo(p * p + (1 - p) * (1 - p), 12)
    }
  })

  it('never exceeds 1 or drops below 1/d for a mixture', () => {
    for (let k = 0; k < 30; k++) {
      const p = purity(randomMixedQubit())
      expect(p).toBeLessThanOrEqual(1 + TOL)
      expect(p).toBeGreaterThanOrEqual(0.5 - TOL)
    }
  })
})

describe('Bloch vector', () => {
  it('of |ψ(θ, φ)⟩ is (sin θ cos φ, sin θ sin φ, cos θ)', () => {
    for (let k = 0; k < 25; k++) {
      const { theta, phi, state } = randomQubit()
      const [x, y, z] = blochVector(densityFromState(state))
      expect(x).toBeCloseTo(Math.sin(theta) * Math.cos(phi), 12)
      expect(y).toBeCloseTo(Math.sin(theta) * Math.sin(phi), 12)
      expect(z).toBeCloseTo(Math.cos(theta), 12)
    }
  })

  it('puts the six Pauli eigenstates on the six poles', () => {
    const z0 = new StateVector(1)
    const plus = new StateVector(1).applySingle('H', 0)
    const plusI = new StateVector(1).applySingle('H', 0).applySingle('S', 0)
    const minusI = new StateVector(1).applySingle('H', 0).applySingle('SDG', 0)
    const bz = blochVector(densityFromState(z0))
    expect(bz[0]).toBeCloseTo(0, 12)
    expect(bz[1]).toBeCloseTo(0, 12)
    expect(bz[2]).toBeCloseTo(1, 12)
    const bx = blochVector(densityFromState(plus))
    expect(bx[0]).toBeCloseTo(1, 12)
    expect(bx[1]).toBeCloseTo(0, 12)
    expect(bx[2]).toBeCloseTo(0, 12)
    const by = blochVector(densityFromState(plusI))
    expect(by[0]).toBeCloseTo(0, 12)
    expect(by[1]).toBeCloseTo(1, 12)
    const byMinus = blochVector(densityFromState(minusI))
    expect(byMinus[1]).toBeCloseTo(-1, 12)
  })

  it('length equals √(2·Tr ρ² − 1) for every mixed state', () => {
    for (let k = 0; k < 40; k++) {
      const m = randomMixedQubit()
      const len = Math.hypot(...blochVector(m))
      expect(len).toBeCloseTo(blochLengthFromPurity(purity(m)), 12)
      expect(len).toBeCloseTo(Math.sqrt(2 * purity(m) - 1), 12)
      expect(len).toBeLessThanOrEqual(1 + TOL)
    }
  })

  it('round-trips through densityFromBloch', () => {
    for (let k = 0; k < 20; k++) {
      const { theta, phi } = randomQubit()
      const r = rand()
      const v: [number, number, number] = [
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(theta),
      ]
      const back = blochVector(densityFromBloch(v))
      expect(back[0]).toBeCloseTo(v[0], 12)
      expect(back[1]).toBeCloseTo(v[1], 12)
      expect(back[2]).toBeCloseTo(v[2], 12)
      expect(purity(densityFromBloch(v))).toBeCloseTo((1 + r * r) / 2, 12)
    }
  })

  it('rejects a vector outside the sphere', () => {
    expect(() => densityFromBloch([1, 0.1, 0])).toThrow()
  })
})

describe('mixture versus superposition', () => {
  const plus = new StateVector(1).applySingle('H', 0)
  const superposition = densityFromState(plus)
  const coinFlip = mixture([
    { weight: 1, state: new StateVector(1) },
    { weight: 1, state: new StateVector(1).applySingle('X', 0) },
  ])

  it('agree in the z basis: 50/50 either way', () => {
    expect(pauliMeasurement(superposition, 'z').plus).toBeCloseTo(0.5, 12)
    expect(pauliMeasurement(coinFlip, 'z').plus).toBeCloseTo(0.5, 12)
  })

  it('differ in the x basis: certain versus coin flip', () => {
    expect(pauliMeasurement(superposition, 'x').plus).toBeCloseTo(1, 12)
    expect(pauliMeasurement(superposition, 'x').minus).toBeCloseTo(0, 12)
    expect(pauliMeasurement(coinFlip, 'x').plus).toBeCloseTo(0.5, 12)
    expect(pauliMeasurement(coinFlip, 'y').plus).toBeCloseTo(0.5, 12)
  })

  it('|ψ(π/2, φ)⟩ measured along x gives cos²(φ/2), along y gives sin²((φ − π/2)/2) complement', () => {
    for (const phi of [0, 0.3, Math.PI / 2, 1.9, Math.PI, 4.5]) {
      const m = densityFromState(blochState(Math.PI / 2, phi))
      // Bloch vector (cos φ, sin φ, 0): P(+x) = (1 + cos φ)/2, P(+y) = (1 + sin φ)/2.
      expect(pauliMeasurement(m, 'x').plus).toBeCloseTo((1 + Math.cos(phi)) / 2, 12)
      expect(pauliMeasurement(m, 'y').plus).toBeCloseTo((1 + Math.sin(phi)) / 2, 12)
      expect(pauliMeasurement(m, 'z').plus).toBeCloseTo(0.5, 12)
    }
  })

  it('probabilities in any basis sum to one', () => {
    for (let k = 0; k < 10; k++) {
      const m = randomMixedQubit()
      for (const b of ['x', 'y', 'z'] as const) {
        const { plus: p, minus: q } = pauliMeasurement(m, b)
        expect(p + q).toBeCloseTo(1, 12)
      }
    }
  })

  it('projectionProbability of a state onto itself is 1, onto its orthogonal partner 0', () => {
    const { theta, phi, state } = randomQubit()
    const m = densityFromState(state)
    const orth = blochState(Math.PI - theta, phi + Math.PI)
    expect(projectionProbability(m, state)).toBeCloseTo(1, 12)
    expect(projectionProbability(m, orth)).toBeCloseTo(0, 12)
  })
})

describe('dephasing', () => {
  it('leaves populations alone and scales coherences by 1 − λ', () => {
    const m = densityFromState(blochState(1.1, 0.7))
    const d = dephase(m, 0.4)
    expect(d.rho[0][0].re).toBeCloseTo(m.rho[0][0].re, 12)
    expect(d.rho[1][1].re).toBeCloseTo(m.rho[1][1].re, 12)
    expect(d.rho[0][1].re).toBeCloseTo(0.6 * m.rho[0][1].re, 12)
    expect(d.rho[0][1].im).toBeCloseTo(0.6 * m.rho[0][1].im, 12)
    const [x, y, z] = blochVector(d)
    const [x0, y0, z0] = blochVector(m)
    expect(x).toBeCloseTo(0.6 * x0, 12)
    expect(y).toBeCloseTo(0.6 * y0, 12)
    expect(z).toBeCloseTo(z0, 12)
  })

  it('takes |+⟩ all the way to I/2 at λ = 1, with entropy 1 bit', () => {
    const plus = densityFromState(new StateVector(1).applySingle('H', 0))
    const gone = dephase(plus, 1)
    expectMatrix(gone, [
      [[0.5, 0], [0, 0]],
      [[0, 0], [0.5, 0]],
    ])
    expect(purity(gone)).toBeCloseTo(0.5, 12)
    expect(qubitEntropyBits(gone)).toBeCloseTo(1, 12)
    expect(qubitEntropyBits(plus)).toBeCloseTo(0, 12)
  })

  it('purity of a dephased equatorial state is (1 + (1 − λ)²)/2', () => {
    const plus = densityFromState(new StateVector(1).applySingle('H', 0))
    for (const lam of [0, 0.25, 0.5, 0.9, 1]) {
      expect(purity(dephase(plus, lam))).toBeCloseTo((1 + (1 - lam) ** 2) / 2, 12)
    }
  })

  it('rejects a strength outside [0, 1]', () => {
    const m = maximallyMixed(1)
    expect(() => dephase(m, -0.1)).toThrow()
    expect(() => dephase(m, 1.5)).toThrow()
  })
})

describe('partial trace', () => {
  const HALF_I = [
    [[0.5, 0], [0, 0]],
    [[0, 0], [0.5, 0]],
  ]

  it('of Φ⁺ over either qubit is I/2', () => {
    const bell = densityFromState(pairState('phi-plus'))
    expect(purity(bell)).toBeCloseTo(1, 12)
    expectMatrix(partialTrace(bell, [0]), HALF_I)
    expectMatrix(partialTrace(bell, [1]), HALF_I)
    expect(purity(partialTrace(bell, [1]))).toBeCloseTo(0.5, 12)
    expect(qubitEntropyBits(partialTrace(bell, [1]))).toBeCloseTo(1, 12)
  })

  it('of Ψ⁻ over either qubit is I/2', () => {
    const singlet = densityFromState(pairState('psi-minus'))
    // Sanity: the state really is (|01⟩ − |10⟩)/√2 up to a global phase.
    const probs = computationalProbabilities(singlet)
    expect(probs[0]).toBeCloseTo(0, 12)
    expect(probs[1]).toBeCloseTo(0.5, 12)
    expect(probs[2]).toBeCloseTo(0.5, 12)
    expect(probs[3]).toBeCloseTo(0, 12)
    expect(singlet.rho[1][2].re).toBeCloseTo(-0.5, 12)
    expectMatrix(partialTrace(singlet, [0]), HALF_I)
    expectMatrix(partialTrace(singlet, [1]), HALF_I)
  })

  it('of a product state |+⟩⊗|0⟩ returns each factor, pure', () => {
    const prod = densityFromState(pairState('product'))
    // qubit 0 is |+⟩, qubit 1 is |0⟩.
    const q0 = partialTrace(prod, [1])
    const q1 = partialTrace(prod, [0])
    expectMatrix(q0, [
      [[0.5, 0], [0.5, 0]],
      [[0.5, 0], [0.5, 0]],
    ])
    expectMatrix(q1, [
      [[1, 0], [0, 0]],
      [[0, 0], [0, 0]],
    ])
    expect(purity(q0)).toBeCloseTo(1, 12)
    expect(purity(q1)).toBeCloseTo(1, 12)
  })

  it('of cos α|00⟩ + sin α|11⟩ has reduced purity cos⁴α + sin⁴α', () => {
    for (const alpha of [0, 0.2, 0.5, Math.PI / 4, 1.1, Math.PI / 2]) {
      const m = densityFromState(pairState('tunable', alpha))
      expect(purity(m)).toBeCloseTo(1, 12)
      const red = partialTrace(m, [1])
      const expected = Math.cos(alpha) ** 4 + Math.sin(alpha) ** 4
      expect(purity(red)).toBeCloseTo(expected, 12)
      // Reduced state is diagonal: (cos²α, sin²α), no coherence at all.
      expect(red.rho[0][0].re).toBeCloseTo(Math.cos(alpha) ** 2, 12)
      expect(red.rho[1][1].re).toBeCloseTo(Math.sin(alpha) ** 2, 12)
      expect(Math.hypot(red.rho[0][1].re, red.rho[0][1].im)).toBeLessThan(TOL)
      // Both halves have the same spectrum, hence the same purity.
      expect(purity(partialTrace(m, [0]))).toBeCloseTo(expected, 12)
    }
  })

  it('of a 3-qubit GHZ state over one qubit is the classical 00/11 mixture', () => {
    const ghz = new StateVector(3)
    ghz.applySingle('H', 0)
    ghz.applyControlled('X', [0], 1)
    ghz.applyControlled('X', [0], 2)
    const red = partialTrace(densityFromState(ghz), [2])
    expect(red.numQubits).toBe(2)
    const expected = Array.from({ length: 4 }, (_, i) =>
      Array.from({ length: 4 }, (_, j) => (i === j && (i === 0 || i === 3) ? [0.5, 0] : [0, 0]))
    )
    expectMatrix(red, expected)
    expect(purity(red)).toBeCloseTo(0.5, 12)
    // And tracing two qubits leaves I/2 on the survivor.
    expectMatrix(partialTrace(densityFromState(ghz), [0, 2]), HALF_I)
  })

  it('preserves the trace and Hermiticity for random pairs and never raises purity above 1', () => {
    for (let k = 0; k < 20; k++) {
      const full = densityFromState(randomPair())
      for (const q of [0, 1]) {
        const red = partialTrace(full, [q])
        expect(trace(red).re).toBeCloseTo(1, 12)
        expect(isHermitian(red)).toBe(true)
        expect(purity(red)).toBeLessThanOrEqual(1 + TOL)
        expect(purity(red)).toBeGreaterThanOrEqual(0.5 - TOL)
      }
      // Both reductions of a pure bipartite state share a spectrum, so their purities match.
      expect(purity(partialTrace(full, [0]))).toBeCloseTo(purity(partialTrace(full, [1])), 12)
    }
  })

  it('rejects tracing out every qubit or an out-of-range qubit', () => {
    const bell = densityFromState(pairState('phi-plus'))
    expect(() => partialTrace(bell, [0, 1])).toThrow()
    expect(() => partialTrace(bell, [2])).toThrow()
  })
})

describe('mixture input validation', () => {
  it('rejects negative weights, empty input and mismatched dimensions', () => {
    const q = new StateVector(1)
    expect(() => mixture([])).toThrow()
    expect(() => mixture([{ weight: -1, state: q }])).toThrow()
    expect(() => mixture([{ weight: 0, state: q }])).toThrow()
    expect(() =>
      mixture([
        { weight: 1, state: q },
        { weight: 1, state: new StateVector(2) },
      ])
    ).toThrow()
  })
})
