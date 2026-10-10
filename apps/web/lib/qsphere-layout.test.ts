import { describe, it, expect } from 'vitest'
import { simulate, type Circuit } from './quantum'
import {
  QSPHERE_EPS,
  hammingWeight,
  phaseColor,
  qsphereNodes,
  rotateProject,
} from './qsphere-layout'

const binomial = (n: number, k: number): number => {
  let out = 1
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1)
  return Math.round(out)
}

const bell: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
  ],
}

describe('qsphereNodes ring structure', () => {
  it('node counts per Hamming-weight ring follow the binomial coefficients (n = 1..5)', () => {
    for (let n = 1; n <= 5; n++) {
      const nodes = qsphereNodes(simulate({ numQubits: n, ops: [] }))
      expect(nodes).toHaveLength(1 << n)
      const perRing = new Array<number>(n + 1).fill(0)
      for (const node of nodes) perRing[node.weight]++
      for (let w = 0; w <= n; w++) expect(perRing[w]).toBe(binomial(n, w))
    }
  })

  it('|0...0⟩ sits at the north pole and |1...1⟩ at the south pole', () => {
    const nodes = qsphereNodes(simulate({ numQubits: 3, ops: [] }))
    const north = nodes.find((node) => node.index === 0)!
    const south = nodes.find((node) => node.index === 7)!
    expect(north.z).toBeCloseTo(1, 12)
    expect(south.z).toBeCloseTo(-1, 12)
    // Poles are single points; their x/y must not wander off-axis.
    expect(Math.hypot(north.x, north.y)).toBeCloseTo(0, 12)
    expect(Math.hypot(south.x, south.y)).toBeCloseTo(0, 12)
  })

  it('every node lies on the unit sphere', () => {
    for (const node of qsphereNodes(simulate({ numQubits: 4, ops: [] }))) {
      expect(Math.hypot(node.x, node.y, node.z)).toBeCloseTo(1, 12)
    }
  })
})

describe('qsphereNodes amplitudes', () => {
  it('Bell state highlights exactly |00⟩ and |11⟩, with equal radius and equal phase', () => {
    const nodes = qsphereNodes(simulate(bell))
    const lit = nodes.filter((node) => node.magnitude >= QSPHERE_EPS)
    expect(lit.map((node) => node.index).sort((a, b) => a - b)).toEqual([0, 3])
    const [a, b] = lit
    expect(a.magnitude).toBeCloseTo(b.magnitude, 12)
    expect(a.magnitude).toBeCloseTo(Math.SQRT1_2, 12)
    expect(a.phase).toBeCloseTo(b.phase, 12)
    // Equal phase ⇒ identical hue string — the picture the learner sees.
    expect(phaseColor(a.phase)).toBe(phaseColor(b.phase))
  })

  it('zero amplitudes rest at phase 0 by convention', () => {
    const nodes = qsphereNodes(simulate(bell))
    for (const node of nodes.filter((n) => n.magnitude < QSPHERE_EPS)) {
      expect(node.phase).toBe(0)
    }
  })
})

describe('rotateProject', () => {
  it('is orthographic: identity rotation maps the pole straight up', () => {
    const p = rotateProject({ x: 0, y: 0, z: 1 }, 0, 0)
    expect(p.sx).toBeCloseTo(0, 12)
    expect(p.sy).toBeCloseTo(-1, 12) // SVG y points down; north renders up
    expect(p.depth).toBeCloseTo(0, 12)
  })

  it('preserves radius (magnitude encoding stays honest under rotation)', () => {
    const point = { x: 0.36, y: -0.48, z: 0.8 }
    const p = rotateProject(point, 1.1, -0.4)
    expect(Math.hypot(p.sx, p.sy, p.depth)).toBeCloseTo(1, 12)
  })
})

describe('phaseColor', () => {
  it('is 2π-periodic and distinguishes opposite phases', () => {
    expect(phaseColor(Math.PI / 3)).toBe(phaseColor(Math.PI / 3 + 2 * Math.PI))
    expect(phaseColor(0)).not.toBe(phaseColor(Math.PI))
  })
})

describe('hammingWeight', () => {
  it('counts set bits', () => {
    expect(hammingWeight(0)).toBe(0)
    expect(hammingWeight(0b10110)).toBe(3)
    expect(hammingWeight(31)).toBe(5)
  })
})
