/**
 * lib/qec3d/instances.ts — what to draw, as plain data.
 *
 * The 3-D lattice component renders three InstancedMeshes: data qubits, stabilisers
 * (one per stabiliser per round when rounds are stacked), and matching edges. This
 * module turns the component's props into the per-instance lists those meshes
 * consume — position, size, and a STYLE key that the component maps to a theme
 * colour — so every decision about what appears where can be tested in node, and
 * the component is left with nothing to do but copy numbers into buffers.
 *
 * The 2-D fallback draws from exactly the same lists, projected, so the two
 * pictures cannot disagree about which stabiliser is lit.
 */

import {
  detectionEvents,
  positionAtRound,
  syndromeFromErrors,
  type Lattice3D,
  type MatchingSegment,
  type QubitError,
  type Vec3,
} from './layout'

export type InstanceStyle =
  | 'data-clean'
  | 'data-X'
  | 'data-Z'
  | 'data-Y'
  | 'stab-X' // unlit, base slice
  | 'stab-Z'
  | 'stab-X-ghost' // unlit, an upper round of the stack
  | 'stab-Z-ghost'
  | 'stab-X-lit'
  | 'stab-Z-lit'

export type Instance = {
  position: Vec3
  /** Uniform scale relative to the mesh's unit geometry, in world units. */
  scale: number
  style: InstanceStyle
  /** Set on data-qubit instances: the qubit index, for picking. */
  qubit?: number
  /** Set on stabiliser instances. */
  stabiliser?: number
  round?: number
}

/** Radii in pitches. Data qubits are the largest thing on the lattice; a lit stabiliser is emphatic. */
export const SIZES = {
  data: 0.16,
  dataError: 0.19,
  stab: 0.09,
  stabGhost: 0.05,
  stabLit: 0.15,
  edge: 0.035,
} as const

export function dataInstances(lattice: Lattice3D, errors?: ReadonlyArray<QubitError>): Instance[] {
  const { pitch } = lattice
  return lattice.data.map((q) => {
    const e = errors?.[q.index] ?? 'I'
    const style: InstanceStyle =
      e === 'X' ? 'data-X' : e === 'Z' ? 'data-Z' : e === 'Y' ? 'data-Y' : 'data-clean'
    return {
      position: q.position,
      scale: (e === 'I' ? SIZES.data : SIZES.dataError) * pitch,
      style,
      qubit: q.index,
    }
  })
}

export type StabiliserInstanceOptions = {
  /** One boolean per stabiliser id: the current round's outcomes. Ignored when `rounds` is given. */
  syndrome?: ReadonlyArray<boolean>
  /** Falls back to the syndrome of `errors` when neither `syndrome` nor `rounds` is given. */
  errors?: ReadonlyArray<QubitError>
  /** Stacked mode: round 0 at the base, later rounds above. */
  rounds?: ReadonlyArray<ReadonlyArray<boolean>>
  /** In stacked mode, light detection events (changes between rounds) rather than raw outcomes. Default true. */
  detection?: boolean
  roundSpacing: number
}

/** How many horizontal slices the picture has: the round count, or 1 for a flat lattice. */
export function layerCount(rounds?: ReadonlyArray<ReadonlyArray<boolean>>): number {
  return rounds && rounds.length > 0 ? rounds.length : 1
}

export function stabiliserInstances(lattice: Lattice3D, opts: StabiliserInstanceOptions): Instance[] {
  const { pitch } = lattice
  const out: Instance[] = []
  const layers = layerCount(opts.rounds)

  // Which (stabiliser, round) cells are lit.
  const lit = new Set<string>()
  if (opts.rounds && opts.rounds.length > 0) {
    if (opts.detection ?? true) {
      for (const ev of detectionEvents(opts.rounds)) lit.add(`${ev.stabiliser}@${ev.round}`)
    } else {
      opts.rounds.forEach((round, t) => {
        round.forEach((on, s) => {
          if (on) lit.add(`${s}@${t}`)
        })
      })
    }
  } else {
    const syn = opts.syndrome ?? (opts.errors ? syndromeFromErrors(lattice, opts.errors) : [])
    syn.forEach((on, s) => {
      if (on) lit.add(`${s}@0`)
    })
  }

  for (let t = 0; t < layers; t++) {
    for (const s of lattice.stabilisers) {
      const isLit = lit.has(`${s.id}@${t}`)
      const style: InstanceStyle = isLit
        ? s.type === 'X'
          ? 'stab-X-lit'
          : 'stab-Z-lit'
        : t === 0
          ? s.type === 'X'
            ? 'stab-X'
            : 'stab-Z'
          : s.type === 'X'
            ? 'stab-X-ghost'
            : 'stab-Z-ghost'
      const size = isLit ? SIZES.stabLit : t === 0 ? SIZES.stab : SIZES.stabGhost
      out.push({
        position: positionAtRound(s.position, t, opts.roundSpacing),
        scale: size * pitch,
        style,
        stabiliser: s.id,
        round: t,
      })
    }
  }
  return out
}

/** A cylinder instance: where its centre is, how long it is, and which way it points. */
export type EdgeInstance = {
  mid: Vec3
  length: number
  /** Unit direction from a to b. */
  dir: Vec3
  type: 'X' | 'Z'
  toBoundary: boolean
}

export function edgeInstances(segments: ReadonlyArray<MatchingSegment>): EdgeInstance[] {
  const out: EdgeInstance[] = []
  for (const seg of segments) {
    const dx = seg.b[0] - seg.a[0]
    const dy = seg.b[1] - seg.a[1]
    const dz = seg.b[2] - seg.a[2]
    const length = Math.hypot(dx, dy, dz)
    // A zero-length edge (a node matched to itself) has no direction; skip it
    // rather than hand the renderer a NaN quaternion.
    if (!(length > 1e-9)) continue
    out.push({
      mid: [seg.a[0] + dx / 2, seg.a[1] + dy / 2, seg.a[2] + dz / 2],
      length,
      dir: [dx / length, dy / length, dz / length],
      type: seg.type,
      toBoundary: seg.toBoundary,
    })
  }
  return out
}

/**
 * The corners of the lattice outline at a given round, in drawing order. Drawn as a
 * faint square at every round so a stack reads as a stack of slices, not a cloud.
 */
export function sliceOutline(lattice: Lattice3D, round: number, roundSpacing: number): Vec3[] {
  const h = lattice.halfExtent
  const y = round * roundSpacing
  return [
    [-h, y, -h],
    [h, y, -h],
    [h, y, h],
    [-h, y, h],
  ]
}
