/**
 * lib/viz/majoranaGeometry.ts — pure geometry behind components/viz/MajoranaSphere.tsx.
 *
 * Nothing here touches three.js or the DOM, so it is testable in node and shared
 * by the WebGL scene and the 2-D canvas fallback: the same hull, the same trails,
 * the same projection. All points are unit vectors in Bloch coordinates
 * (+z = |0⟩), matching lib/quantum/majorana.ts.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z)

/** Great-circle angle between two unit vectors. */
export function angle(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))))
}

// ── Star identity across frames ──

/**
 * Reorder `next` so that next[i] is the star that "continues" prev[i]: the
 * assignment with the least total angular travel. Root finders return roots in
 * no stable order, so without this a trail would jump between stars whenever
 * two of them swap places in the output.
 *
 * Exhaustive over permutations for n ≤ 6 (720 cases, trivial per frame);
 * greedy nearest-neighbour beyond that. Lengths must match; otherwise `next`
 * is returned unchanged.
 */
export function matchStars<T extends Vec3>(prev: readonly Vec3[], next: readonly T[]): T[] {
  const n = next.length
  if (prev.length !== n || n === 0) return next.slice()
  const cost: number[][] = prev.map((p) => next.map((q) => angle(p, q)))

  if (n <= 6) {
    let best = Infinity
    let bestPerm: number[] = []
    const perm: number[] = []
    const used = new Array<boolean>(n).fill(false)
    const rec = (i: number, acc: number) => {
      if (acc >= best) return
      if (i === n) {
        best = acc
        bestPerm = perm.slice()
        return
      }
      for (let k = 0; k < n; k++) {
        if (used[k]) continue
        used[k] = true
        perm.push(k)
        rec(i + 1, acc + cost[i][k])
        perm.pop()
        used[k] = false
      }
    }
    rec(0, 0)
    return bestPerm.map((k) => next[k])
  }

  const taken = new Array<boolean>(n).fill(false)
  const out: T[] = []
  for (let i = 0; i < n; i++) {
    let bestK = -1
    let bestC = Infinity
    for (let k = 0; k < n; k++) {
      if (!taken[k] && cost[i][k] < bestC) {
        bestC = cost[i][k]
        bestK = k
      }
    }
    taken[bestK] = true
    out.push(next[bestK])
  }
  return out
}

// ── Trails ──

export type Trail = Vec3[]

/**
 * Append the current star positions to their trails. A star that has not moved
 * (by less than `minStep` radians) adds nothing, so a static picture never grows
 * a trail. Trails are capped at `maxLength` points, oldest dropped. If the star
 * count changed (a different j was chosen) the trails are reset.
 */
export function appendTrails(
  trails: readonly Trail[],
  stars: readonly Vec3[],
  maxLength = 90,
  minStep = 2e-3
): Trail[] {
  if (trails.length !== stars.length) return stars.map((s) => [{ x: s.x, y: s.y, z: s.z }])
  return trails.map((trail, i) => {
    const s = { x: stars[i].x, y: stars[i].y, z: stars[i].z }
    const last = trail[trail.length - 1]
    if (last && angle(last, s) < minStep) return trail
    const next = trail.length >= maxLength ? trail.slice(trail.length - maxLength + 1) : trail.slice()
    next.push(s)
    return next
  })
}

/**
 * Points along the shorter great-circle arc from a to b (slerp), for drawing a
 * trail segment ON the sphere rather than as a chord through it. Returns
 * `segments + 1` points including both ends. Antipodal endpoints have no unique
 * arc; the chord midpoint is used, normalised, which is the least-wrong choice.
 */
export function greatCircleArc(a: Vec3, b: Vec3, segments = 6): Vec3[] {
  const omega = angle(a, b)
  const out: Vec3[] = []
  if (omega < 1e-9) {
    for (let i = 0; i <= segments; i++) out.push({ ...a })
    return out
  }
  const s = Math.sin(omega)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    let p: Vec3
    if (s < 1e-9) {
      // Antipodal: walk through any perpendicular direction.
      const perp = perpendicular(a)
      const th = t * Math.PI
      p = {
        x: a.x * Math.cos(th) + perp.x * Math.sin(th),
        y: a.y * Math.cos(th) + perp.y * Math.sin(th),
        z: a.z * Math.cos(th) + perp.z * Math.sin(th),
      }
    } else {
      const wa = Math.sin((1 - t) * omega) / s
      const wb = Math.sin(t * omega) / s
      p = { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb }
    }
    const l = len(p) || 1
    out.push({ x: p.x / l, y: p.y / l, z: p.z / l })
  }
  return out
}

function perpendicular(a: Vec3): Vec3 {
  const trial = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const p = cross(a, trial)
  const l = len(p) || 1
  return { x: p.x / l, y: p.y / l, z: p.z / l }
}

// ── Convex hull ──

export interface Hull {
  /** Indices (into the input) of the points that survived de-duplication. */
  vertices: number[]
  /** Triangles, as input indices, wound so the normal points away from the centroid. */
  faces: [number, number, number][]
  /** Unique undirected edges of the faces, or the single segment when only two points remain. */
  edges: [number, number][]
}

/**
 * Convex hull of a handful of points, by brute force: a triple is a face when
 * every other point lies on (or behind) its plane. O(n⁴), and n ≤ 8 here, so it
 * costs nothing — and it is obviously correct, which the incremental algorithms
 * are not once degeneracies show up. Coincident points (a coherent state's 2j
 * stars, or a |j, m⟩ state's pole clusters) are merged first; coplanar sets give
 * their flat polygon as overlapping triangles, which is fine for a faint fill.
 * Two distinct points give one edge and no face; one point gives nothing.
 */
export function convexHull(points: readonly Vec3[], mergeTol = 1e-6): Hull {
  const vertices: number[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue
    if (vertices.some((v) => len(sub(points[v], p)) < mergeTol)) continue
    vertices.push(i)
  }
  const faces: [number, number, number][] = []
  const edgeSet = new Set<string>()
  const edges: [number, number][] = []
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    edges.push(a < b ? [a, b] : [b, a])
  }

  if (vertices.length === 2) {
    addEdge(vertices[0], vertices[1])
    return { vertices, faces, edges }
  }
  if (vertices.length < 3) return { vertices, faces, edges }

  const centroid: Vec3 = { x: 0, y: 0, z: 0 }
  for (const v of vertices) {
    centroid.x += points[v].x / vertices.length
    centroid.y += points[v].y / vertices.length
    centroid.z += points[v].z / vertices.length
  }

  const n = vertices.length
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        const pa = points[vertices[a]]
        const pb = points[vertices[b]]
        const pc = points[vertices[c]]
        let normal = cross(sub(pb, pa), sub(pc, pa))
        const nl = len(normal)
        if (nl < 1e-9) continue // collinear
        normal = { x: normal.x / nl, y: normal.y / nl, z: normal.z / nl }
        let pos = false
        let neg = false
        for (let d = 0; d < n; d++) {
          if (d === a || d === b || d === c) continue
          const s = dot(normal, sub(points[vertices[d]], pa))
          if (s > 1e-9) pos = true
          else if (s < -1e-9) neg = true
          if (pos && neg) break
        }
        if (pos && neg) continue
        // Orient outward: away from the centroid. For a flat (coplanar) set the
        // centroid is on the plane; either winding is acceptable then.
        const toCentroid = dot(normal, sub(centroid, pa))
        const face: [number, number, number] =
          toCentroid > 0 ? [vertices[a], vertices[c], vertices[b]] : [vertices[a], vertices[b], vertices[c]]
        faces.push(face)
        addEdge(face[0], face[1])
        addEdge(face[1], face[2])
        addEdge(face[2], face[0])
      }
    }
  }
  return { vertices, faces, edges }
}

// ── Orthographic projection for the 2-D fallback ──

export interface Projected {
  /** Screen x, y in pixels (y down), and depth toward the viewer (positive = front). */
  sx: number
  sy: number
  depth: number
}

/**
 * Orthographic camera looking at the origin with +z (|0⟩) drawn upward on
 * screen. At yaw 0, pitch 0 the camera sits on −y, so +x is to the right and +y
 * is behind. `yaw` turns the camera counter-clockwise (seen from +z) about the
 * polar axis — at yaw π/2 it sits on +x — and a positive `pitch` raises it
 * above the equator so the north pole leans toward the viewer.
 *
 * `radius` is the sphere's on-screen radius in pixels; a non-positive radius
 * yields the centre point for everything, so a 0-width canvas draws nothing
 * rather than throwing (the guard the wave-1 arcTo crash taught).
 */
export function projectOrtho(p: Vec3, yaw: number, pitch: number, cx: number, cy: number, radius: number): Projected {
  if (!(radius > 0)) return { sx: cx, sy: cy, depth: 0 }
  // Rotate the world about z by −yaw so the camera is back on −y …
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const x1 = p.x * cosY + p.y * sinY
  const y1 = -p.x * sinY + p.y * cosY
  const z1 = p.z
  // … then the camera direction is (0, −cos pitch, sin pitch) and screen-up is
  // (0, sin pitch, cos pitch); right = (1, 0, 0) keeps the triad right-handed.
  const cosP = Math.cos(pitch)
  const sinP = Math.sin(pitch)
  const up = y1 * sinP + z1 * cosP
  const depth = -y1 * cosP + z1 * sinP
  return { sx: cx + x1 * radius, sy: cy - up * radius, depth }
}

/** Sphere radius that fits a w×h box with a margin for labels; 0 when the box has no area. */
export function fitRadius(width: number, height: number, margin = 0.82): number {
  if (!(width > 0) || !(height > 0)) return 0
  return (Math.min(width, height) / 2) * margin
}
