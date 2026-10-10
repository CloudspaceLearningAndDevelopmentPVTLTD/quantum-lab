import { describe, expect, it } from 'vitest'
import {
  angle,
  appendTrails,
  convexHull,
  fitRadius,
  greatCircleArc,
  matchStars,
  projectOrtho,
  type Vec3,
} from './majoranaGeometry'

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol

describe('matchStars', () => {
  it('undoes a permutation of the same points', () => {
    const prev = [v(1, 0, 0), v(0, 1, 0), v(0, 0, 1), v(-1, 0, 0)]
    const next = [prev[2], prev[0], prev[3], prev[1]]
    expect(matchStars(prev, next)).toEqual(prev)
  })

  it('follows small motions rather than jumping to a farther star', () => {
    const prev = [v(1, 0, 0), v(0, 1, 0)]
    const moved = [v(Math.cos(0.1), Math.sin(0.1), 0), v(-Math.sin(0.1), Math.cos(0.1), 0)]
    const out = matchStars(prev, [moved[1], moved[0]])
    expect(angle(out[0], prev[0])).toBeLessThan(0.11)
    expect(angle(out[1], prev[1])).toBeLessThan(0.11)
  })

  it('returns next unchanged when the counts differ', () => {
    const next = [v(1, 0, 0), v(0, 1, 0), v(0, 0, 1)]
    expect(matchStars([v(1, 0, 0)], next)).toEqual(next)
  })

  it('handles more than six stars through the greedy path', () => {
    const prev = Array.from({ length: 8 }, (_, i) => v(Math.cos(i), Math.sin(i), 0))
    const next = prev.slice().reverse()
    expect(matchStars(prev, next)).toEqual(prev)
  })
})

describe('appendTrails', () => {
  it('starts one trail per star, appends only when a star moves, and caps the length', () => {
    let trails = appendTrails([], [v(1, 0, 0), v(0, 0, 1)], 4)
    expect(trails).toHaveLength(2)
    expect(trails[0]).toHaveLength(1)
    // Same positions: nothing appended.
    trails = appendTrails(trails, [v(1, 0, 0), v(0, 0, 1)], 4)
    expect(trails[0]).toHaveLength(1)
    for (let i = 1; i <= 6; i++) {
      trails = appendTrails(trails, [v(Math.cos(i * 0.2), Math.sin(i * 0.2), 0), v(0, 0, 1)], 4)
    }
    expect(trails[0]).toHaveLength(4)
    expect(trails[1]).toHaveLength(1)
    // The newest point is last.
    expect(near(trails[0][3].x, Math.cos(1.2))).toBe(true)
  })

  it('resets when the star count changes', () => {
    const trails = appendTrails([[v(1, 0, 0), v(0, 1, 0)]], [v(0, 0, 1), v(0, 0, -1)])
    expect(trails).toHaveLength(2)
    expect(trails[0]).toHaveLength(1)
  })
})

describe('greatCircleArc', () => {
  it('stays on the sphere and hits both endpoints', () => {
    const a = v(1, 0, 0)
    const b = v(0, 0, 1)
    const arc = greatCircleArc(a, b, 8)
    expect(arc).toHaveLength(9)
    for (const p of arc) expect(near(Math.hypot(p.x, p.y, p.z), 1)).toBe(true)
    expect(near(arc[0].x, 1)).toBe(true)
    expect(near(arc[8].z, 1)).toBe(true)
    // Midpoint of a quarter arc is at 45°.
    expect(near(arc[4].x, Math.SQRT1_2)).toBe(true)
    expect(near(arc[4].z, Math.SQRT1_2)).toBe(true)
  })

  it('does not produce NaN for coincident or antipodal endpoints', () => {
    for (const [a, b] of [
      [v(0, 0, 1), v(0, 0, 1)],
      [v(0, 0, 1), v(0, 0, -1)],
    ]) {
      for (const p of greatCircleArc(a, b, 4)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true)
        expect(near(Math.hypot(p.x, p.y, p.z), 1)).toBe(true)
      }
    }
  })
})

describe('convexHull', () => {
  it('finds the four faces of a tetrahedron, each facing outward', () => {
    const pts = [v(1, 1, 1), v(1, -1, -1), v(-1, 1, -1), v(-1, -1, 1)].map((p) => ({
      x: p.x / Math.sqrt(3),
      y: p.y / Math.sqrt(3),
      z: p.z / Math.sqrt(3),
    }))
    const hull = convexHull(pts)
    expect(hull.vertices).toHaveLength(4)
    expect(hull.faces).toHaveLength(4)
    expect(hull.edges).toHaveLength(6)
    for (const [a, b, c] of hull.faces) {
      const pa = pts[a]
      const ab = v(pts[b].x - pa.x, pts[b].y - pa.y, pts[b].z - pa.z)
      const ac = v(pts[c].x - pa.x, pts[c].y - pa.y, pts[c].z - pa.z)
      const n = v(ab.y * ac.z - ab.z * ac.y, ab.z * ac.x - ab.x * ac.z, ab.x * ac.y - ab.y * ac.x)
      // Outward: the normal points the same way as the face's own position (centroid at origin).
      expect(n.x * pa.x + n.y * pa.y + n.z * pa.z).toBeGreaterThan(0)
    }
  })

  it('finds the eight faces and twelve edges of an octahedron', () => {
    const pts = [v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1), v(0, 0, -1)]
    const hull = convexHull(pts)
    expect(hull.faces).toHaveLength(8)
    expect(hull.edges).toHaveLength(12)
  })

  it('merges coincident points: a coherent state has no hull', () => {
    const pts = Array.from({ length: 6 }, () => v(0.6, 0, 0.8))
    const hull = convexHull(pts)
    expect(hull.vertices).toHaveLength(1)
    expect(hull.faces).toHaveLength(0)
    expect(hull.edges).toHaveLength(0)
  })

  it('gives |j, m⟩ (two clusters at the poles) a single edge, and three stars a triangle', () => {
    const jm = convexHull([v(0, 0, 1), v(0, 0, 1), v(0, 0, -1)])
    expect(jm.edges).toEqual([[0, 2]])
    expect(jm.faces).toHaveLength(0)
    const tri = convexHull([v(1, 0, 0), v(-0.5, Math.sqrt(3) / 2, 0), v(-0.5, -Math.sqrt(3) / 2, 0)])
    expect(tri.faces).toHaveLength(1)
    expect(tri.edges).toHaveLength(3)
  })

  it('ignores non-finite points instead of throwing', () => {
    const hull = convexHull([v(NaN, 0, 0), v(0, 0, 1), v(0, 0, -1)])
    expect(hull.vertices).toEqual([1, 2])
  })
})

describe('projectOrtho', () => {
  it('puts +z at the top of the screen and +x to the right at yaw 0, pitch 0', () => {
    const top = projectOrtho(v(0, 0, 1), 0, 0, 100, 100, 50)
    expect(near(top.sx, 100) && near(top.sy, 50)).toBe(true)
    const right = projectOrtho(v(1, 0, 0), 0, 0, 100, 100, 50)
    expect(near(right.sx, 150) && near(right.sy, 100)).toBe(true)
    // +y points into the screen at this view: it is behind.
    expect(projectOrtho(v(0, 1, 0), 0, 0, 100, 100, 50).depth).toBeLessThan(0)
  })

  it('moves +y to the right after a quarter turn of yaw (camera now on +x)', () => {
    const p = projectOrtho(v(0, 1, 0), Math.PI / 2, 0, 0, 0, 1)
    expect(near(p.sx, 1)).toBe(true)
    expect(near(p.depth, 0)).toBe(true)
    // And +x, where the camera now is, faces the viewer.
    expect(projectOrtho(v(1, 0, 0), Math.PI / 2, 0, 0, 0, 1).depth).toBeGreaterThan(0.99)
  })

  it('leans the north pole toward the viewer when the camera is raised', () => {
    const north = projectOrtho(v(0, 0, 1), 0.4, 0.5, 0, 0, 1)
    expect(north.depth).toBeGreaterThan(0)
    expect(near(north.sy, -Math.cos(0.5))).toBe(true)
    // Straight above: the pole is dead centre and fully in front.
    const top = projectOrtho(v(0, 0, 1), 0, Math.PI / 2, 0, 0, 1)
    expect(near(top.sx, 0) && near(top.sy, 0) && near(top.depth, 1)).toBe(true)
  })

  it('never throws or returns NaN at zero radius', () => {
    const p = projectOrtho(v(1, 0, 0), 0.3, 0.2, 10, 10, 0)
    expect(p).toEqual({ sx: 10, sy: 10, depth: 0 })
  })
})

describe('fitRadius', () => {
  it('is zero for a zero-area box and positive otherwise', () => {
    expect(fitRadius(0, 400)).toBe(0)
    expect(fitRadius(400, 0)).toBe(0)
    expect(fitRadius(NaN, 400)).toBe(0)
    expect(fitRadius(400, 300)).toBeGreaterThan(0)
    expect(fitRadius(400, 300)).toBeLessThan(150)
  })
})
