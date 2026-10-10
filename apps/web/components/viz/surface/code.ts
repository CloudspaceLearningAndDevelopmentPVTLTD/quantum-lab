/**
 * The rotated surface code: layout, syndrome extraction, a real matching decoder, and
 * the logical-failure test.
 *
 * ── The layout ──────────────────────────────────────────────────────────────────
 *
 * d × d data qubits on a square grid, data qubit (r, c) at index r·d + c. Between
 * every four neighbouring data qubits sits a stabiliser; along the edges sit
 * weight-two ones. Which type goes where is fixed by the parity of the plaquette's
 * top-left corner, with the top and bottom edges carrying X-type stabilisers and the
 * left and right edges Z-type. That gives (d−1)² + 2(d−1) = d² − 1 stabilisers, which
 * is exactly the number needed to leave one logical qubit.
 *
 * Nothing above is asserted on faith. `code.test.ts` checks that every pair of
 * stabilisers commutes, that both logical operators commute with every stabiliser and
 * anticommute with each other, and that the count is d² − 1. A boundary assigned the
 * wrong type produces a lattice that still draws beautifully and is not a code.
 *
 * ── What detects what ───────────────────────────────────────────────────────────
 *
 * X-type stabilisers detect Z errors. Z-type stabilisers detect X errors. The two
 * channels are decoded independently — which is exactly why the surface code is
 * tractable, and also why correlated XZ (i.e. Y) errors are handled worse than they
 * could be by a decoder that treated them jointly. This one does not; that is a real
 * limitation of the implementation and is stated on the page.
 *
 * ── The decoder ─────────────────────────────────────────────────────────────────
 *
 * Minimum-weight perfect matching on the syndrome graph, with distances from a BFS
 * over the actual graph (nodes = stabilisers of one type, edges = data qubits, plus a
 * single boundary node), not a Manhattan approximation. The matching itself is exact
 * for up to `EXACT_MATCHING_LIMIT` defects via a subset DP, and greedy above that.
 * Which one ran is reported in the result, because a greedy fallback that silently
 * pretended to be MWPM would make the threshold numbers on the page wrong.
 */

export type StabType = 'X' | 'Z'

export type Stabiliser = {
  id: number
  type: StabType
  /** Index within `byType[type]` — what the syndrome graph and decoder key on. */
  typeIndex: number
  /** Plaquette centre, in data-qubit coordinates: (row + 0.5, col + 0.5). */
  row: number
  col: number
  /** Data-qubit indices in this stabiliser's support. */
  qubits: number[]
}

export type SurfaceCode = {
  d: number
  /** d² physical data qubits. */
  numData: number
  stabilisers: Stabiliser[]
  /** Stabilisers of each type, in `stabilisers` order. */
  byType: Record<StabType, Stabiliser[]>
  /** logicalX[i] = data qubits carrying the logical X̄ (a full column). */
  logicalX: number[]
  /** logicalZ[i] = data qubits carrying the logical Z̄ (a full row). */
  logicalZ: number[]
  /** Decoding graphs, one per stabiliser type. Built once, reused every shot. */
  graphs: Record<StabType, SyndromeGraph>
}

/** Positive modulo — JS `%` returns −1 for (−1) % 2, which flips every boundary type. */
function mod2(n: number): number {
  return ((n % 2) + 2) % 2
}

export function buildSurfaceCode(d: number): SurfaceCode {
  if (!Number.isInteger(d) || d < 3 || d % 2 === 0) {
    // Even d has no single-qubit-crossing logical representative and the boundary
    // types stop alternating; the code below would produce a lattice that is not a
    // distance-d code. Refusing beats drawing something wrong.
    throw new Error(`surface code distance must be an odd integer >= 3, got ${d}`)
  }

  const stabilisers: Stabiliser[] = []
  const index = (r: number, c: number) => r * d + c

  for (let r = -1; r <= d - 1; r++) {
    for (let c = -1; c <= d - 1; c++) {
      const type: StabType = mod2(r + c) === 0 ? 'X' : 'Z'
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

      if (qubits.length === 4) {
        // Bulk plaquette.
      } else if (qubits.length === 2 && onTopOrBottom && type === 'X') {
        // Top and bottom edges terminate X chains, so they carry X stabilisers.
      } else if (qubits.length === 2 && onLeftOrRight && type === 'Z') {
        // Left and right edges terminate Z chains.
      } else {
        continue
      }

      stabilisers.push({
        id: stabilisers.length,
        type,
        typeIndex: -1, // filled in below, once both type lists are known
        row: r + 0.5,
        col: c + 0.5,
        qubits,
      })
    }
  }

  const logicalX = Array.from({ length: d }, (_, r) => index(r, 0))
  const logicalZ = Array.from({ length: d }, (_, c) => index(0, c))

  const byType: Record<StabType, Stabiliser[]> = {
    X: stabilisers.filter((s) => s.type === 'X'),
    Z: stabilisers.filter((s) => s.type === 'Z'),
  }
  // Renderers need to go from a stabiliser to its position in the syndrome list
  // without an indexOf() per frame.
  byType.X.forEach((s, i) => {
    s.typeIndex = i
  })
  byType.Z.forEach((s, i) => {
    s.typeIndex = i
  })

  const code: SurfaceCode = {
    d,
    numData: d * d,
    stabilisers,
    byType,
    logicalX,
    logicalZ,
    graphs: {
      X: buildSyndromeGraph(d * d, byType.X),
      Z: buildSyndromeGraph(d * d, byType.Z),
    },
  }
  return code
}

// ─────────────────────────────────────────────────────────────────────────────
// Syndrome graph
// ─────────────────────────────────────────────────────────────────────────────

export type SyndromeGraph = {
  /** Number of stabiliser nodes. The boundary node has index `n`. */
  n: number
  /** Adjacency: node -> [{ to, qubit }]. */
  adj: { to: number; qubit: number }[][]
  /**
   * dist[s][t] over nodes 0..n (n = boundary). The boundary is a valid destination
   * but is never expanded, so a path cannot hop across the lattice through it —
   * doing so would let the decoder "correct" a logical error for free.
   */
  dist: Int32Array[]
  /** parentNode[s][t] / parentQubit[s][t]: walk back from t to s to rebuild a chain. */
  parentNode: Int32Array[]
  parentQubit: Int32Array[]
  /** Data qubits that touch no stabiliser of this type. */
  invisibleQubits: number[]
}

const UNREACHABLE = 0x7fffffff

function buildSyndromeGraph(numData: number, stabs: Stabiliser[]): SyndromeGraph {
  const n = stabs.length
  const boundary = n
  const adj: { to: number; qubit: number }[][] = Array.from({ length: n + 1 }, () => [])

  const stabsOfQubit: number[][] = Array.from({ length: numData }, () => [])
  stabs.forEach((s, i) => {
    for (const q of s.qubits) stabsOfQubit[q].push(i)
  })

  const invisibleQubits: number[] = []
  for (let q = 0; q < numData; q++) {
    const owners = stabsOfQubit[q]
    if (owners.length >= 2) {
      // In this code every data qubit sits in at most two stabilisers of a type.
      adj[owners[0]].push({ to: owners[1], qubit: q })
      adj[owners[1]].push({ to: owners[0], qubit: q })
    } else if (owners.length === 1) {
      adj[owners[0]].push({ to: boundary, qubit: q })
      adj[boundary].push({ to: owners[0], qubit: q })
    } else {
      invisibleQubits.push(q)
    }
  }

  const dist: Int32Array[] = []
  const parentNode: Int32Array[] = []
  const parentQubit: Int32Array[] = []

  for (let s = 0; s <= boundary; s++) {
    const dS = new Int32Array(n + 1).fill(UNREACHABLE)
    const pN = new Int32Array(n + 1).fill(-1)
    const pQ = new Int32Array(n + 1).fill(-1)
    dS[s] = 0
    const queue = [s]
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head]
      // The boundary is absorbing: reachable, never expanded. The one exception is
      // when the BFS *starts* there, which is how boundary distances are found.
      if (u === boundary && u !== s) continue
      for (const edge of adj[u]) {
        if (dS[edge.to] !== UNREACHABLE) continue
        dS[edge.to] = dS[u] + 1
        pN[edge.to] = u
        pQ[edge.to] = edge.qubit
        queue.push(edge.to)
      }
    }
    dist.push(dS)
    parentNode.push(pN)
    parentQubit.push(pQ)
  }

  return { n, adj, dist, parentNode, parentQubit, invisibleQubits }
}

/** The data qubits along the shortest path from `from` to `to`. */
export function pathQubits(graph: SyndromeGraph, from: number, to: number): number[] {
  if (graph.dist[from][to] === UNREACHABLE) return []
  const out: number[] = []
  let cur = to
  while (cur !== from) {
    const q = graph.parentQubit[from][cur]
    const prev = graph.parentNode[from][cur]
    if (prev < 0) return []
    out.push(q)
    cur = prev
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Syndrome and decoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which stabilisers of `type` fire, given an error pattern.
 *
 * Z-type stabilisers anticommute with X errors; X-type with Z errors. Pass the
 * matching error array or the syndrome is silently always zero.
 */
export function syndromeOf(stabs: Stabiliser[], errors: Uint8Array): number[] {
  const defects: number[] = []
  for (let i = 0; i < stabs.length; i++) {
    let parity = 0
    for (const q of stabs[i].qubits) parity ^= errors[q]
    if (parity) defects.push(i)
  }
  return defects
}

/**
 * Above this many defects the exact subset DP is 2^k·k and stops being interactive:
 * at k = 18 that is 4.7 million operations per channel per shot, which at the Monte
 * Carlo rates on this page is already the dominant cost. Beyond it the decoder falls
 * back to greedy nearest-pair and says so.
 */
export const EXACT_MATCHING_LIMIT = 18

export type Matching = {
  /** Pairs of defect indices (into `defects`); `to = -1` means matched to the boundary. */
  pairs: { from: number; to: number }[]
  /** Total matching weight, in data qubits. */
  weight: number
  exact: boolean
}

/**
 * Minimum-weight perfect matching where every defect may also pair with the boundary.
 *
 * Exact version: a DP over subsets. f(mask) takes the lowest set bit i and either
 * pairs it with the boundary or with some other j in the mask. That is the standard
 * O(2^k·k) matching DP; it is exact, not a heuristic, for k ≤ EXACT_MATCHING_LIMIT.
 */
export function minWeightMatching(
  defects: number[],
  weight: (i: number, j: number) => number,
  boundaryWeight: (i: number) => number
): Matching {
  const k = defects.length
  if (k === 0) return { pairs: [], weight: 0, exact: true }

  if (k <= EXACT_MATCHING_LIMIT) {
    const size = 1 << k
    const best = new Float64Array(size).fill(Infinity)
    // choice[mask] encodes what was done with the lowest set bit: -1 for boundary,
    // otherwise the partner index.
    const choice = new Int32Array(size).fill(-2)
    best[0] = 0
    for (let mask = 1; mask < size; mask++) {
      let i = 0
      while (((mask >> i) & 1) === 0) i++
      const rest = mask & ~(1 << i)
      let bestCost = boundaryWeight(i) + best[rest]
      let bestChoice = -1
      for (let j = i + 1; j < k; j++) {
        if (((mask >> j) & 1) === 0) continue
        const cost = weight(i, j) + best[rest & ~(1 << j)]
        if (cost < bestCost) {
          bestCost = cost
          bestChoice = j
        }
      }
      best[mask] = bestCost
      choice[mask] = bestChoice
    }
    const pairs: { from: number; to: number }[] = []
    let mask = size - 1
    while (mask !== 0) {
      let i = 0
      while (((mask >> i) & 1) === 0) i++
      const j = choice[mask]
      pairs.push({ from: i, to: j })
      mask &= ~(1 << i)
      if (j >= 0) mask &= ~(1 << j)
    }
    return { pairs, weight: best[size - 1], exact: true }
  }

  // Greedy fallback: repeatedly take the cheapest remaining move.
  const remaining = new Set<number>(defects.map((_, i) => i))
  const pairs: { from: number; to: number }[] = []
  let total = 0
  while (remaining.size > 0) {
    let bestCost = Infinity
    let bestI = -1
    let bestJ = -1
    for (const i of remaining) {
      const b = boundaryWeight(i)
      if (b < bestCost) {
        bestCost = b
        bestI = i
        bestJ = -1
      }
      for (const j of remaining) {
        if (j <= i) continue
        const w = weight(i, j)
        if (w < bestCost) {
          bestCost = w
          bestI = i
          bestJ = j
        }
      }
    }
    if (bestI < 0) break
    pairs.push({ from: bestI, to: bestJ })
    total += bestCost
    remaining.delete(bestI)
    if (bestJ >= 0) remaining.delete(bestJ)
  }
  return { pairs, weight: total, exact: false }
}

export type Decoding = {
  defects: number[]
  matching: Matching
  /** Data qubits the decoder proposes to flip. */
  correction: Uint8Array
  /** For drawing: each matched pair as a list of data qubits along its chain. */
  chains: { from: number; to: number; qubits: number[] }[]
}

/**
 * Decode one channel. `type` names the stabilisers doing the *detecting*:
 * type 'Z' decodes X errors, type 'X' decodes Z errors.
 */
export function decodeChannel(code: SurfaceCode, type: StabType, errors: Uint8Array): Decoding {
  const stabs = code.byType[type]
  const graph = code.graphs[type]
  const defects = syndromeOf(stabs, errors)

  const matching = minWeightMatching(
    defects,
    (i, j) => graph.dist[defects[i]][defects[j]],
    (i) => graph.dist[defects[i]][graph.n]
  )

  const correction = new Uint8Array(code.numData)
  const chains: { from: number; to: number; qubits: number[] }[] = []
  for (const pair of matching.pairs) {
    const from = defects[pair.from]
    const to = pair.to < 0 ? graph.n : defects[pair.to]
    const qubits = pathQubits(graph, from, to)
    for (const q of qubits) correction[q] ^= 1
    chains.push({ from, to: pair.to < 0 ? -1 : defects[pair.to], qubits })
  }

  return { defects, matching, correction, chains }
}

/** Parity of the overlap between an error pattern and a logical operator's support. */
export function anticommutes(errors: Uint8Array, support: number[]): boolean {
  let parity = 0
  for (const q of support) parity ^= errors[q]
  return parity === 1
}

export type ShotResult = {
  /** X errors on data qubits, one byte each. */
  errorsX: Uint8Array
  errorsZ: Uint8Array
  /** Decoding of the X channel (detected by Z stabilisers) and the Z channel. */
  decX: Decoding
  decZ: Decoding
  /** error ⊕ correction, per channel. */
  residualX: Uint8Array
  residualZ: Uint8Array
  /** True when the residual chain is a logical operator rather than a stabiliser. */
  logicalXError: boolean
  logicalZError: boolean
  /** True when either channel failed. This is what the Monte Carlo counts. */
  failed: boolean
}

/**
 * One round: sprinkle independent X and Z errors at rate p, decode, and check.
 *
 * DELIBERATELY SIMPLE ERROR MODEL, stated because a reader will assume otherwise:
 * this is a single round of perfect (noiseless) syndrome extraction on an
 * independent X/Z depolarising-like channel. Real hardware measures stabilisers
 * repeatedly with faulty measurements, which is why real thresholds (~1%) are lower
 * than the ~10% this model gives. The qualitative lesson — below threshold, more
 * physical qubits means fewer logical errors; above it, more is worse — is the same
 * in both, and that lesson is what this page is for.
 */
export function runShot(code: SurfaceCode, p: number, rand: () => number): ShotResult {
  const errorsX = new Uint8Array(code.numData)
  const errorsZ = new Uint8Array(code.numData)
  for (let q = 0; q < code.numData; q++) {
    if (rand() < p) errorsX[q] = 1
    if (rand() < p) errorsZ[q] = 1
  }
  return evaluateErrors(code, errorsX, errorsZ)
}

/** The decode-and-check half of `runShot`, for hand-placed errors. */
export function evaluateErrors(
  code: SurfaceCode,
  errorsX: Uint8Array,
  errorsZ: Uint8Array
): ShotResult {
  const decX = decodeChannel(code, 'Z', errorsX)
  const decZ = decodeChannel(code, 'X', errorsZ)

  const residualX = new Uint8Array(code.numData)
  const residualZ = new Uint8Array(code.numData)
  for (let q = 0; q < code.numData; q++) {
    residualX[q] = errorsX[q] ^ decX.correction[q]
    residualZ[q] = errorsZ[q] ^ decZ.correction[q]
  }

  // A residual X chain is a logical X̄ exactly when it anticommutes with Z̄.
  const logicalXError = anticommutes(residualX, code.logicalZ)
  const logicalZError = anticommutes(residualZ, code.logicalX)

  return {
    errorsX,
    errorsZ,
    decX,
    decZ,
    residualX,
    residualZ,
    logicalXError,
    logicalZError,
    failed: logicalXError || logicalZError,
  }
}

/**
 * The cost of a logical qubit, stated as the numbers the page quotes.
 * Physical qubits counts the ancillas: one per stabiliser, d² − 1 of them.
 */
export function qubitCost(d: number): { data: number; ancilla: number; total: number } {
  const data = d * d
  const ancilla = d * d - 1
  return { data, ancilla, total: data + ancilla }
}
