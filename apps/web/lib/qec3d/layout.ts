/**
 * lib/qec3d/layout.ts — the rotated surface code as geometry in three dimensions.
 *
 * Pure functions, no DOM, no three.js. Everything the 3-D lattice component draws is
 * computed here so it can be tested in node against numbers worked out by hand:
 * qubit counts, stabiliser weights, incidence, and where each matching edge goes.
 *
 * ── Coordinates ─────────────────────────────────────────────────────────────────
 *
 * Right-handed, Y up (three.js convention). The lattice lies in the x–z plane:
 *
 *     x  →  column          (data qubit (r, c) at x = (c − (d−1)/2) · pitch)
 *     z  →  row             (                     z = (r − (d−1)/2) · pitch)
 *     y  →  TIME            (syndrome round t sits at y = t · roundSpacing)
 *
 * Row 0 is the far edge (negative z), so a default camera in front of the lattice
 * sees row 0 at the top — the same orientation as the 2-D canvas drawing, which
 * puts row 0 at the top of the picture.
 *
 * ── The lattice ─────────────────────────────────────────────────────────────────
 *
 * d × d data qubits, index r·d + c. A stabiliser sits between every four
 * neighbouring data qubits (a bulk plaquette, weight 4) and half a plaquette hangs
 * off each edge (weight 2). Which type a plaquette carries is fixed by the parity of
 * its top-left corner (r + c even → X), with the top and bottom edges carrying X
 * stabilisers and the left and right edges Z. That is d² − 1 stabilisers: (d−1)²
 * bulk plus 2(d−1) on the boundary, one short of d², leaving one logical qubit.
 *
 * The scan order, the type rule and the boundary rule are the same as
 * components/viz/surface/code.ts, and `layout.test.ts` cross-checks the two
 * module-by-module so a stabiliser's id and `typeIndex` here mean exactly what
 * that decoder's defect indices mean. This module deliberately does not import
 * from it — lib/ does not depend on components/.
 *
 * ── Space-time ──────────────────────────────────────────────────────────────────
 *
 * Real error correction measures every stabiliser again and again, and the
 * measurements themselves are faulty. The decoder therefore does not look at one
 * round; it looks at the whole stack of rounds as a 3-D volume — rows and columns
 * across, time up — and matches DETECTION EVENTS: places where a stabiliser's
 * outcome differs from the round before. `detectionEvents` computes those, and
 * `positionAtRound` lifts a lattice position to the height of its round.
 */

export type StabiliserType = 'X' | 'Z'

/** A point in the Y-up world. */
export type Vec3 = readonly [x: number, y: number, z: number]

export type DataQubit3D = {
  /** r · d + c, the same index the decoder uses. */
  index: number
  row: number
  col: number
  position: Vec3
  /** Ids of the stabilisers whose support contains this qubit (2, 3 or 4 of them). */
  stabilisers: number[]
}

export type Stabiliser3D = {
  /** Position in `stabilisers`, the global id. */
  id: number
  type: StabiliserType
  /** Position within the stabilisers of this type — what a per-channel decoder keys on. */
  typeIndex: number
  /** Plaquette centre in data-qubit coordinates: half-integers. */
  row: number
  col: number
  /** Data qubits in the support. 4 in the bulk, 2 on the boundary. */
  qubits: number[]
  position: Vec3
}

export type Lattice3D = {
  d: number
  /** Distance between neighbouring data qubits, in world units. */
  pitch: number
  data: DataQubit3D[]
  stabilisers: Stabiliser3D[]
  byType: Record<StabiliserType, Stabiliser3D[]>
  /**
   * Half the width of the lattice including the boundary half-plaquettes, in world
   * units. A camera framing a sphere of this radius sees the whole slice.
   */
  halfExtent: number
}

/** Positive modulo: JS gives (−1) % 2 === −1, which would flip every boundary type. */
function mod2(n: number): number {
  return ((n % 2) + 2) % 2
}

export function assertDistance(d: number): void {
  if (!Number.isInteger(d) || d < 3 || d % 2 === 0) {
    throw new Error(`surface code distance must be an odd integer >= 3, got ${d}`)
  }
}

/** World x for a column and world z for a row, both centred on the origin. */
export function latticeX(col: number, d: number, pitch: number): number {
  return (col - (d - 1) / 2) * pitch
}
export function latticeZ(row: number, d: number, pitch: number): number {
  return (row - (d - 1) / 2) * pitch
}

/**
 * Build the lattice for distance `d`. `pitch` is the data-qubit spacing; the
 * default of 1 makes every other length in this module read as "in qubit pitches".
 */
export function buildLattice3D(d: number, pitch = 1): Lattice3D {
  assertDistance(d)
  const index = (r: number, c: number) => r * d + c

  const data: DataQubit3D[] = []
  for (let r = 0; r < d; r++) {
    for (let c = 0; c < d; c++) {
      data.push({
        index: index(r, c),
        row: r,
        col: c,
        position: [latticeX(c, d, pitch), 0, latticeZ(r, d, pitch)],
        stabilisers: [],
      })
    }
  }

  const stabilisers: Stabiliser3D[] = []
  for (let r = -1; r <= d - 1; r++) {
    for (let c = -1; c <= d - 1; c++) {
      const type: StabiliserType = mod2(r + c) === 0 ? 'X' : 'Z'
      const corners: [number, number][] = [
        [r, c],
        [r, c + 1],
        [r + 1, c],
        [r + 1, c + 1],
      ]
      const qubits = corners
        .filter(([qr, qc]) => qr >= 0 && qr < d && qc >= 0 && qc < d)
        .map(([qr, qc]) => index(qr, qc))

      const onTopOrBottom = r === -1 || r === d - 1
      const onLeftOrRight = c === -1 || c === d - 1
      const keep =
        qubits.length === 4 ||
        (qubits.length === 2 && onTopOrBottom && type === 'X') ||
        (qubits.length === 2 && onLeftOrRight && type === 'Z')
      if (!keep) continue

      const row = r + 0.5
      const col = c + 0.5
      stabilisers.push({
        id: stabilisers.length,
        type,
        typeIndex: -1,
        row,
        col,
        qubits,
        position: [latticeX(col, d, pitch), 0, latticeZ(row, d, pitch)],
      })
    }
  }

  const byType: Record<StabiliserType, Stabiliser3D[]> = {
    X: stabilisers.filter((s) => s.type === 'X'),
    Z: stabilisers.filter((s) => s.type === 'Z'),
  }
  byType.X.forEach((s, i) => {
    s.typeIndex = i
  })
  byType.Z.forEach((s, i) => {
    s.typeIndex = i
  })
  for (const s of stabilisers) {
    for (const q of s.qubits) data[q].stabilisers.push(s.id)
  }

  // Data qubits span ±(d−1)/2 pitches; boundary half-plaquettes reach half a pitch
  // further, and their drawn shape a little beyond that.
  const halfExtent = ((d - 1) / 2 + 0.75) * pitch

  return { d, pitch, data, stabilisers, byType, halfExtent }
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** Per-data-qubit error: identity, bit flip, phase flip, or both. */
export type QubitError = 'I' | 'X' | 'Z' | 'Y'

/**
 * Merge the two per-channel arrays the 2-D lab keeps (1 = error on that qubit) into
 * one Pauli label per qubit. An X and a Z on the same qubit is a Y up to phase.
 */
export function errorsFromChannels(
  errorsX: ArrayLike<number>,
  errorsZ: ArrayLike<number>
): QubitError[] {
  const n = Math.max(errorsX.length, errorsZ.length)
  const out: QubitError[] = new Array(n)
  for (let q = 0; q < n; q++) {
    const x = (errorsX[q] ?? 0) === 1
    const z = (errorsZ[q] ?? 0) === 1
    out[q] = x && z ? 'Y' : x ? 'X' : z ? 'Z' : 'I'
  }
  return out
}

/**
 * The syndrome an error pattern produces, as one boolean per stabiliser (global id).
 * Z-type stabilisers flip on X (and Y) errors; X-type on Z (and Y) errors.
 */
export function syndromeFromErrors(
  lattice: Lattice3D,
  errors: ReadonlyArray<QubitError>
): boolean[] {
  return lattice.stabilisers.map((s) => {
    let parity = 0
    for (const q of s.qubits) {
      const e = errors[q] ?? 'I'
      const seen = s.type === 'Z' ? e === 'X' || e === 'Y' : e === 'Z' || e === 'Y'
      if (seen) parity ^= 1
    }
    return parity === 1
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Time
// ─────────────────────────────────────────────────────────────────────────────

/** Lift a lattice position to the height of syndrome round `round`. */
export function positionAtRound(p: Vec3, round: number, roundSpacing: number): Vec3 {
  return [p[0], p[1] + round * roundSpacing, p[2]]
}

/** A syndrome node in space-time: which stabiliser, in which round. */
export type SyndromeNode = { stabiliser: number; round?: number }

/**
 * Detection events from a stack of syndrome rounds.
 *
 * A stabiliser that flips once and stays flipped reads odd in every later round,
 * but there was only ONE error. What a decoder matches is the change between
 * consecutive rounds — the round-0 reference being "everything even", so the
 * first round's raw syndrome is its own event list. Two detection events, in
 * different rounds, on the same stabiliser mean the error was a measurement
 * error: nothing happened to the data, the readout lied once.
 */
export function detectionEvents(rounds: ReadonlyArray<ReadonlyArray<boolean>>): SyndromeNode[] {
  const out: SyndromeNode[] = []
  for (let t = 0; t < rounds.length; t++) {
    const now = rounds[t]
    const before = t === 0 ? null : rounds[t - 1]
    for (let s = 0; s < now.length; s++) {
      const prev = before ? (before[s] ?? false) : false
      if (now[s] !== prev) out.push({ stabiliser: s, round: t })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

/** One edge of a decoder's matching: two syndrome nodes, or a node and the boundary. */
export type MatchingEdge = { from: SyndromeNode; to: SyndromeNode | 'boundary' }

/** A straight line segment in world space, ready to be drawn. */
export type MatchingSegment = {
  a: Vec3
  b: Vec3
  /** Type of the stabiliser(s) this edge joins — every edge stays within one channel. */
  type: StabiliserType
  /** True when `b` is a boundary point rather than a stabiliser. */
  toBoundary: boolean
}

/**
 * Where an unmatched stabiliser's chain leaves the lattice. Z errors terminate on
 * the X-type (top/bottom) boundary and X errors on the Z-type (left/right) one, so
 * an X stabiliser's boundary edge runs to the nearer of row −1 and row d, straight
 * along its column, and a Z stabiliser's to the nearer of col −1 and col d. Rows
 * and columns of stabilisers are half-integers and d is odd, so there is never a
 * tie.
 */
export function boundaryPoint(lattice: Lattice3D, s: Stabiliser3D): Vec3 {
  const { d, pitch } = lattice
  if (s.type === 'X') {
    const row = s.row < (d - 1) / 2 ? -1 : d
    return [latticeX(s.col, d, pitch), 0, latticeZ(row, d, pitch)]
  }
  const col = s.col < (d - 1) / 2 ? -1 : d
  return [latticeX(col, d, pitch), 0, latticeZ(s.row, d, pitch)]
}

/**
 * Project a matching onto line segments. Edges naming a stabiliser id that does
 * not exist, or joining two stabilisers of different types, are dropped rather
 * than drawn wrong — a decoder never produces them, and a bad prop should not
 * throw inside a render loop.
 */
export function matchingSegments(
  lattice: Lattice3D,
  edges: ReadonlyArray<MatchingEdge>,
  roundSpacing = 0
): MatchingSegment[] {
  const out: MatchingSegment[] = []
  for (const edge of edges) {
    const from = lattice.stabilisers[edge.from.stabiliser]
    if (!from) continue
    const a = positionAtRound(from.position, edge.from.round ?? 0, roundSpacing)
    if (edge.to === 'boundary') {
      const b = positionAtRound(boundaryPoint(lattice, from), edge.from.round ?? 0, roundSpacing)
      out.push({ a, b, type: from.type, toBoundary: true })
      continue
    }
    const to = lattice.stabilisers[edge.to.stabiliser]
    if (!to || to.type !== from.type) continue
    const b = positionAtRound(to.position, edge.to.round ?? 0, roundSpacing)
    out.push({ a, b, type: from.type, toBoundary: false })
  }
  return out
}

/**
 * Adapter for a per-channel decoder that reports defects and pairs the way
 * components/viz/surface/code.ts does: `defects[i]` is a typeIndex within
 * `byType[type]`, and each pair is `{ from, to }` of indices INTO `defects`, with
 * `to = −1` meaning matched to the boundary.
 */
export function edgesFromTypedMatching(
  lattice: Lattice3D,
  type: StabiliserType,
  defects: ReadonlyArray<number>,
  pairs: ReadonlyArray<{ from: number; to: number }>,
  round?: number
): MatchingEdge[] {
  const list = lattice.byType[type]
  const out: MatchingEdge[] = []
  for (const pair of pairs) {
    const from = list[defects[pair.from]]
    if (!from) continue
    if (pair.to < 0) {
      out.push({ from: { stabiliser: from.id, round }, to: 'boundary' })
      continue
    }
    const to = list[defects[pair.to]]
    if (!to) continue
    out.push({ from: { stabiliser: from.id, round }, to: { stabiliser: to.id, round } })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Framing and the 2-D fallback projection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Radius of the sphere that encloses the whole picture: the slice at the bottom
 * plus `layers` rounds stacked above it. Used to place the camera, and by the 2-D
 * fallback to scale its drawing. `layers` counts rounds drawn, so 1 is a flat
 * slice (height 0).
 */
export function sceneRadius(lattice: Lattice3D, layers: number, roundSpacing: number): number {
  const height = Math.max(0, layers - 1) * roundSpacing
  // The slice's bounding circle, and the half-height of the stack above its centre.
  const r = lattice.halfExtent * Math.SQRT2
  return Math.hypot(r, height / 2)
}

/** Height of the centre of the stack above the base slice. */
export function stackCentreY(layers: number, roundSpacing: number): number {
  return (Math.max(0, layers - 1) * roundSpacing) / 2
}

/**
 * Oblique (cabinet) projection of a world point to 2-D canvas coordinates, for the
 * no-WebGL fallback. x goes right, TIME goes up the page, and depth (z, the row
 * axis) is drawn at half length along a 30° diagonal so a stack of rounds still
 * reads as a stack. Pure so a test can pin the picture down.
 *
 * `scale` is canvas pixels per world unit; `cx`, `cy` is where the world origin
 * lands. Returns canvas coordinates with y DOWN, as a 2-D canvas expects.
 */
export function projectOblique(
  p: Vec3,
  scale: number,
  cx: number,
  cy: number
): { x: number; y: number } {
  const depth = 0.5
  const cos30 = Math.sqrt(3) / 2
  const sin30 = 0.5
  return {
    x: cx + (p[0] + p[2] * depth * cos30) * scale,
    // Rows increase towards +z (towards the viewer); the fallback puts row 0 at
    // the top of the picture like the 2-D lab does, so +z moves DOWN the page.
    y: cy - p[1] * scale + p[2] * depth * sin30 * scale,
  }
}

/**
 * Pixels per world unit so the projected stack fits a `w × h` canvas with a
 * margin. Zero-size canvases give zero, never a negative or infinite scale —
 * the first paint of a not-yet-laid-out container is exactly this case.
 */
export function fallbackScale(
  lattice: Lattice3D,
  layers: number,
  roundSpacing: number,
  w: number,
  h: number,
  margin = 28
): number {
  const usableW = w - 2 * margin
  const usableH = h - 2 * margin
  if (!(usableW > 0) || !(usableH > 0)) return 0
  // Projected width: the x span plus half the z span along the diagonal.
  const half = lattice.halfExtent
  const spanX = 2 * half + 2 * half * 0.5 * (Math.sqrt(3) / 2)
  const spanY = Math.max(0, layers - 1) * roundSpacing + 2 * half * 0.5 * 0.5
  const s = Math.min(usableW / spanX, usableH / spanY)
  return Number.isFinite(s) && s > 0 ? s : 0
}
