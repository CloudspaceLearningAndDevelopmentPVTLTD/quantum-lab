/**
 * topology.ts — schematic device connectivity, and a transpiled-QASM reader.
 *
 * PURE module: no fetch, no DOM, no React. `DeviceTopology.tsx` renders the
 * sketch this module computes, and `JobMonitor.tsx` uses `parseGateSequence`
 * to show a submitted job's transpiled instruction list. It lives here rather
 * than inside the components so vitest (which collects `lib/**`) can test the
 * geometry and the parser without a renderer.
 *
 * ── WHAT THE SKETCH IS, AND EMPHATICALLY IS NOT ─────────────────────────────
 *
 * Each vendor family wires its qubits in a characteristic pattern, and that
 * pattern is the reason the transpiler inserts SWAPs on one machine and not on
 * another — which is a thing worth SHOWING, not just asserting. But the real
 * coupling map of a specific 127-qubit device is calibration data we do not
 * have offline, changes with every maintenance window, and would be unreadable
 * at this size anyway. So this module draws a SCHEMATIC: a handful of nodes in
 * the family's characteristic arrangement, honestly labelled as such by the
 * component that renders it. Do not "upgrade" it to look like a live device
 * map without actually querying one.
 */

/** The connectivity families this app distinguishes. */
export type TopologyFamily = 'heavy-hex' | 'square-lattice' | 'all-to-all' | 'linear'

/**
 * Backend id → connectivity family.
 *
 * Prefix-matched rather than an exact-id table so the LIVE device lists (IBM
 * names like `ibm_fez`, Braket ARNs containing `/ionq/` or `/rigetti/`) land
 * in the right family too, not only the static catalogue ids.
 */
export function topologyFamilyFor(backendId: string): TopologyFamily {
  const id = backendId.toLowerCase()
  // Trapped ions sit in one shared trap: every ion talks to every other ion.
  if (id.includes('ionq') || id.includes('quantinuum')) return 'all-to-all'
  // IBM's Eagle/Heron processors are heavy-hex lattices.
  if (id.startsWith('ibm')) return 'heavy-hex'
  // Rigetti Ankaa is a square lattice.
  if (id.includes('rigetti') || id.includes('ankaa')) return 'square-lattice'
  // Simulators and anything unrecognised: a plain chain, the most conservative
  // (most SWAP-hungry) assumption and visually the most obviously generic.
  return 'linear'
}

/** Human copy for each family, rendered under the sketch. */
export const TOPOLOGY_BLURB: Record<TopologyFamily, string> = {
  'heavy-hex':
    'Heavy-hex lattice: each qubit touches at most three neighbours. Distant qubits must be connected through chains of SWAPs, which is where transpiled depth comes from.',
  'square-lattice':
    'Square lattice: four neighbours per interior qubit. Fewer SWAPs than heavy-hex, more than a trapped ion needs.',
  'all-to-all':
    'All-to-all: trapped ions share one trap, so any pair can interact directly and the transpiler never inserts routing SWAPs.',
  linear:
    'Linear chain: only nearest neighbours interact — the most routing-hungry layout, and the safe assumption for an unknown device.',
}

export interface TopologyNode {
  x: number
  y: number
}

/** An undirected coupling, as two indices into `nodes`. */
export type TopologyEdge = [number, number]

export interface TopologySketch {
  family: TopologyFamily
  /** Coordinates inside a 0–100 × 0–60 viewBox. */
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Compute the schematic node/edge layout for a family.
 *
 * Node counts are fixed per family — the sketch is an idea, not an inventory,
 * and the rendering component says how many real qubits the device has.
 */
export function topologySketch(family: TopologyFamily): TopologySketch {
  switch (family) {
    case 'all-to-all': {
      // A ring of 7 ions with every chord drawn: n(n-1)/2 = 21 edges.
      const n = 7
      const nodes: TopologyNode[] = []
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2
        nodes.push({ x: round(50 + 26 * Math.cos(angle)), y: round(30 + 26 * Math.sin(angle)) })
      }
      const edges: TopologyEdge[] = []
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([i, j])
      return { family, nodes, edges }
    }
    case 'square-lattice': {
      // A 4×3 grid; horizontal and vertical neighbours only.
      const cols = 4
      const rows = 3
      const nodes: TopologyNode[] = []
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          nodes.push({ x: round(14 + (72 / (cols - 1)) * c), y: round(8 + (44 / (rows - 1)) * r) })
      const edges: TopologyEdge[] = []
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          if (c + 1 < cols) edges.push([i, i + 1])
          if (r + 1 < rows) edges.push([i, i + cols])
        }
      return { family, nodes, edges }
    }
    case 'heavy-hex': {
      // One heavy-hex cell: a hexagon of degree-≤3 vertices with an extra
      // qubit sitting on every edge — the "heavy" part, and the reason IBM
      // qubits have at most three neighbours.
      const corners: TopologyNode[] = []
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2
        corners.push({ x: round(50 + 24 * Math.cos(angle)), y: round(30 + 24 * Math.sin(angle)) })
      }
      const nodes: TopologyNode[] = [...corners]
      const edges: TopologyEdge[] = []
      for (let i = 0; i < 6; i++) {
        const a = corners[i]!
        const b = corners[(i + 1) % 6]!
        // Midpoint qubit on each hexagon edge.
        nodes.push({ x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) })
        const mid = 6 + i
        edges.push([i, mid], [mid, (i + 1) % 6])
      }
      return { family, nodes, edges }
    }
    case 'linear': {
      const n = 6
      const nodes: TopologyNode[] = []
      for (let i = 0; i < n; i++) nodes.push({ x: round(10 + (80 / (n - 1)) * i), y: 30 })
      const edges: TopologyEdge[] = []
      for (let i = 0; i < n - 1; i++) edges.push([i, i + 1])
      return { family, nodes, edges }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Transpiled gate sequence, read from the OpenQASM the API returns
// ────────────────────────────────────────────────────────────

export interface SequenceEntry {
  /** Lower-cased gate name, e.g. 'sx', 'rz', 'cx', 'measure'. */
  gate: string
  /** Qubit indices the instruction touches, in source order. */
  qubits: number[]
}

export interface ParsedSequence {
  entries: SequenceEntry[]
  /** True when the circuit held more instructions than the cap. */
  truncated: boolean
}

/**
 * Statements that are not device operations and are skipped: declarations,
 * headers, includes, barriers (compiler directives) and classical wiring.
 */
const NON_OPERATION = /^(openqasm|include|qubit|bit|creg|qreg|barrier|gate|\/\/|$)/i

/**
 * Read the instruction list out of a TRANSPILED OpenQASM 3 program.
 *
 * This is deliberately not a QASM parser. `transpile_for` in
 * services/api/app/quantum/transpile.py serialises with `qasm3.dumps`, whose
 * output is one flat instruction per line over standard-gate names — no user
 * input, no custom gate defs on the instruction path, no multi-line
 * statements. A line this reader does not recognise is skipped, never guessed
 * at, so the worst failure mode is an entry missing from a display list. (The
 * API also computes this list server-side — `sequence` in `transpile_for` —
 * but the HTTP response model does not carry it yet; when it does, prefer
 * that field and keep this as the fallback.)
 *
 * @param qasm Transpiled OpenQASM 3 source from the API.
 * @param cap  Display cap; matches SEQUENCE_CAP in transpile.py.
 */
export function parseGateSequence(qasm: string, cap = 200): ParsedSequence {
  const entries: SequenceEntry[] = []
  let truncated = false

  for (const raw of qasm.split('\n')) {
    const line = raw.trim().replace(/;$/, '')
    if (line === '' || NON_OPERATION.test(line)) continue

    let gate: string | null = null
    let operands = ''

    // `c[0] = measure q[0];` — OpenQASM 3 measurement into a classical bit.
    const measure = line.match(/^\S+\s*=\s*measure\s+(.+)$/)
    if (measure) {
      gate = 'measure'
      operands = measure[1] ?? ''
    } else {
      // `name(params)? operand, operand` — a plain gate application.
      const gateMatch = line.match(/^([a-zA-Z_][\w]*)\s*(?:\([^)]*\))?\s+(.+)$/)
      if (!gateMatch) continue
      gate = (gateMatch[1] ?? '').toLowerCase()
      operands = gateMatch[2] ?? ''
      if (gate === 'reset' || gate === 'delay') {
        // Kept: they are physical operations on hardware.
      } else if (!/^[a-z]/.test(gate)) {
        continue
      }
    }

    const qubits: number[] = []
    for (const match of operands.matchAll(/\w+\[(\d+)\]/g)) {
      qubits.push(Number.parseInt(match[1] ?? '0', 10))
    }
    // `measure q` (whole-register) has no indices; keep it with an empty list.

    if (entries.length >= cap) {
      truncated = true
      break
    }
    entries.push({ gate, qubits })
  }

  return { entries, truncated }
}

/**
 * Compress a sequence for display: consecutive runs of the same gate on the
 * same qubits collapse to `gate×n`. `rz(π/2) q[0]` three times in a row reads
 * as noise as three lines and as information as one.
 */
export function formatSequence(entries: SequenceEntry[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < entries.length) {
    const entry = entries[i]!
    let run = 1
    while (
      i + run < entries.length &&
      entries[i + run]!.gate === entry.gate &&
      entries[i + run]!.qubits.join(',') === entry.qubits.join(',')
    ) {
      run += 1
    }
    const target = entry.qubits.length > 0 ? ` q${entry.qubits.join(',q')}` : ''
    out.push(run > 1 ? `${entry.gate}${target} ×${run}` : `${entry.gate}${target}`)
    i += run
  }
  return out
}
