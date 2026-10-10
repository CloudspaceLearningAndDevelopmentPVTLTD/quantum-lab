/**
 * lib/qec/matching.ts — minimum-weight perfect matching on the space-time detector
 * graph, exact for every syndrome this lab produces at distance 3, 5 and 7.
 *
 * ── The graph ───────────────────────────────────────────────────────────────────
 *
 * One node per (layer, stabiliser) detector, plus one boundary node. A data-qubit
 * error before round t flips the two stabilisers touching that qubit in layer t
 * (or one stabiliser and the boundary, on an edge): a SPACE edge, weight
 * ln((1−p_c)/p_c) with p_c the per-channel error rate. A measurement error in round
 * t flips the same stabiliser's detectors in layers t and t+1: a TIME edge, weight
 * ln((1−q)/q). No data noise precedes the final perfect round, so the last layer
 * carries no space edges. Shortest paths by Dijkstra over the real weights, not a
 * Manhattan guess; the boundary is absorbing, so no path hops through it across
 * the lattice (that would let the decoder "correct" a logical for free).
 *
 * ── The matching ────────────────────────────────────────────────────────────────
 *
 * Blossom is overkill at these sizes, but a greedy heuristic that called itself
 * MWPM would put wrong numbers on the threshold chart. The approach:
 *
 *   1. Pairing defects i and j is only ever worth it when w(i,j) < b(i) + b(j),
 *      where b is the cost of sending a defect to the boundary alone. Otherwise the
 *      two boundary edges are at least as cheap, so some optimal matching omits the
 *      pair. Restricting to "worthwhile" edges splits the defects into connected
 *      components that can be matched independently — exactly.
 *   2. Each component of up to EXACT_COMPONENT_LIMIT defects is solved by the
 *      O(2^k·k) subset DP, which is exact. Sparse defect clouds — everything below
 *      threshold — decompose into components of size two or three.
 *   3. A larger component (deep above threshold, or d = 7 with measurement noise)
 *      falls back to greedy nearest-pair refined by an exact large-neighbourhood
 *      search (windows of 12 re-solved with the same DP), and the
 *      result is flagged `exact: false`. matching.test.ts checks the exact path
 *      against an independent brute-force enumeration and measures how far the
 *      fallback sits from optimal.
 */

import { channelRate, type Layout, type Prediction } from './model'
import type { Stabiliser } from '@/components/viz/surface/code'

export type DetectorGraph = {
  /** Detector nodes; the boundary is node `n`. */
  n: number
  layers: number
  stabs: number
  /** Adjacency: node -> edges. `qubit` is the data qubit of a space edge, −1 for time. */
  adj: { to: number; qubit: number; w: number }[][]
  /** dist[s] over nodes 0..n; Infinity when unreachable. */
  dist: Float64Array[]
  parentNode: Int32Array[]
  parentQubit: Int32Array[]
}

/** Log-likelihood weight of an edge that fires with probability r. Clamped so it stays positive. */
export function edgeWeight(r: number): number {
  const clamped = Math.min(Math.max(r, 1e-9), 0.49)
  return Math.log((1 - clamped) / clamped)
}

/**
 * Build the space-time graph for one channel. `stabs` are the DETECTING
 * stabilisers (Z-type for X errors), `layout.layers` the detector layers.
 */
export function buildDetectorGraph(
  layout: Layout,
  stabs: Stabiliser[],
  p: number,
  q: number
): DetectorGraph {
  const nStabs = stabs.length
  const { layers, rounds, code } = layout
  const n = layers * nStabs
  const boundary = n
  const adj: { to: number; qubit: number; w: number }[][] = Array.from({ length: n + 1 }, () => [])
  const ws = edgeWeight(channelRate(p))
  const wt = edgeWeight(q)

  const owners: number[][] = Array.from({ length: code.numData }, () => [])
  stabs.forEach((s, i) => {
    for (const qb of s.qubits) owners[qb].push(i)
  })

  // Space edges: only layers that a data error can precede (the noisy rounds).
  for (let t = 0; t < rounds; t++) {
    const base = t * nStabs
    for (let qb = 0; qb < code.numData; qb++) {
      const o = owners[qb]
      if (o.length === 2) {
        adj[base + o[0]].push({ to: base + o[1], qubit: qb, w: ws })
        adj[base + o[1]].push({ to: base + o[0], qubit: qb, w: ws })
      } else if (o.length === 1) {
        adj[base + o[0]].push({ to: boundary, qubit: qb, w: ws })
        adj[boundary].push({ to: base + o[0], qubit: qb, w: ws })
      }
    }
  }
  // Time edges between consecutive layers.
  if (q > 0) {
    for (let t = 0; t + 1 < layers; t++) {
      for (let s = 0; s < nStabs; s++) {
        const a = t * nStabs + s
        const b = (t + 1) * nStabs + s
        adj[a].push({ to: b, qubit: -1, w: wt })
        adj[b].push({ to: a, qubit: -1, w: wt })
      }
    }
  }

  const dist: Float64Array[] = []
  const parentNode: Int32Array[] = []
  const parentQubit: Int32Array[] = []
  const V = n + 1
  for (let src = 0; src <= n; src++) {
    const dS = new Float64Array(V).fill(Infinity)
    const pN = new Int32Array(V).fill(-1)
    const pQ = new Int32Array(V).fill(-1)
    const done = new Uint8Array(V)
    dS[src] = 0
    // O(V²) Dijkstra: V ≤ 193 at d = 7 with eight layers, run once per graph.
    for (let iter = 0; iter < V; iter++) {
      let u = -1
      let best = Infinity
      for (let v = 0; v < V; v++) {
        if (!done[v] && dS[v] < best) {
          best = dS[v]
          u = v
        }
      }
      if (u < 0) break
      done[u] = 1
      // The boundary is absorbing unless it is where we started.
      if (u === boundary && u !== src) continue
      for (const e of adj[u]) {
        const nd = dS[u] + e.w
        if (nd < dS[e.to]) {
          dS[e.to] = nd
          pN[e.to] = u
          pQ[e.to] = e.qubit
        }
      }
    }
    dist.push(dS)
    parentNode.push(pN)
    parentQubit.push(pQ)
  }

  return { n, layers, stabs: nStabs, adj, dist, parentNode, parentQubit }
}

/** Data qubits along the shortest path from `from` to `to` (time edges contribute none). */
export function pathQubits(graph: DetectorGraph, from: number, to: number): number[] {
  if (!Number.isFinite(graph.dist[from][to])) return []
  const out: number[] = []
  let cur = to
  while (cur !== from) {
    const qb = graph.parentQubit[from][cur]
    const prev = graph.parentNode[from][cur]
    if (prev < 0) return []
    if (qb >= 0) out.push(qb)
    cur = prev
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Components up to this size are matched by the exact subset DP: 2^14 · 14 ≈ 230k
 * operations, well inside a shot's budget.
 */
export const EXACT_COMPONENT_LIMIT = 14

export type Matching = {
  /** partner[i] = j for a pair, −1 for the boundary. Symmetric. */
  partner: Int32Array
  weight: number
  exact: boolean
}

type WeightFn = (i: number, j: number) => number
type BoundaryFn = (i: number) => number

/** Exact subset DP over the members of one component. Members are indices into the full defect list. */
function exactMatchComponent(
  members: number[],
  w: WeightFn,
  b: BoundaryFn,
  partner: Int32Array
): number {
  const k = members.length
  const size = 1 << k
  const best = new Float64Array(size).fill(Infinity)
  const choice = new Int32Array(size).fill(-2)
  best[0] = 0
  for (let mask = 1; mask < size; mask++) {
    let i = 0
    while (((mask >> i) & 1) === 0) i++
    const rest = mask & ~(1 << i)
    let bestCost = b(members[i]) + best[rest]
    let bestChoice = -1
    for (let j = i + 1; j < k; j++) {
      if (((mask >> j) & 1) === 0) continue
      const cost = w(members[i], members[j]) + best[rest & ~(1 << j)]
      if (cost < bestCost) {
        bestCost = cost
        bestChoice = j
      }
    }
    best[mask] = bestCost
    choice[mask] = bestChoice
  }
  let mask = size - 1
  while (mask !== 0) {
    let i = 0
    while (((mask >> i) & 1) === 0) i++
    const j = choice[mask]
    if (j >= 0) {
      partner[members[i]] = members[j]
      partner[members[j]] = members[i]
      mask &= ~(1 << j)
    } else partner[members[i]] = -1
    mask &= ~(1 << i)
  }
  return best[size - 1]
}

/** Cost of the edges a closed-under-partner subset currently uses. */
function subsetCost(subset: number[], w: WeightFn, b: BoundaryFn, partner: Int32Array): number {
  let total = 0
  for (const i of subset) {
    const j = partner[i]
    if (j < 0) total += b(i)
    else if (i < j) total += w(i, j)
  }
  return total
}

/** Members re-solved exactly in one large-neighbourhood step. 2^12 · 12 ≈ 50k operations. */
const WINDOW = 12

/**
 * Greedy nearest-move, then large-neighbourhood search: around every defect,
 * gather its nearest neighbours and their partners (so the window is closed
 * under the matching), re-solve that window exactly with the DP, and keep the
 * result when it is cheaper. Repeat until a full pass changes nothing.
 * matching.test.ts measures this against brute force above threshold.
 */
function heuristicMatchComponent(
  members: number[],
  w: WeightFn,
  b: BoundaryFn,
  partner: Int32Array
): number {
  const remaining = new Set(members)
  while (remaining.size > 0) {
    let bestCost = Infinity
    let bi = -1
    let bj = -1
    for (const i of remaining) {
      const bc = b(i)
      if (bc < bestCost) {
        bestCost = bc
        bi = i
        bj = -1
      }
      for (const j of remaining) {
        if (j <= i) continue
        const c = w(i, j)
        if (c < bestCost) {
          bestCost = c
          bi = i
          bj = j
        }
      }
    }
    partner[bi] = bj
    remaining.delete(bi)
    if (bj >= 0) {
      partner[bj] = bi
      remaining.delete(bj)
    }
  }

  let improved = true
  let passes = 0
  while (improved && passes++ < 8) {
    improved = false
    for (const centre of members) {
      // Nearest neighbours of the centre, closed under the current matching.
      const byDistance = members
        .filter((m) => m !== centre)
        .sort((x, y) => w(centre, x) - w(centre, y))
      const window = new Set<number>([centre])
      if (partner[centre] >= 0) window.add(partner[centre])
      for (const m of byDistance) {
        if (window.size >= WINDOW - 1) break
        window.add(m)
        if (partner[m] >= 0) window.add(partner[m])
      }
      const subset = Array.from(window)
      if (subset.length < 3) continue
      const before = subsetCost(subset, w, b, partner)
      const saved = subset.map((i) => partner[i])
      const after = exactMatchComponent(subset, w, b, partner)
      if (after < before - 1e-12) improved = true
      else subset.forEach((i, idx) => (partner[i] = saved[idx]))
    }
  }

  return subsetCost(members, w, b, partner)
}

/**
 * Minimum-weight perfect matching of k defects where any defect may also be sent
 * to the boundary. Exact whenever every worthwhile-edge component has at most
 * `exactLimit` members; `exact` in the result says whether that held.
 */
export function minWeightMatching(
  k: number,
  w: WeightFn,
  b: BoundaryFn,
  exactLimit: number = EXACT_COMPONENT_LIMIT
): Matching {
  const partner = new Int32Array(k).fill(-1)
  if (k === 0) return { partner, weight: 0, exact: true }

  // Union-find over worthwhile edges.
  const root = new Int32Array(k)
  for (let i = 0; i < k; i++) root[i] = i
  const find = (x: number): number => {
    while (root[x] !== x) {
      root[x] = root[root[x]]
      x = root[x]
    }
    return x
  }
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      if (w(i, j) < b(i) + b(j)) {
        const ri = find(i)
        const rj = find(j)
        if (ri !== rj) root[ri] = rj
      }
    }
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < k; i++) {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(i)
    else groups.set(r, [i])
  }

  let weight = 0
  let exact = true
  for (const members of groups.values()) {
    if (members.length === 1) {
      partner[members[0]] = -1
      weight += b(members[0])
    } else if (members.length <= exactLimit) {
      weight += exactMatchComponent(members, w, b, partner)
    } else {
      weight += heuristicMatchComponent(members, w, b, partner)
      exact = false
    }
  }
  return { partner, weight, exact }
}

// ─────────────────────────────────────────────────────────────────────────────
// Decoding
// ─────────────────────────────────────────────────────────────────────────────

export type ChannelDecoding = {
  defects: number[]
  matching: Matching
  /** Data qubits the decoder would flip, projected onto the lattice. */
  correction: Uint8Array
  /** Predicted logical flip: parity of the correction on the logical support. */
  flip: 0 | 1
}

export function decodeChannel(
  graph: DetectorGraph,
  detectors: Uint8Array,
  numData: number,
  logicalSupport: number[],
  exactLimit: number = EXACT_COMPONENT_LIMIT
): ChannelDecoding {
  const defects: number[] = []
  for (let i = 0; i < detectors.length; i++) if (detectors[i]) defects.push(i)

  const matching = minWeightMatching(
    defects.length,
    (i, j) => graph.dist[defects[i]][defects[j]],
    (i) => graph.dist[defects[i]][graph.n],
    exactLimit
  )

  const correction = new Uint8Array(numData)
  for (let i = 0; i < defects.length; i++) {
    const j = matching.partner[i]
    if (j >= 0 && j < i) continue
    const from = defects[i]
    const to = j < 0 ? graph.n : defects[j]
    for (const qb of pathQubits(graph, from, to)) correction[qb] ^= 1
  }
  let flip = 0
  for (const qb of logicalSupport) flip ^= correction[qb]
  return { defects, matching, correction, flip: flip as 0 | 1 }
}

/** The MWPM decoder for a (layout, p, q). Rebuilt when the weights change. */
export class MwpmDecoder {
  readonly name = 'mwpm' as const
  readonly graphX: DetectorGraph
  readonly graphZ: DetectorGraph
  /** Shots decoded by the heuristic fallback in at least one channel. */
  inexactShots = 0
  shots = 0

  constructor(
    readonly layout: Layout,
    p: number,
    q: number,
    readonly exactLimit: number = EXACT_COMPONENT_LIMIT
  ) {
    this.graphX = buildDetectorGraph(layout, layout.stabsX, p, q)
    this.graphZ = buildDetectorGraph(layout, layout.stabsZ, p, q)
  }

  decode(detX: Uint8Array, detZ: Uint8Array): { x: ChannelDecoding; z: ChannelDecoding } {
    const { code } = this.layout
    const x = decodeChannel(this.graphX, detX, code.numData, code.logicalZ, this.exactLimit)
    const z = decodeChannel(this.graphZ, detZ, code.numData, code.logicalX, this.exactLimit)
    this.shots++
    if (!x.matching.exact || !z.matching.exact) this.inexactShots++
    return { x, z }
  }

  predict(detX: Uint8Array, detZ: Uint8Array): Prediction {
    const { x, z } = this.decode(detX, detZ)
    return { flipX: x.flip, flipZ: z.flip }
  }
}
