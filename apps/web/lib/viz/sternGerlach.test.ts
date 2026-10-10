import { describe, expect, it } from 'vitest'
import {
  DEG,
  X_AXIS,
  Y_AXIS,
  Z_AXIS,
  addShot,
  angleBetween,
  axisVector,
  beamStateBefore,
  blochVector,
  chainPlusProbabilities,
  eigenstate,
  emptyCounts,
  incidentAngle,
  innerProduct,
  malus,
  measure,
  norm2,
  outcomeProbability,
  randomSpinState,
  runChain,
  type Analyser,
  type Vec3,
} from './sternGerlach'
import { mulberry32 } from '@/lib/quantum'

/**
 * Every expectation below is written against a result derived independently of
 * the implementation: the closed-form cos^2(D/2), the identity
 * <sigma_n> = cos D, orthogonality of the two ports, and — for the sampled
 * runs — the exact chain probabilities a first-year problem sheet gives for
 * the sequential Stern-Gerlach experiment.
 */

const axisAt = (thetaDeg: number) => ({ theta: thetaDeg * DEG, phi: 0 })

describe('cos^2(theta/2): the angle law', () => {
  // A z-up beam entering an analyser tilted by theta. Hand-computed values:
  //   0 deg   -> cos^2(0)   = 1
  //   60 deg  -> cos^2(30)  = 3/4
  //   90 deg  -> cos^2(45)  = 1/2
  //   180 deg -> cos^2(90)  = 0
  const zUp = eigenstate(Z_AXIS, 1)
  const cases: [number, number][] = [
    [0, 1],
    [60, 0.75],
    [90, 0.5],
    [180, 0],
  ]

  for (const [deg, expected] of cases) {
    it(`gives P(up) = ${expected} at ${deg} degrees`, () => {
      expect(outcomeProbability(zUp, axisAt(deg), 1)).toBeCloseTo(expected, 12)
      // and the down port takes exactly the rest
      expect(outcomeProbability(zUp, axisAt(deg), -1)).toBeCloseTo(1 - expected, 12)
    })
  }

  it('matches cos^2(theta/2) at every angle, not just the four checkpoints', () => {
    for (let deg = 0; deg <= 360; deg += 7) {
      const analytic = Math.cos((deg * DEG) / 2) ** 2
      expect(outcomeProbability(zUp, axisAt(deg), 1)).toBeCloseTo(analytic, 12)
    }
  })

  it('the two ports always account for the whole beam', () => {
    const state = eigenstate({ theta: 0.7, phi: 1.9 }, 1)
    for (let deg = 0; deg < 360; deg += 11) {
      const axis = { theta: deg * DEG, phi: 0.4 }
      const total = outcomeProbability(state, axis, 1) + outcomeProbability(state, axis, -1)
      expect(total).toBeCloseTo(1, 12)
    }
  })

  it('reproduces <sigma_n> = cos(D), an identity the code never mentions', () => {
    // P(+) - P(-) is the expectation value of the spin component, which for a
    // pure state aligned with m-hat measured along n-hat is m-hat . n-hat.
    const m = { theta: 1.1, phi: 0.3 }
    const state = eigenstate(m, 1)
    for (let deg = 0; deg <= 180; deg += 9) {
      const n = { theta: deg * DEG, phi: 2.2 }
      const expectation =
        outcomeProbability(state, n, 1) - outcomeProbability(state, n, -1)
      expect(expectation).toBeCloseTo(Math.cos(angleBetween(axisVector(m), axisVector(n))), 12)
    }
  })

  it('malus() is the same cos^2(D/2) the Born rule produces', () => {
    const zUpState = eigenstate(Z_AXIS, 1)
    for (let deg = 0; deg <= 180; deg += 13) {
      expect(malus(deg * DEG)).toBeCloseTo(outcomeProbability(zUpState, axisAt(deg), 1), 12)
    }
  })
})

describe('the spinor algebra is a legitimate quantum state space', () => {
  it('the two ports of an analyser are orthogonal, on every axis', () => {
    for (const axis of [Z_AXIS, X_AXIS, Y_AXIS, { theta: 0.83, phi: 2.7 }]) {
      const ip = innerProduct(eigenstate(axis, 1), eigenstate(axis, -1))
      expect(Math.hypot(ip.re, ip.im)).toBeCloseTo(0, 12)
      expect(norm2(eigenstate(axis, 1))).toBeCloseTo(1, 12)
      expect(norm2(eigenstate(axis, -1))).toBeCloseTo(1, 12)
    }
  })

  it('the + eigenstate of an axis points along that axis on the Bloch sphere', () => {
    for (const axis of [Z_AXIS, X_AXIS, Y_AXIS, { theta: 2.0, phi: 0.6 }]) {
      const v = blochVector(eigenstate(axis, 1))
      const want = axisVector(axis)
      for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo(want[i], 12)
      // ...and the - eigenstate points the opposite way.
      const w = blochVector(eigenstate(axis, -1))
      for (let i = 0; i < 3; i++) expect(w[i]).toBeCloseTo(-want[i], 12)
    }
  })

  it('a repeated measurement on the same axis is certain', () => {
    const first = measure(eigenstate({ theta: 1.3, phi: 0.2 }, 1), X_AXIS, 0.9)
    expect(outcomeProbability(first.state, X_AXIS, first.outcome)).toBeCloseTo(1, 12)
    expect(outcomeProbability(first.state, X_AXIS, (-first.outcome) as 1 | -1)).toBeCloseTo(0, 12)
    // whichever port it took, going back into the same analyser reproduces it
    for (const u of [0.01, 0.3, 0.5, 0.77, 0.99]) {
      const step = measure(eigenstate(Z_AXIS, 1), { theta: 0.9, phi: 0 }, u)
      expect(outcomeProbability(step.state, { theta: 0.9, phi: 0 }, step.outcome)).toBeCloseTo(1, 12)
    }
  })

  it('an unpolarised source reads 50/50 on any axis, as an ensemble average', () => {
    // Justifies the `null` source shortcut: average cos^2 over the Bloch sphere.
    const rand = mulberry32(20260905)
    const axis = { theta: 1.05, phi: 0.4 }
    let sum = 0
    const n = 40000
    for (let i = 0; i < n; i++) {
      sum += outcomeProbability(randomSpinState(rand(), rand()), axis, 1)
    }
    expect(sum / n).toBeCloseTo(0.5, 2)
  })
})

describe('sequential analysers: measuring x destroys what you knew about z', () => {
  const zThenX: Analyser[] = [
    { axis: Z_AXIS, port: 1 },
    { axis: X_AXIS, port: 1 },
  ]
  const zThenZ: Analyser[] = [
    { axis: Z_AXIS, port: 1 },
    { axis: Z_AXIS, port: 1 },
  ]
  const zThenXThenZ: Analyser[] = [
    { axis: Z_AXIS, port: 1 },
    { axis: X_AXIS, port: 1 },
    { axis: Z_AXIS, port: 1 },
  ]

  it('z then z: the second analyser confirms the first, 100% up', () => {
    const p = chainPlusProbabilities(null, zThenZ)
    expect(p[0]).toBeCloseTo(0.5, 12)
    expect(p[1]).toBeCloseTo(1, 12)
  })

  it('z then x: a z-up beam splits evenly on x', () => {
    const p = chainPlusProbabilities(null, zThenX)
    expect(p[1]).toBeCloseTo(0.5, 12)
  })

  it('z then x then z: the third analyser is 50/50, NOT 100% up', () => {
    const p = chainPlusProbabilities(null, zThenXThenZ)
    expect(p).toHaveLength(3)
    expect(p[0]).toBeCloseTo(0.5, 12)
    expect(p[1]).toBeCloseTo(0.5, 12)
    expect(p[2]).toBeCloseTo(0.5, 12)
  })

  it('blocking the other x port does not rescue the z information either', () => {
    const viaXDown: Analyser[] = [
      { axis: Z_AXIS, port: 1 },
      { axis: X_AXIS, port: -1 },
      { axis: Z_AXIS, port: 1 },
    ]
    expect(chainPlusProbabilities(null, viaXDown)[2]).toBeCloseTo(0.5, 12)
  })

  it('the damage is continuous in the middle angle: cos^2 of twice the tilt', () => {
    // Middle analyser at angle a from z, take its + port, then measure z again.
    // The surviving state points along a, so P(z-up) = cos^2(a/2). At a = 0 the
    // middle analyser is a z analyser and nothing is lost; at a = 90 it is x and
    // half is lost.
    for (const deg of [0, 30, 45, 60, 90]) {
      const chain: Analyser[] = [
        { axis: Z_AXIS, port: 1 },
        { axis: axisAt(deg), port: 1 },
        { axis: Z_AXIS, port: 1 },
      ]
      expect(chainPlusProbabilities(null, chain)[2]).toBeCloseTo(Math.cos((deg * DEG) / 2) ** 2, 12)
    }
  })

  it('reports the incident angle that drives the readout', () => {
    const chain: Analyser[] = [
      { axis: Z_AXIS, port: 1 },
      { axis: axisAt(60), port: 1 },
      { axis: axisAt(150), port: 1 },
    ]
    expect(incidentAngle(null, chain, 0)).toBeNull()
    expect(incidentAngle(null, chain, 1)).toBeCloseTo(60 * DEG, 12)
    // arriving spin points along 60 deg, third analyser sits at 150 deg
    expect(incidentAngle(null, chain, 2)).toBeCloseTo(90 * DEG, 12)
    // and taking the DOWN port of analyser 2 flips the incoming direction
    const viaDown: Analyser[] = [chain[0], { axis: axisAt(60), port: -1 }, chain[2]]
    expect(incidentAngle(null, viaDown, 2)).toBeCloseTo(90 * DEG, 12)
    expect(beamStateBefore(null, chain, 0)).toBeNull()
  })
})

describe('sampled runs land on the exact probabilities', () => {
  const chainOf = (chain: Analyser[], shots: number, seed: number) => {
    const rand = mulberry32(seed)
    let counts = emptyCounts(chain.length)
    for (let i = 0; i < shots; i++) counts = addShot(counts, runChain(rand, null, chain))
    return counts
  }

  it('z then x then z: half of the atoms reaching the last analyser come out down', () => {
    const chain: Analyser[] = [
      { axis: Z_AXIS, port: 1 },
      { axis: X_AXIS, port: 1 },
      { axis: Z_AXIS, port: 1 },
    ]
    const counts = chainOf(chain, 200000, 12345)
    expect(counts.emitted).toBe(200000)

    // Analyser 1 splits the unpolarised beam evenly.
    expect(counts.plus[0] / counts.emitted).toBeCloseTo(0.5, 2)

    // Only the z-up beam reaches analyser 2, and it splits evenly on x.
    const reached2 = counts.plus[1] + counts.minus[1]
    expect(reached2).toBe(counts.plus[0])
    expect(counts.plus[1] / reached2).toBeCloseTo(0.5, 2)

    // Only the x-up beam reaches analyser 3 — and it is 50/50 on z again,
    // even though every atom in it was measured z-up two analysers ago.
    const reached3 = counts.plus[2] + counts.minus[2]
    expect(reached3).toBe(counts.plus[1])
    expect(counts.plus[2] / reached3).toBeCloseTo(0.5, 2)
    expect(counts.minus[2] / reached3).toBeCloseTo(0.5, 2)

    // Overall yield through the whole apparatus: 1/2 * 1/2 * 1/2.
    expect(counts.plus[2] / counts.emitted).toBeCloseTo(0.125, 2)
  })

  it('z then z: not one atom in a hundred thousand comes out down', () => {
    const counts = chainOf(
      [
        { axis: Z_AXIS, port: 1 },
        { axis: Z_AXIS, port: 1 },
      ],
      100000,
      999
    )
    const reached = counts.plus[1] + counts.minus[1]
    expect(reached).toBe(counts.plus[0])
    expect(counts.minus[1]).toBe(0)
    expect(counts.plus[1]).toBe(reached)
  })

  it('a 60-degree analyser passes three quarters of what reaches it', () => {
    const counts = chainOf(
      [
        { axis: Z_AXIS, port: 1 },
        { axis: axisAt(60), port: 1 },
      ],
      200000,
      2024
    )
    const reached = counts.plus[1] + counts.minus[1]
    expect(counts.plus[1] / reached).toBeCloseTo(0.75, 2)
  })

  it('records where each blocked atom was stopped', () => {
    const chain: Analyser[] = [
      { axis: Z_AXIS, port: 1 },
      { axis: X_AXIS, port: 1 },
      { axis: Z_AXIS, port: 1 },
    ]
    const rand = mulberry32(7)
    let blocked0 = 0
    let blocked1 = 0
    let through = 0
    for (let i = 0; i < 40000; i++) {
      const shot = runChain(rand, null, chain)
      if (shot.blockedAt === 0) {
        blocked0 += 1
        expect(shot.outcomes).toHaveLength(1)
      } else if (shot.blockedAt === 1) {
        blocked1 += 1
        expect(shot.outcomes).toHaveLength(2)
      } else {
        through += 1
        expect(shot.blockedAt).toBe(-1)
        expect(shot.outcomes).toHaveLength(3)
      }
    }
    expect(blocked0 + blocked1 + through).toBe(40000)
    expect(blocked0 / 40000).toBeCloseTo(0.5, 2)
    expect(blocked1 / 40000).toBeCloseTo(0.25, 2)
    expect(through / 40000).toBeCloseTo(0.25, 2)
  })

  it('a prepared source needs no first analyser to be definite', () => {
    const rand = mulberry32(31337)
    const chain: Analyser[] = [{ axis: X_AXIS, port: 1 }]
    let up = 0
    for (let i = 0; i < 50000; i++) {
      if (runChain(rand, eigenstate(X_AXIS, 1), chain).outcomes[0] === 1) up += 1
    }
    expect(up).toBe(50000)
  })
})

describe('angleBetween', () => {
  it('is symmetric, zero on itself and pi on the antipode', () => {
    const u: Vec3 = [0.6, 0, 0.8]
    const v: Vec3 = [0, 1, 0]
    expect(angleBetween(u, u)).toBeCloseTo(0, 12)
    expect(angleBetween(u, [-0.6, 0, -0.8])).toBeCloseTo(Math.PI, 12)
    expect(angleBetween(u, v)).toBeCloseTo(angleBetween(v, u), 12)
    expect(angleBetween(u, v)).toBeCloseTo(Math.PI / 2, 12)
    expect(angleBetween([0, 0, 0], v)).toBe(0)
  })
})
