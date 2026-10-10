/**
 * routing.ts — qubit routing: make a circuit legal on a coupling map.
 *
 * THE PROBLEM
 * A circuit says "CX between logical qubits 0 and 7". The device says "qubit
 * 0 is wired to 1 and 5 only". A router picks where each logical qubit lives
 * (the layout) and inserts SWAPs to walk qubits next to each other before
 * every two-qubit gate. Every SWAP is three CXs the algorithm never asked for,
 * so the score is simple: fewest added SWAPs, shallowest result.
 *
 * TWO ROUTERS, ONE LOOP
 * Both routers here run the same loop — keep a front layer of gates whose
 * dependencies are done, execute what is executable, and when nothing is,
 * pick ONE swap from the candidates touching the front layer. They differ
 * only in how that swap is picked:
 *
 *   · sabreRoute — the heuristic from Li, Ding & Xie, "Tackling the Qubit
 *     Mapping Problem for NISQ-Era Quantum Devices" (ASPLOS 2019): score each
 *     candidate by the distance sum of the front layer after the swap, plus a
 *     down-weighted look-ahead over the next few gates, plus a penalty that
 *     discourages swapping the same qubit twice in a row (SABRE multiplies by
 *     a decay factor; the penalty here is additive so the learned policy can
 *     start from exactly this ranking). The initial
 *     layout comes from SABRE's forward–backward trick: route once from the
 *     identity layout, route the reversed circuit from where that ended, and
 *     start the real pass from where THAT ended.
 *
 *   · the learned router — a softmax policy over the same candidates, fed
 *     five hand-built features of each candidate (how much it shortens the
 *     front layer, the look-ahead, how many gates it unblocks, how recently
 *     its qubits moved, whether it undoes the last swap). It is initialised so
 *     that its ranking IS the SABRE ranking, then trained by REINFORCE on the
 *     final two-qubit count and depth of whole routed circuits, relative to
 *     the heuristic. It is a few dozen numbers, deliberately: the point is to
 *     show the shape of "learn the swap policy, reward the compiled circuit",
 *     which is what IBM's AI transpiler passes do at 100+ qubits with a much
 *     larger model, and to let a developer watch it beat or fail to beat the
 *     heuristic on their own circuit.
 *
 * WHAT IS GUARANTEED
 * A routed circuit is valid on the map (every two-qubit op sits on an edge —
 * `validateOnMap`) and equals the original up to the reported initial and
 * final layouts (`routedEquivalent` checks this with the statevector engine).
 * routing.test.ts holds both to every router on every map family.
 *
 * WHAT IS NOT MODELLED
 * Gate direction, per-edge error rates, gate cancellation and commutation
 * beyond "gates on disjoint qubits commute", and any gate with three qubits —
 * a Toffoli is expanded to the standard six-CX form before routing
 * (`expandForRouting`), which is what a real transpiler does too.
 */

import {
  GATE_BY_NAME,
  StateVector,
  mulberry32,
  type Circuit,
  type Complex,
  type GateOp,
} from '@/lib/quantum'
import { diameter, isConnected, isEdge, type CouplingMap } from './topology'

// ────────────────────────────────────────────────────────────
// Metrics
// ────────────────────────────────────────────────────────────

export interface RoutingMetrics {
  /** Every op except barriers. */
  ops: number
  /** Two-qubit gates with a SWAP counted as the three CXs it compiles to. */
  twoQubitGates: number
  /** SWAP ops in the circuit. */
  swaps: number
  /** Critical-path length with a SWAP costing three layers, everything else one. */
  depth: number
}

/** Layers one op occupies on the critical path. */
function opCost(op: GateOp): number {
  if (op.name === 'BARRIER') return 0
  if (op.name === 'SWAP') return 3
  if (op.name === 'CCX') return 6
  return 1
}

/** Two-qubit-gate equivalent of one op. */
function twoQubitCost(op: GateOp): number {
  switch (op.name) {
    case 'CX':
    case 'CY':
    case 'CZ':
      return 1
    case 'SWAP':
      return 3
    case 'CCX':
      return 6
    default:
      return 0
  }
}

export function circuitMetrics(circuit: Circuit): RoutingMetrics {
  const busyUntil = new Array<number>(circuit.numQubits).fill(0)
  let depth = 0
  let ops = 0
  let twoQubitGates = 0
  let swaps = 0
  for (const op of circuit.ops) {
    if (op.name === 'BARRIER') continue
    ops++
    twoQubitGates += twoQubitCost(op)
    if (op.name === 'SWAP') swaps++
    let start = 0
    for (const q of op.qubits) start = Math.max(start, busyUntil[q] ?? 0)
    const end = start + opCost(op)
    for (const q of op.qubits) busyUntil[q] = end
    depth = Math.max(depth, end)
  }
  return { ops, twoQubitGates, swaps, depth }
}

// ────────────────────────────────────────────────────────────
// Preprocessing
// ────────────────────────────────────────────────────────────

/**
 * The textbook Toffoli decomposition (Nielsen & Chuang fig. 4.9): six CX,
 * seven T/T†, two H. Exact, not approximate — routing.test.ts checks it
 * against the simulator's own CCX on every basis state.
 */
export function decomposeToffoli(a: number, b: number, t: number): GateOp[] {
  return [
    { name: 'H', qubits: [t] },
    { name: 'CX', qubits: [b, t] },
    { name: 'TDG', qubits: [t] },
    { name: 'CX', qubits: [a, t] },
    { name: 'T', qubits: [t] },
    { name: 'CX', qubits: [b, t] },
    { name: 'TDG', qubits: [t] },
    { name: 'CX', qubits: [a, t] },
    { name: 'T', qubits: [b] },
    { name: 'T', qubits: [t] },
    { name: 'H', qubits: [t] },
    { name: 'CX', qubits: [a, b] },
    { name: 'T', qubits: [a] },
    { name: 'TDG', qubits: [b] },
    { name: 'CX', qubits: [a, b] },
  ]
}

/**
 * The circuit the router actually sees: barriers dropped, Toffolis expanded,
 * everything else untouched. Throws on an op the simulator would reject too
 * (wrong operand count), so a bad paste fails here rather than mid-route.
 */
export function expandForRouting(circuit: Circuit): Circuit {
  const ops: GateOp[] = []
  for (const op of circuit.ops) {
    if (op.name === 'BARRIER') continue
    const arity = GATE_BY_NAME[op.name]?.arity ?? 1
    if (op.qubits.length !== arity) {
      throw new Error(`${op.name} takes ${arity} qubit(s), got ${op.qubits.length}`)
    }
    for (const q of op.qubits) {
      if (!Number.isInteger(q) || q < 0 || q >= circuit.numQubits) {
        throw new Error(`qubit ${q} is outside the ${circuit.numQubits}-qubit register`)
      }
    }
    if (op.name === 'CCX') {
      if (op.condition) {
        throw new Error('a classically controlled Toffoli cannot be expanded for routing')
      }
      ops.push(...decomposeToffoli(op.qubits[0], op.qubits[1], op.qubits[2]))
      continue
    }
    if (op.name === 'SWAP' && op.qubits[0] === op.qubits[1]) continue
    ops.push(op)
  }
  const out: Circuit = { numQubits: circuit.numQubits, ops }
  if (circuit.numClbits !== undefined) out.numClbits = circuit.numClbits
  return out
}

// ────────────────────────────────────────────────────────────
// Dependency graph
// ────────────────────────────────────────────────────────────

interface DagNode {
  id: number
  op: GateOp
  preds: number[]
  succs: number[]
  twoQubit: boolean
}

/**
 * Ops depend on the previous op on each of their qubits, and — so that a
 * measurement never drifts past a gate that reads its bit — on the classical
 * register the same way (write-after-read, read-after-write, write-after-write).
 */
function buildDag(ops: readonly GateOp[]): DagNode[] {
  const nodes: DagNode[] = ops.map((op, id) => ({
    id,
    op,
    preds: [],
    succs: [],
    twoQubit: op.qubits.length === 2,
  }))
  const lastOnQubit = new Map<number, number>()
  const lastWriter = new Map<number, number>()
  const readersSinceWrite = new Map<number, number[]>()
  const link = (from: number, to: number) => {
    if (from === to) return
    if (!nodes[to].preds.includes(from)) {
      nodes[to].preds.push(from)
      nodes[from].succs.push(to)
    }
  }
  nodes.forEach((node) => {
    const { op, id } = node
    for (const q of op.qubits) {
      const prev = lastOnQubit.get(q)
      if (prev !== undefined) link(prev, id)
      lastOnQubit.set(q, id)
    }
    if (op.condition) {
      const bit = op.condition.bit
      const w = lastWriter.get(bit)
      if (w !== undefined) link(w, id)
      const readers = readersSinceWrite.get(bit) ?? []
      readers.push(id)
      readersSinceWrite.set(bit, readers)
    }
    if (op.name === 'MEASURE' && op.clbit !== undefined) {
      const bit = op.clbit
      const w = lastWriter.get(bit)
      if (w !== undefined) link(w, id)
      for (const r of readersSinceWrite.get(bit) ?? []) link(r, id)
      lastWriter.set(bit, id)
      readersSinceWrite.set(bit, [])
    }
  })
  return nodes
}

// ────────────────────────────────────────────────────────────
// The routing loop
// ────────────────────────────────────────────────────────────

/** Number of features per swap candidate. */
export const POLICY_FEATURES = 8

export interface SwapCandidate {
  /** Physical qubits swapped; always an edge of the map. */
  a: number
  b: number
  /**
   * [Δ front distance (per gate), Δ look-ahead distance (per gate),
   *  fraction of front gates made executable, recency of a/b (0 = fresh),
   *  1 if this undoes the previous swap, Δ distance of the oldest front gate,
   *  mean degree of a and b over the map's maximum, 1 if a or b holds no
   *  logical qubit]
   */
  features: number[]
  /** SABRE score — lower is better. */
  heuristic: number
}

export interface SwapDecision {
  candidates: SwapCandidate[]
  chosen: number
}

/** Picks an index into `candidates`. */
export type SwapChooser = (candidates: SwapCandidate[], step: number) => number

export interface RouteLoopOptions {
  /** Two-qubit gates in the look-ahead set. SABRE's paper uses 20. */
  lookahead: number
  /** Weight of the look-ahead sum relative to the front layer. */
  extendedWeight: number
  /** Added to a qubit's decay each time it is swapped; reset when a gate executes. */
  decayDelta: number
  /** Give up (return null) after this many swaps — a runaway policy, not a valid route. */
  maxSwaps: number
  /** Record every decision, for the policy gradient. */
  recordDecisions: boolean
}

export interface RoutedCircuit {
  /** The physical circuit: numQubits = map.numQubits, every 2Q op on an edge. */
  circuit: Circuit
  /** initialLayout[logical] = physical qubit it starts on. */
  initialLayout: number[]
  /** finalLayout[logical] = physical qubit it ends on. */
  finalLayout: number[]
  swapsAdded: number
  metrics: RoutingMetrics
}

interface LoopResult {
  routed: RoutedCircuit
  decisions: SwapDecision[]
}

function identityLayout(numLogical: number): number[] {
  return Array.from({ length: numLogical }, (_, i) => i)
}

function assertLayout(layout: readonly number[], numLogical: number, numPhysical: number): void {
  if (layout.length !== numLogical) {
    throw new Error(`layout has ${layout.length} entries for ${numLogical} logical qubits`)
  }
  const seen = new Set<number>()
  for (const p of layout) {
    if (!Number.isInteger(p) || p < 0 || p >= numPhysical || seen.has(p)) {
      throw new Error(`layout ${JSON.stringify(layout)} is not an injection into ${numPhysical} physical qubits`)
    }
    seen.add(p)
  }
}

/**
 * One full pass of the routing loop. Pure apart from `chooser`, which may be
 * stochastic. Returns null only when `maxSwaps` is exceeded.
 */
function routeLoop(
  dag: readonly DagNode[],
  numLogical: number,
  map: CouplingMap,
  initialLayout: readonly number[],
  chooser: SwapChooser,
  options: RouteLoopOptions,
): LoopResult | null {
  const P = map.numQubits
  const layout = initialLayout.slice()
  const phys2log = new Array<number>(P).fill(-1)
  layout.forEach((p, q) => { phys2log[p] = q })

  const predsLeft = dag.map((n) => n.preds.length)
  const done = new Array<boolean>(dag.length).fill(false)
  let front: number[] = dag.filter((n) => n.preds.length === 0).map((n) => n.id)
  const output: GateOp[] = []
  const decay = new Float64Array(P)
  const decisions: SwapDecision[] = []
  let swaps = 0
  let remaining = dag.length
  let lastSwap: [number, number] | null = null
  let step = 0

  const phys = (node: DagNode) => node.op.qubits.map((q) => layout[q])

  const executable = (node: DagNode): boolean => {
    if (!node.twoQubit) return true
    const [a, b] = phys(node)
    return isEdge(map, a, b)
  }

  const emit = (node: DagNode): void => {
    const op: GateOp = { ...node.op, qubits: phys(node) }
    output.push(op)
    done[node.id] = true
    remaining--
    for (const s of node.succs) {
      predsLeft[s]--
      if (predsLeft[s] === 0) front.push(s)
    }
  }

  /** Two-qubit gates reachable within `lookahead` of the front layer. */
  const extendedSet = (): DagNode[] => {
    const out: DagNode[] = []
    const seen = new Set<number>()
    const queue: number[] = []
    for (const f of front) for (const s of dag[f].succs) if (!seen.has(s)) { seen.add(s); queue.push(s) }
    for (let head = 0; head < queue.length && out.length < options.lookahead; head++) {
      const node = dag[queue[head]]
      if (done[node.id]) continue
      if (node.twoQubit) out.push(node)
      for (const s of node.succs) if (!seen.has(s)) { seen.add(s); queue.push(s) }
    }
    return out
  }

  while (remaining > 0) {
    // 1. Execute everything in the front layer that can run.
    let progressed = false
    const snapshot = front
    front = []
    for (const id of snapshot) {
      const node = dag[id]
      if (executable(node)) {
        emit(node)
        progressed = true
      } else {
        front.push(id)
      }
    }
    if (progressed) {
      decay.fill(0)
      continue
    }

    // 2. Nothing runs: every front gate is a blocked two-qubit gate. Pick a swap.
    const frontGates = front.map((id) => dag[id])
    const ext = extendedSet()
    const candidates = enumerateCandidates(frontGates, ext, layout, phys2log, map, decay, lastSwap, options)
    if (candidates.length === 0) {
      throw new Error('no swap candidate — is the coupling map connected?')
    }
    const chosen = chooser(candidates, step++)
    if (!Number.isInteger(chosen) || chosen < 0 || chosen >= candidates.length) {
      throw new Error(`chooser returned ${chosen} for ${candidates.length} candidates`)
    }
    if (options.recordDecisions) decisions.push({ candidates, chosen })
    const { a, b } = candidates[chosen]
    output.push({ name: 'SWAP', qubits: [a, b] })
    swaps++
    if (swaps > options.maxSwaps) return null
    const la = phys2log[a]
    const lb = phys2log[b]
    phys2log[a] = lb
    phys2log[b] = la
    if (la >= 0) layout[la] = b
    if (lb >= 0) layout[lb] = a
    decay[a] += options.decayDelta
    decay[b] += options.decayDelta
    lastSwap = [a, b]
  }

  const circuit: Circuit = { numQubits: P, ops: output }
  return {
    routed: {
      circuit,
      initialLayout: initialLayout.slice(),
      finalLayout: layout,
      swapsAdded: swaps,
      metrics: circuitMetrics(circuit),
    },
    decisions,
  }
}

function enumerateCandidates(
  frontGates: readonly DagNode[],
  ext: readonly DagNode[],
  layout: readonly number[],
  phys2log: readonly number[],
  map: CouplingMap,
  decay: Float64Array,
  lastSwap: readonly [number, number] | null,
  options: RouteLoopOptions,
): SwapCandidate[] {
  const D = map.distance
  let maxDegree = 1
  for (const adj of map.adjacency) maxDegree = Math.max(maxDegree, adj.length)
  const pairs = (nodes: readonly DagNode[]): [number, number][] =>
    nodes.map((n) => [layout[n.op.qubits[0]], layout[n.op.qubits[1]]])
  const frontPairs = pairs(frontGates)
  const extPairs = pairs(ext)
  const sum = (ps: readonly [number, number][], a: number, b: number): number => {
    let s = 0
    for (const [p, q] of ps) {
      const p2 = p === a ? b : p === b ? a : p
      const q2 = q === a ? b : q === b ? a : q
      s += D[p2][q2]
    }
    return s
  }
  const frontBefore = sum(frontPairs, -1, -1)
  const extBefore = sum(extPairs, -1, -1)
  const nF = Math.max(1, frontPairs.length)
  const nE = Math.max(1, extPairs.length)

  const seen = new Set<string>()
  const out: SwapCandidate[] = []
  for (const [p, q] of frontPairs) {
    for (const x of [p, q]) {
      for (const y of map.adjacency[x]) {
        const a = Math.min(x, y)
        const b = Math.max(x, y)
        const key = `${a}-${b}`
        if (seen.has(key)) continue
        seen.add(key)
        const frontAfter = sum(frontPairs, a, b)
        const extAfter = sum(extPairs, a, b)
        let unblocked = 0
        for (const [fp, fq] of frontPairs) {
          const p2 = fp === a ? b : fp === b ? a : fp
          const q2 = fq === a ? b : fq === b ? a : fq
          if (D[p2][q2] === 1) unblocked++
        }
        const recency = Math.max(decay[a], decay[b])
        const undo = lastSwap !== null && lastSwap[0] === a && lastSwap[1] === b ? 1 : 0
        // The oldest blocked gate heads the front layer: the front is rebuilt
        // in order each pass, so index 0 is the one that has waited longest.
        const [op, oq] = frontPairs[0]
        const op2 = op === a ? b : op === b ? a : op
        const oq2 = oq === a ? b : oq === b ? a : oq
        const oldestDelta = D[op2][oq2] - D[op][oq]
        const meanDegree = (map.adjacency[a].length + map.adjacency[b].length) / (2 * maxDegree)
        const emptyMove = phys2log[a] < 0 || phys2log[b] < 0 ? 1 : 0
        const features = [
          (frontAfter - frontBefore) / nF,
          (extAfter - extBefore) / nE,
          unblocked / nF,
          recency,
          undo,
          oldestDelta,
          meanDegree,
          emptyMove,
        ]
        // SABRE proper multiplies by (1 + recency); an additive penalty keeps
        // the score an affine function of the feature vector, so the learned
        // policy's starting weights reproduce this ranking exactly.
        const heuristic =
          frontAfter / nF +
          (options.extendedWeight * extAfter) / nE +
          RECENCY_PENALTY * recency +
          UNDO_PENALTY * undo
        out.push({ a, b, features, heuristic })
      }
    }
  }
  return out
}

/** Score penalties for swapping a recently moved qubit and for undoing the last swap. */
export const RECENCY_PENALTY = 0.125
export const UNDO_PENALTY = 0.25

export const DEFAULT_LOOP_OPTIONS: Omit<RouteLoopOptions, 'maxSwaps'> = {
  lookahead: 20,
  extendedWeight: 0.5,
  decayDelta: 0.1,
  recordDecisions: false,
}

function swapCap(dag: readonly DagNode[], map: CouplingMap): number {
  const twoQ = dag.filter((n) => n.twoQubit).length
  return 10 * (twoQ + 1) * (diameter(map) + 1)
}

/** Argmin of the SABRE score; ties broken uniformly at random (seeded). */
export function heuristicChooser(rng: () => number): SwapChooser {
  return (candidates) => {
    let best = Infinity
    let ties: number[] = []
    candidates.forEach((c, i) => {
      if (c.heuristic < best - 1e-12) {
        best = c.heuristic
        ties = [i]
      } else if (Math.abs(c.heuristic - best) <= 1e-12) {
        ties.push(i)
      }
    })
    return ties[Math.floor(rng() * ties.length) % ties.length]
  }
}

function prepare(circuit: Circuit, map: CouplingMap): { dag: DagNode[]; numLogical: number } {
  if (!isConnected(map)) throw new Error('the coupling map is not connected; nothing can be routed on it')
  if (circuit.numQubits > map.numQubits) {
    throw new Error(
      `the circuit needs ${circuit.numQubits} qubits but the map has ${map.numQubits}`,
    )
  }
  const expanded = expandForRouting(circuit)
  return { dag: buildDag(expanded.ops), numLogical: expanded.numQubits }
}

function reversedDag(dag: readonly DagNode[]): DagNode[] {
  // Only the qubit structure matters for a layout pass, so the reversed
  // circuit is the op list backwards with its classical bookkeeping intact.
  return buildDag(dag.map((n) => n.op).reverse())
}

// ────────────────────────────────────────────────────────────
// Heuristic router
// ────────────────────────────────────────────────────────────

export interface SabreOptions {
  seed?: number
  /** Forward/backward layout passes before the real one. 0 = identity layout. */
  layoutPasses?: number
  lookahead?: number
  extendedWeight?: number
  /** Skip the layout search and start from this logical→physical map. */
  initialLayout?: readonly number[]
}

/**
 * SABRE: choose an initial layout by routing forward and backward, then route
 * for real. Deterministic for a given seed.
 */
export function sabreRoute(circuit: Circuit, map: CouplingMap, options: SabreOptions = {}): RoutedCircuit {
  const { dag, numLogical } = prepare(circuit, map)
  const rng = mulberry32(options.seed ?? 1)
  const loopOptions: RouteLoopOptions = {
    ...DEFAULT_LOOP_OPTIONS,
    lookahead: options.lookahead ?? DEFAULT_LOOP_OPTIONS.lookahead,
    extendedWeight: options.extendedWeight ?? DEFAULT_LOOP_OPTIONS.extendedWeight,
    maxSwaps: swapCap(dag, map),
  }
  const chooser = heuristicChooser(rng)

  let layout: number[]
  if (options.initialLayout) {
    assertLayout(options.initialLayout, numLogical, map.numQubits)
    layout = options.initialLayout.slice()
  } else {
    layout = identityLayout(numLogical)
    const passes = options.layoutPasses ?? 2
    const back = passes > 1 ? reversedDag(dag) : null
    for (let pass = 0; pass < passes; pass++) {
      const target = pass % 2 === 0 ? dag : (back as DagNode[])
      const res = routeLoop(target, numLogical, map, layout, chooser, loopOptions)
      if (!res) break
      layout = res.routed.finalLayout
    }
  }

  const res = routeLoop(dag, numLogical, map, layout, chooser, loopOptions)
  if (!res) throw new Error('the heuristic router exceeded its swap budget')
  return res.routed
}

// ────────────────────────────────────────────────────────────
// Learned router — softmax policy + REINFORCE
// ────────────────────────────────────────────────────────────

/**
 * Policy weights that reproduce the heuristic ranking exactly: the heuristic
 * score is Δfront + W·Δext + RECENCY_PENALTY·recency + UNDO_PENALTY·undo up
 * to a constant shared by every candidate, and these logits are −8 times
 * that, so argmax(logits) = argmin(score). The ×8 is a temperature: at 8 the
 * sampled policy picks the heuristic's choice most of the time, which is what
 * "initialised from the heuristic" means here.
 */
export function heuristicPolicyWeights(extendedWeight = DEFAULT_LOOP_OPTIONS.extendedWeight): number[] {
  const k = -8
  return [k, k * extendedWeight, 0, k * RECENCY_PENALTY, k * UNDO_PENALTY, 0, 0, 0]
}

export function softmax(logits: readonly number[]): number[] {
  let max = -Infinity
  for (const l of logits) if (l > max) max = l
  const exps = logits.map((l) => Math.exp(l - max))
  const z = exps.reduce((s, e) => s + e, 0)
  return exps.map((e) => e / z)
}

export function policyLogits(theta: readonly number[], candidates: readonly SwapCandidate[]): number[] {
  return candidates.map((c) => {
    let s = 0
    for (let i = 0; i < theta.length; i++) s += theta[i] * c.features[i]
    return s
  })
}

/**
 * ∇θ log π(chosen | candidates) for a linear softmax policy:
 * φ_chosen − Σ_j π_j φ_j.
 */
export function logPolicyGradient(
  theta: readonly number[],
  candidates: readonly SwapCandidate[],
  chosen: number,
): number[] {
  const probs = softmax(policyLogits(theta, candidates))
  const grad = candidates[chosen].features.slice()
  for (let i = 0; i < grad.length; i++) {
    let expected = 0
    for (let j = 0; j < candidates.length; j++) expected += probs[j] * candidates[j].features[i]
    grad[i] -= expected
  }
  return grad
}

export function greedyPolicyChooser(theta: readonly number[]): SwapChooser {
  return (candidates) => {
    const logits = policyLogits(theta, candidates)
    let best = 0
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i
    return best
  }
}

export function samplingPolicyChooser(theta: readonly number[], rng: () => number): SwapChooser {
  return (candidates) => {
    const probs = softmax(policyLogits(theta, candidates))
    const u = rng()
    let acc = 0
    for (let i = 0; i < probs.length; i++) {
      acc += probs[i]
      if (u < acc) return i
    }
    return probs.length - 1
  }
}

export interface TrainOptions {
  seed?: number
  /** REINFORCE step size. */
  learningRate?: number
  /** Weight of depth against two-qubit count in the reward. */
  depthWeight?: number
  /** Start here instead of the heuristic's own layout search. */
  initialLayout?: readonly number[]
  lookahead?: number
  extendedWeight?: number
}

export interface TrainProgress {
  episode: number
  /** This episode's reward (−1 = parity with the heuristic; higher is better). */
  reward: number
  /** Running baseline the advantage is measured against. */
  baseline: number
  /** SWAPs added in this episode, or null if it blew the swap budget. */
  swapsThisEpisode: number | null
  /** Best sampled episode so far. */
  bestSampledSwaps: number
}

export interface LearnedRouting {
  /** The better of `greedy` and `bestSampled` by the training reward. */
  routed: RoutedCircuit
  /** Argmax rollout of the trained policy. */
  greedy: RoutedCircuit
  /** Best circuit any sampled episode produced. */
  bestSampled: RoutedCircuit
  /** Which of the two `routed` is. */
  source: 'greedy' | 'sampled'
  /** The heuristic baseline the reward is measured against. */
  heuristic: RoutedCircuit
  theta: number[]
  episodes: number
  rewards: number[]
}

export interface RouterTrainer {
  /** Run one episode and one policy update. */
  episode(): TrainProgress
  readonly episodes: number
  readonly theta: readonly number[]
  readonly heuristic: RoutedCircuit
  /** Greedy rollout of the current policy plus the best sample so far. */
  result(): LearnedRouting
}

/** Reward: −(2Q + w·depth) scaled so the heuristic scores exactly −1. */
function rewardOf(m: RoutingMetrics, base: RoutingMetrics, depthWeight: number): number {
  const cost = m.twoQubitGates + depthWeight * m.depth
  const baseCost = base.twoQubitGates + depthWeight * base.depth
  return -cost / Math.max(1, baseCost)
}

/**
 * Build a trainer. Each `episode()` samples one routing from the current
 * policy, scores it against the heuristic, and takes one REINFORCE step. Call
 * it in a loop with whatever budget you like; nothing here blocks for longer
 * than one episode, so a worker can yield between calls.
 */
export function createRouterTrainer(
  circuit: Circuit,
  map: CouplingMap,
  options: TrainOptions = {},
): RouterTrainer {
  const { dag, numLogical } = prepare(circuit, map)
  const seed = options.seed ?? 1
  const depthWeight = options.depthWeight ?? 0.5
  const lr = options.learningRate ?? 0.5
  const loopOptions: RouteLoopOptions = {
    ...DEFAULT_LOOP_OPTIONS,
    lookahead: options.lookahead ?? DEFAULT_LOOP_OPTIONS.lookahead,
    extendedWeight: options.extendedWeight ?? DEFAULT_LOOP_OPTIONS.extendedWeight,
    maxSwaps: swapCap(dag, map),
    recordDecisions: true,
  }

  // The heuristic sets the layout and the baseline; the policy competes on
  // swap choice alone, from the same starting position.
  const heuristic = sabreRoute(circuit, map, {
    seed,
    initialLayout: options.initialLayout,
    lookahead: loopOptions.lookahead,
    extendedWeight: loopOptions.extendedWeight,
  })
  const layout = heuristic.initialLayout
  const baseMetrics = heuristic.metrics
  // A runaway episode is capped well below the loop's own cap: it is a
  // signal to the policy, not a hang for the user.
  const episodeOptions: RouteLoopOptions = {
    ...loopOptions,
    maxSwaps: Math.min(loopOptions.maxSwaps, 3 * (heuristic.swapsAdded + numLogical) + 20),
  }

  const theta = heuristicPolicyWeights(loopOptions.extendedWeight)
  const rng = mulberry32(seed ^ 0x9e3779b9)
  let episodes = 0
  let baseline = -1
  const rewards: number[] = []
  let bestSampled: RoutedCircuit | null = null
  let bestSampledReward = -Infinity

  const episode = (): TrainProgress => {
    const res = routeLoop(dag, numLogical, map, layout, samplingPolicyChooser(theta, rng), episodeOptions)
    let reward: number
    let decisions: SwapDecision[] = []
    let swapsThisEpisode: number | null = null
    if (res) {
      reward = rewardOf(res.routed.metrics, baseMetrics, depthWeight)
      decisions = res.decisions
      swapsThisEpisode = res.routed.swapsAdded
      if (reward > bestSampledReward) {
        bestSampledReward = reward
        bestSampled = res.routed
      }
    } else {
      reward = -2
    }
    const advantage = reward - baseline
    if (decisions.length > 0) {
      const grad = new Array<number>(theta.length).fill(0)
      for (const d of decisions) {
        const g = logPolicyGradient(theta, d.candidates, d.chosen)
        for (let i = 0; i < grad.length; i++) grad[i] += g[i]
      }
      // Sum over the trajectory, clipped so one wild episode cannot throw the
      // policy off the heuristic it started from.
      let norm = 0
      for (const g of grad) norm += g * g
      norm = Math.sqrt(norm)
      const scale = norm > 10 ? 10 / norm : 1
      for (let i = 0; i < theta.length; i++) theta[i] += lr * advantage * grad[i] * scale
    }
    baseline = 0.9 * baseline + 0.1 * reward
    episodes++
    rewards.push(reward)
    return {
      episode: episodes,
      reward,
      baseline,
      swapsThisEpisode,
      bestSampledSwaps: bestSampled ? bestSampled.swapsAdded : Infinity,
    }
  }

  const result = (): LearnedRouting => {
    const g = routeLoop(dag, numLogical, map, layout, greedyPolicyChooser(theta), loopOptions)
    // A greedy rollout that exceeds the cap has no circuit to show, and before
    // any episode has completed there is no sample either; the heuristic's own
    // routing stands in so the result is always a complete, valid circuit.
    const sampled = bestSampled ?? heuristic
    const greedy = g ? g.routed : sampled
    const greedyReward = rewardOf(greedy.metrics, baseMetrics, depthWeight)
    const sampledReward = rewardOf(sampled.metrics, baseMetrics, depthWeight)
    const useGreedy = greedyReward >= sampledReward
    return {
      routed: useGreedy ? greedy : sampled,
      greedy,
      bestSampled: sampled,
      source: useGreedy ? 'greedy' : 'sampled',
      heuristic,
      theta: theta.slice(),
      episodes,
      rewards: rewards.slice(),
    }
  }

  return {
    episode,
    get episodes() { return episodes },
    get theta() { return theta },
    heuristic,
    result,
  }
}

/** Convenience: train for a fixed number of episodes and return the result. */
export function trainLearnedRouter(
  circuit: Circuit,
  map: CouplingMap,
  episodes: number,
  options: TrainOptions = {},
): LearnedRouting {
  const trainer = createRouterTrainer(circuit, map, options)
  for (let i = 0; i < episodes; i++) trainer.episode()
  return trainer.result()
}

// ────────────────────────────────────────────────────────────
// Verification
// ────────────────────────────────────────────────────────────

/** Indices of ops that are not legal on the map (2Q ops off an edge, 3Q ops). */
export function validateOnMap(circuit: Circuit, map: CouplingMap): number[] {
  const bad: number[] = []
  circuit.ops.forEach((op, i) => {
    if (op.qubits.length >= 3) { bad.push(i); return }
    if (op.qubits.length === 2 && !isEdge(map, op.qubits[0], op.qubits[1])) bad.push(i)
  })
  return bad
}

/**
 * Embed an n-qubit logical state into a P-qubit physical register, logical
 * qubit q landing on physical qubit layout[q]; unmapped physical qubits are |0⟩.
 */
export function embedState(
  logical: StateVector,
  layout: readonly number[],
  numPhysical: number,
): StateVector {
  assertLayout(layout, logical.numQubits, numPhysical)
  const amps: Complex[] = Array.from({ length: 1 << numPhysical }, () => ({ re: 0, im: 0 }))
  for (let l = 0; l < logical.dim; l++) {
    let p = 0
    for (let q = 0; q < logical.numQubits; q++) if ((l >> q) & 1) p |= 1 << layout[q]
    amps[p] = logical.amplitude(l)
  }
  return StateVector.fromAmplitudes(amps)
}

function randomState(numQubits: number, rng: () => number): StateVector {
  const amps: Complex[] = []
  let norm = 0
  for (let i = 0; i < 1 << numQubits; i++) {
    // Box–Muller for a rotation-invariant (Haar-like) direction.
    const u1 = Math.max(1e-12, rng())
    const u2 = rng()
    const r = Math.sqrt(-2 * Math.log(u1))
    const re = r * Math.cos(2 * Math.PI * u2)
    const im = r * Math.sin(2 * Math.PI * u2)
    amps.push({ re, im })
    norm += re * re + im * im
  }
  norm = Math.sqrt(norm)
  return StateVector.fromAmplitudes(amps.map((a) => ({ re: a.re / norm, im: a.im / norm })))
}

export interface EquivalenceReport {
  equivalent: boolean
  /** Largest amplitude discrepancy over the trials. */
  maxError: number
  trials: number
}

/**
 * Does the routed circuit compute the original, up to its reported layouts?
 * Checks U_routed · embed(ψ, initial) = embed(U_original · ψ, final) on
 * random states — a random state hits every matrix element, so one trial
 * failing with probability 0 is already conclusive; two are run anyway.
 * Requires the physical register to fit the simulator (≤ 16 qubits) and a
 * circuit without measurements or classical control.
 */
export function routedEquivalent(
  original: Circuit,
  routed: RoutedCircuit,
  options: { trials?: number; seed?: number; tolerance?: number } = {},
): EquivalenceReport {
  const trials = options.trials ?? 2
  const tolerance = options.tolerance ?? 1e-9
  const rng = mulberry32(options.seed ?? 7)
  const logical = expandForRouting(original)
  const P = routed.circuit.numQubits
  if (P > 16) throw new Error('equivalence check needs a physical register of at most 16 qubits')
  for (const op of [...logical.ops, ...routed.circuit.ops]) {
    if (op.condition || op.name === 'MEASURE') {
      throw new Error('equivalence check needs a circuit without measurements or classical control')
    }
  }
  let maxError = 0
  for (let t = 0; t < trials; t++) {
    const psi = randomState(logical.numQubits, rng)
    const expected = psi.clone()
    for (const op of logical.ops) expected.apply(op)
    const want = embedState(expected, routed.finalLayout, P)
    const got = embedState(psi, routed.initialLayout, P)
    for (const op of routed.circuit.ops) got.apply(op)
    for (let i = 0; i < got.data.length; i++) {
      maxError = Math.max(maxError, Math.abs(got.data[i] - want.data[i]))
    }
  }
  return { equivalent: maxError <= tolerance, maxError, trials }
}
