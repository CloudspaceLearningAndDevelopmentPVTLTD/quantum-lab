/**
 * topology.ts — hardware coupling maps for the router.
 *
 * WHAT THIS MODELS
 * A real device lets a two-qubit gate act only between qubits that are wired
 * together. That wiring is a graph — the coupling map — and everything a
 * router does is bookkeeping on that graph: which logical qubit sits on which
 * physical one, how far apart two of them are, which SWAP brings them closer.
 * The simulator in lib/quantum.ts has no such notion (every pair is adjacent);
 * this module is where the notion lives.
 *
 * The maps are undirected: a CX in either direction is allowed on an edge. Real
 * devices sometimes prefer one direction, and that is a calibration detail the
 * router here does not model.
 *
 * THE FIVE FAMILIES
 *   linear      0—1—2—…—(n−1). The worst case for routing: distance n−1 corner to corner.
 *   ring        linear plus the (n−1)—0 edge. Halves the worst-case distance.
 *   grid        rows × cols, nearest neighbours. What most superconducting
 *               "square lattice" and neutral-atom layouts look like.
 *   heavy-hex   IBM's lattice (Falcon, Eagle, Heron): rows of linearly wired
 *               qubits joined by "bridge" qubits every four columns, alternating
 *               offset between row gaps. Degree ≤ 3; every hexagon has 12 qubits
 *               on its boundary — six at the corners (degree 3) and six on the
 *               sides (degree 2). See heavyHexMap for the exact numbering.
 *   all-to-all  every pair wired. Trapped-ion devices approximate this; for the
 *               router it is the control case in which no SWAP is ever needed.
 *
 * DISTANCES
 * `distance` is the shortest-path hop count from breadth-first search, computed
 * once per map. A CX between logical qubits sitting at distance d needs d−1
 * SWAPs before it can run — that is the quantity every routing heuristic
 * minimises.
 */

export type TopologyKind = 'linear' | 'ring' | 'grid' | 'heavy-hex' | 'all-to-all'

export const TOPOLOGY_KINDS: readonly TopologyKind[] = [
  'linear',
  'ring',
  'grid',
  'heavy-hex',
  'all-to-all',
]

export interface CouplingMap {
  kind: TopologyKind
  numQubits: number
  /** Undirected edges, each stored once as [low, high]. */
  edges: readonly (readonly [number, number])[]
  /** adjacency[q] = sorted physical neighbours of q. */
  adjacency: readonly (readonly number[])[]
  /** Hop distance between every pair; Infinity when disconnected. */
  distance: readonly (readonly number[])[]
  /** Layout coordinates for drawing, in arbitrary grid units. */
  positions: readonly { x: number; y: number }[]
}

function assertQubitCount(n: number, min = 1): void {
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`a coupling map needs an integer qubit count ≥ ${min}, got ${n}`)
  }
}

/** Breadth-first hop distances from every qubit. O(n · (n + |E|)). */
export function distanceMatrix(n: number, adjacency: readonly (readonly number[])[]): number[][] {
  const out: number[][] = []
  for (let s = 0; s < n; s++) {
    const row = new Array<number>(n).fill(Infinity)
    row[s] = 0
    const queue: number[] = [s]
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head]
      for (const v of adjacency[u]) {
        if (row[v] === Infinity) {
          row[v] = row[u] + 1
          queue.push(v)
        }
      }
    }
    out.push(row)
  }
  return out
}

/** Assemble a CouplingMap from an edge list, deduplicating and sorting. */
export function couplingMapFromEdges(
  kind: TopologyKind,
  numQubits: number,
  rawEdges: readonly (readonly [number, number])[],
  positions: readonly { x: number; y: number }[],
): CouplingMap {
  assertQubitCount(numQubits)
  const seen = new Set<string>()
  const edges: [number, number][] = []
  const adjacency: number[][] = Array.from({ length: numQubits }, () => [])
  for (const [a, b] of rawEdges) {
    if (a === b) continue
    if (a < 0 || b < 0 || a >= numQubits || b >= numQubits) {
      throw new Error(`edge (${a}, ${b}) is outside a ${numQubits}-qubit map`)
    }
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const key = `${lo}-${hi}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push([lo, hi])
    adjacency[lo].push(hi)
    adjacency[hi].push(lo)
  }
  for (const row of adjacency) row.sort((x, y) => x - y)
  edges.sort((e, f) => e[0] - f[0] || e[1] - f[1])
  return {
    kind,
    numQubits,
    edges,
    adjacency,
    distance: distanceMatrix(numQubits, adjacency),
    positions,
  }
}

export function linearMap(n: number): CouplingMap {
  assertQubitCount(n)
  const edges: [number, number][] = []
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1])
  const positions = Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }))
  return couplingMapFromEdges('linear', n, edges, positions)
}

export function ringMap(n: number): CouplingMap {
  assertQubitCount(n)
  const edges: [number, number][] = []
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1])
  if (n >= 3) edges.push([n - 1, 0])
  const positions = Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n - Math.PI / 2
    const r = Math.max(1, n / (2 * Math.PI))
    return { x: r * Math.cos(t), y: r * Math.sin(t) }
  })
  return couplingMapFromEdges('ring', n, edges, positions)
}

/**
 * Row-major grid. Columns default to ⌈√n⌉ so the map is as square as the
 * count allows; the last row may be partial. Qubit q sits at
 * (row ⌊q / cols⌋, col q mod cols).
 */
export function gridMap(n: number, cols = Math.ceil(Math.sqrt(n))): CouplingMap {
  assertQubitCount(n)
  if (!Number.isInteger(cols) || cols < 1) throw new Error(`grid needs ≥ 1 column, got ${cols}`)
  const edges: [number, number][] = []
  const positions: { x: number; y: number }[] = []
  for (let q = 0; q < n; q++) {
    const row = Math.floor(q / cols)
    const col = q % cols
    positions.push({ x: col, y: row })
    if (col + 1 < cols && q + 1 < n) edges.push([q, q + 1])
    if (q + cols < n) edges.push([q, q + cols])
  }
  return couplingMapFromEdges('grid', n, edges, positions)
}

/**
 * Row width for a heavy-hex lattice of n qubits. Bridge columns repeat every
 * four columns, so a width of 4k+1 closes a whole number of hexagons per row
 * pair: 5 gives one hexagon across, 9 gives two, 13 gives three. IBM Eagle
 * uses 15 (three hexagons plus a half). Small maps use 5 so that even 12
 * qubits form a complete hexagon rather than a line with pendants.
 */
export function heavyHexRowWidth(n: number): number {
  if (n <= 30) return 5
  if (n <= 80) return 9
  return 13
}

/**
 * IBM-style heavy-hex lattice with exactly n qubits.
 *
 * NUMBERING (the same scheme as ibm_washington / Eagle, at a smaller width):
 * qubits are numbered row-major — row 0's W qubits left to right, then the
 * bridge qubits below row 0 left to right, then row 1, then its bridges, …
 * Row r has qubits at columns 0…W−1 wired as a chain. Between rows r and r+1
 * there is one bridge qubit at each column c ≡ 0 (mod 4) when r is even, and
 * at each c ≡ 2 (mod 4) when r is odd; the bridge is wired to (r, c) and
 * (r+1, c) only.
 *
 * For W = 5 and n = 12 that gives
 *
 *      0 — 1 — 2 — 3 — 4          row 0
 *      |               |
 *      5               6          bridges (columns 0 and 4)
 *      |               |
 *      7 — 8 — 9 — 10 — 11        row 1
 *
 * a single 12-qubit hexagon, with qubit 12 (if present) hanging below 9 as the
 * column-2 bridge toward row 2.
 *
 * The lattice is cut off after n qubits in that numbering, and the result is
 * always connected: a row prefix is a chain, a bridge attaches to the row
 * above it, and each new row starts at column 0 where an even-gap bridge
 * always exists. Below an odd gap the bridge is at column 2, so a final row
 * cut to fewer than three qubits starts at column 2 instead of column 0.
 */
export function heavyHexMap(n: number, rowWidth = heavyHexRowWidth(n)): CouplingMap {
  assertQubitCount(n)
  const W = rowWidth
  if (!Number.isInteger(W) || W < 3) throw new Error(`heavy-hex row width must be ≥ 3, got ${W}`)

  // Step 1: number the cells. A cell is either a row qubit (row r, column c)
  // or a bridge qubit sitting between rows r and r+1 at column c.
  type Cell = { bridge: boolean; row: number; col: number }
  const cells: Cell[] = []
  for (let row = 0; cells.length < n; row++) {
    // A row below an odd gap is reached only through the column-2 bridge. If
    // the cut-off leaves fewer than three qubits for this row they would start
    // at column 0 and never reach it, so a short final row after an odd gap
    // starts at the bridge column instead. Every other prefix is connected:
    // rows below an even gap start at column 0, where a bridge always is.
    const bridgeCol = row === 0 || row % 2 === 1 ? 0 : 2
    const remaining = n - cells.length
    const start = remaining <= bridgeCol ? bridgeCol : 0
    for (let c = start; c < W && cells.length < n; c++) cells.push({ bridge: false, row, col: c })
    if (cells.length >= n) break
    const offset = row % 2 === 0 ? 0 : 2
    for (let c = offset; c < W && cells.length < n; c += 4) {
      cells.push({ bridge: true, row, col: c })
    }
  }

  // Step 2: wire them. Row qubits chain along the row; a bridge joins the row
  // qubit directly above it to the one directly below it, when each exists.
  const rowIndex = new Map<string, number>()
  cells.forEach((cell, i) => {
    if (!cell.bridge) rowIndex.set(`${cell.row},${cell.col}`, i)
  })
  const edges: [number, number][] = []
  const positions: { x: number; y: number }[] = []
  cells.forEach((cell, i) => {
    if (cell.bridge) {
      positions.push({ x: cell.col, y: 2 * cell.row + 1 })
      const above = rowIndex.get(`${cell.row},${cell.col}`)
      const below = rowIndex.get(`${cell.row + 1},${cell.col}`)
      if (above !== undefined) edges.push([above, i])
      if (below !== undefined) edges.push([i, below])
    } else {
      positions.push({ x: cell.col, y: 2 * cell.row })
      if (cell.col > 0) edges.push([i - 1, i])
    }
  })
  return couplingMapFromEdges('heavy-hex', n, edges, positions)
}

export function allToAllMap(n: number): CouplingMap {
  assertQubitCount(n)
  const edges: [number, number][] = []
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) edges.push([a, b])
  const positions = Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n - Math.PI / 2
    const r = Math.max(1, n / (2 * Math.PI))
    return { x: r * Math.cos(t), y: r * Math.sin(t) }
  })
  return couplingMapFromEdges('all-to-all', n, edges, positions)
}

/** Build a map of the named family with exactly n qubits. */
export function buildTopology(kind: TopologyKind, n: number): CouplingMap {
  switch (kind) {
    case 'linear': return linearMap(n)
    case 'ring': return ringMap(n)
    case 'grid': return gridMap(n)
    case 'heavy-hex': return heavyHexMap(n)
    case 'all-to-all': return allToAllMap(n)
  }
}

export const TOPOLOGY_LABEL: Record<TopologyKind, string> = {
  linear: 'Linear chain',
  ring: 'Ring',
  grid: 'Square grid',
  'heavy-hex': 'IBM heavy-hex',
  'all-to-all': 'All-to-all',
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function neighbours(map: CouplingMap, q: number): readonly number[] {
  const adj = map.adjacency[q]
  if (!adj) throw new Error(`qubit ${q} is not on this ${map.numQubits}-qubit map`)
  return adj
}

export function distance(map: CouplingMap, a: number, b: number): number {
  const row = map.distance[a]
  if (!row || row[b] === undefined) {
    throw new Error(`(${a}, ${b}) is not a pair on this ${map.numQubits}-qubit map`)
  }
  return row[b]
}

export function isEdge(map: CouplingMap, a: number, b: number): boolean {
  if (a === b) return false
  const adj = map.adjacency[a]
  return adj !== undefined && adj.includes(b)
}

/** True when every qubit can reach every other. A disconnected map cannot be routed on. */
export function isConnected(map: CouplingMap): boolean {
  return map.distance[0].every((d) => Number.isFinite(d))
}

/** The largest hop distance on the map (its diameter). */
export function diameter(map: CouplingMap): number {
  let d = 0
  for (const row of map.distance) for (const v of row) if (v > d) d = v
  return d
}

export function degree(map: CouplingMap, q: number): number {
  return neighbours(map, q).length
}
