/**
 * lib/workbench/evolve.ts — Algorithm Evolution at demo scale.
 *
 * The published system this reproduces is Quantinuum's Hive (2025): a swarm
 * of frontier models proposes edits to real Guppy / CUDA-Q source for a
 * combinatorial challenge, the harness executes and scores every proposal on
 * a simulator or QPU, keeps the fittest, and asks the models again. This
 * module is the same loop with three deliberate reductions:
 *
 *   1. CANDIDATES ARE NOT CODE. A candidate is a program in a tiny line-based
 *      DSL (`qaoa`, `classical`, `circuit` — see GRAMMAR) that is PARSED into
 *      a data structure and INTERPRETED by this file. Nothing an LLM returns
 *      is ever evaluated as JavaScript; a line the grammar does not recognise
 *      rejects the whole candidate before anything runs. The parser is the
 *      sandbox, and `evolve.test.ts` proves a malformed candidate is rejected
 *      rather than executed.
 *   2. THE PROBLEMS ARE SMALL. MaxCut on graphs of six or seven nodes (the
 *      optimum is brute-forced, so fitness is an exact approximation ratio),
 *      or one hand-checked challenge from lib/challenges graded by the real
 *      grader. Everything runs on lib/quantum's statevector engine.
 *   3. THE BUDGET IS VISIBLE. Population, generations and proposals per
 *      provider are all capped here, and the loop yields between
 *      generations so a browser tab never freezes.
 *
 * NO NETWORK. Proposals come through a `ProviderAdapter` the caller injects:
 * the page wires real adapters through /api/workbench/evolve (which resolves
 * providers via lib/llm/resolve.ts), and the tests wire scripted fakes. A run
 * with NO providers still works — the built-in mutation operator (seeded,
 * deterministic) perturbs the elites — so the tool degrades to a plain
 * evolutionary search, and says so, when no model is configured.
 */

import {
  StateVector,
  mulberry32,
  simulate,
  type Circuit,
  type GateName,
  type GateOp,
} from '@/lib/quantum'
import { getChallenge } from '@/lib/challenges/catalogue'
import { grade } from '@/lib/challenges/grade'
import type { Challenge } from '@/lib/challenges/types'

// ────────────────────────────────────────────────────────────
// Budget
// ────────────────────────────────────────────────────────────

export const EVOLVE_LIMITS = {
  populationMin: 4,
  populationMax: 12,
  generationsMin: 1,
  generationsMax: 12,
  eliteMax: 4,
  /** Proposals one provider may return per generation; extras are dropped. */
  proposalsPerProvider: 3,
  /** Lines in a candidate program, comments included. */
  maxLines: 40,
  /** Characters in a candidate program. */
  maxChars: 2_000,
  /** QAOA depth. 2^n · layers · |E| gate applications; trivial at this size. */
  maxLayers: 12,
  /** Gates in a `circuit` candidate. */
  maxGates: 24,
  /** Local-search sweeps in a `classical` candidate. */
  maxSweeps: 20,
  /** Steps in a `classical` candidate. */
  maxSteps: 20,
  /** |angle| ceiling. Angles are periodic; anything larger is noise. */
  maxAngle: 2 * Math.PI,
} as const

// ────────────────────────────────────────────────────────────
// The DSL
// ────────────────────────────────────────────────────────────

export type Mixer = 'x' | 'xy'

export interface QaoaLayer {
  gamma: number
  mixer: Mixer
  beta: number
}

export type ClassicalStart =
  | { kind: 'zeros' }
  | { kind: 'alternate' }
  | { kind: 'greedy' }
  | { kind: 'random'; seed: number }

export type ClassicalStep =
  | { op: 'sweep'; passes: number }
  | { op: 'kick'; flips: number; seed: number }

export type Program =
  | { kind: 'qaoa'; layers: QaoaLayer[] }
  | { kind: 'classical'; start: ClassicalStart; steps: ClassicalStep[] }
  | { kind: 'circuit'; ops: GateOp[] }

export type ProgramKind = Program['kind']

export type ParseResult = { ok: true; program: Program } | { ok: false; error: string }

/**
 * The whole grammar, in the form the proposal prompt shows a model. Keep it
 * in lock-step with `parseProgram`; the test suite parses every example here.
 */
export const GRAMMAR: Record<ProgramKind, string> = {
  qaoa: [
    'qaoa',
    '# one line per operation, in order. Angles in radians, |angle| <= 2π.',
    'cost <gamma>            # apply exp(-i·gamma·C) for the MaxCut cost C',
    'mix x <beta>            # transverse-field mixer: RX(2·beta) on every node',
    'mix xy <beta>           # XY ring mixer: exp(-i·beta·(XX+YY)/2) on ring pairs',
    'anneal <p> <gamma> <beta>   # p layers: gamma·k/p then beta·(1-(k-1)/p), k=1..p',
    `# at most ${EVOLVE_LIMITS.maxLayers} cost/mix layers in total. Start state is |+…+⟩.`,
  ].join('\n'),
  classical: [
    'classical',
    '# a deterministic local-search heuristic for MaxCut.',
    'start zeros | alternate | greedy | random <seed>',
    'sweep <passes>          # best-improvement single-node flips, up to <passes> passes',
    'kick <flips> <seed>     # flip <flips> nodes chosen by <seed>, keep only if a later sweep improves',
    `# exactly one start line first, then at most ${EVOLVE_LIMITS.maxSteps} steps.`,
  ].join('\n'),
  circuit: [
    'circuit',
    '# one gate per line on qubits 0..n-1. Angles in radians.',
    'h|x|y|z|s|t <q>',
    'rx|ry|rz <q> <theta>',
    'cx|cz|swap <a> <b>',
    'ccx <a> <b> <c>',
    `# at most ${EVOLVE_LIMITS.maxGates} gates.`,
  ].join('\n'),
}

// Maps, not plain objects: `'constructor' in {}` and `'__proto__' in {}` are
// both true, so an object lookup would let a prototype name through the
// grammar as a "gate". A Map only knows the keys it was given.
const SINGLE_FIXED = new Map<string, GateName>([['h', 'H'], ['x', 'X'], ['y', 'Y'], ['z', 'Z'], ['s', 'S'], ['t', 'T']])
const SINGLE_ANGLE = new Map<string, GateName>([['rx', 'RX'], ['ry', 'RY'], ['rz', 'RZ']])
const TWO_QUBIT = new Map<string, GateName>([['cx', 'CX'], ['cz', 'CZ'], ['swap', 'SWAP']])

/** Strict decimal or `pi` fraction: `0.5`, `-1.25`, `pi/4`, `-pi/8`, `2pi`, `3pi/2`. */
function parseAngle(token: string): number | null {
  const t = token.toLowerCase()
  const plain = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/
  if (plain.test(t)) {
    const v = Number(t)
    return Number.isFinite(v) ? v : null
  }
  const pi = /^([-+])?(\d+\.?\d*)?\*?pi(?:\/(\d+\.?\d*))?$/.exec(t)
  if (!pi) return null
  const sign = pi[1] === '-' ? -1 : 1
  const num = pi[2] === undefined ? 1 : Number(pi[2])
  const den = pi[3] === undefined ? 1 : Number(pi[3])
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  return (sign * num * Math.PI) / den
}

function parseInt10(token: string): number | null {
  if (!/^[-+]?\d+$/.test(token)) return null
  const v = Number(token)
  return Number.isSafeInteger(v) ? v : null
}

function fail(line: number, message: string): ParseResult {
  return { ok: false, error: `line ${line}: ${message}` }
}

function boundedAngle(v: number | null, line: number, what: string): ParseResult | number {
  if (v === null) return fail(line, `${what} must be a number or a pi fraction like pi/4`)
  if (Math.abs(v) > EVOLVE_LIMITS.maxAngle) return fail(line, `${what} must satisfy |angle| <= 2π`)
  return v
}

/**
 * Parse candidate text into a Program, or say precisely why not.
 *
 * Total and side-effect free: the only thing this function does with its
 * input is tokenise it. Every accepted line maps to a fixed constructor with
 * validated numeric arguments; there is no "escape" line, no identifier
 * lookup, no string that reaches anything but the error message.
 */
export function parseProgram(text: string, numQubits: number): ParseResult {
  if (typeof text !== 'string') return { ok: false, error: 'candidate is not text' }
  if (text.length > EVOLVE_LIMITS.maxChars) {
    return { ok: false, error: `candidate is longer than ${EVOLVE_LIMITS.maxChars} characters` }
  }
  const raw = text.split(/\r?\n/)
  if (raw.length > EVOLVE_LIMITS.maxLines) {
    return { ok: false, error: `candidate has more than ${EVOLVE_LIMITS.maxLines} lines` }
  }
  const lines: { n: number; tokens: string[] }[] = []
  raw.forEach((l, i) => {
    const stripped = l.replace(/#.*$/, '').trim()
    if (!stripped) return
    lines.push({ n: i + 1, tokens: stripped.split(/\s+/) })
  })
  if (lines.length === 0) return { ok: false, error: 'candidate is empty' }

  const head = lines[0]
  const kind = head.tokens[0].toLowerCase()
  if (head.tokens.length !== 1) return fail(head.n, 'the first line must be just the program kind')
  const body = lines.slice(1)

  if (kind === 'qaoa') {
    const layers: QaoaLayer[] = []
    let pendingGamma: number | null = null
    let pendingLine = 0
    const pushLayer = (gamma: number, mixer: Mixer, beta: number, n: number): ParseResult | null => {
      if (layers.length >= EVOLVE_LIMITS.maxLayers) {
        return fail(n, `more than ${EVOLVE_LIMITS.maxLayers} layers`)
      }
      layers.push({ gamma, mixer, beta })
      return null
    }
    for (const { n, tokens } of body) {
      const op = tokens[0].toLowerCase()
      if (op === 'cost') {
        if (tokens.length !== 2) return fail(n, 'cost takes exactly one angle')
        if (pendingGamma !== null) return fail(n, 'two cost lines in a row; a mix line must follow each cost')
        const g = boundedAngle(parseAngle(tokens[1]), n, 'gamma')
        if (typeof g !== 'number') return g
        pendingGamma = g
        pendingLine = n
      } else if (op === 'mix') {
        if (tokens.length !== 3) return fail(n, 'mix takes a mixer name (x or xy) and one angle')
        const mixer = tokens[1].toLowerCase()
        if (mixer !== 'x' && mixer !== 'xy') return fail(n, `unknown mixer "${tokens[1]}"; use x or xy`)
        const b = boundedAngle(parseAngle(tokens[2]), n, 'beta')
        if (typeof b !== 'number') return b
        if (pendingGamma === null) return fail(n, 'mix without a preceding cost line')
        const e = pushLayer(pendingGamma, mixer, b, n)
        if (e) return e
        pendingGamma = null
      } else if (op === 'anneal') {
        if (tokens.length !== 4) return fail(n, 'anneal takes <p> <gamma> <beta>')
        if (pendingGamma !== null) return fail(n, 'anneal cannot follow an unmatched cost line')
        const p = parseInt10(tokens[1])
        if (p === null || p < 1 || p > EVOLVE_LIMITS.maxLayers) {
          return fail(n, `anneal depth must be an integer from 1 to ${EVOLVE_LIMITS.maxLayers}`)
        }
        const g = boundedAngle(parseAngle(tokens[2]), n, 'gamma')
        if (typeof g !== 'number') return g
        const b = boundedAngle(parseAngle(tokens[3]), n, 'beta')
        if (typeof b !== 'number') return b
        for (let k = 1; k <= p; k++) {
          const e = pushLayer((g * k) / p, 'x', b * (1 - (k - 1) / p), n)
          if (e) return e
        }
      } else {
        return fail(n, `unknown qaoa line "${tokens[0]}"`)
      }
    }
    if (pendingGamma !== null) return fail(pendingLine, 'cost line has no matching mix line')
    if (layers.length === 0) return fail(head.n, 'a qaoa program needs at least one cost/mix layer')
    return { ok: true, program: { kind: 'qaoa', layers } }
  }

  if (kind === 'classical') {
    if (body.length === 0) return fail(head.n, 'a classical program needs a start line')
    const first = body[0]
    if (first.tokens[0].toLowerCase() !== 'start') return fail(first.n, 'the first line after "classical" must be a start line')
    const mode = (first.tokens[1] ?? '').toLowerCase()
    let start: ClassicalStart
    if (mode === 'zeros' || mode === 'alternate' || mode === 'greedy') {
      if (first.tokens.length !== 2) return fail(first.n, `start ${mode} takes no argument`)
      start = { kind: mode }
    } else if (mode === 'random') {
      const seed = first.tokens.length === 3 ? parseInt10(first.tokens[2]) : null
      if (seed === null || seed < 0) return fail(first.n, 'start random takes a non-negative integer seed')
      start = { kind: 'random', seed }
    } else {
      return fail(first.n, 'start must be zeros, alternate, greedy or random <seed>')
    }
    const steps: ClassicalStep[] = []
    for (const { n, tokens } of body.slice(1)) {
      if (steps.length >= EVOLVE_LIMITS.maxSteps) return fail(n, `more than ${EVOLVE_LIMITS.maxSteps} steps`)
      const op = tokens[0].toLowerCase()
      if (op === 'sweep') {
        const passes = tokens.length === 2 ? parseInt10(tokens[1]) : null
        if (passes === null || passes < 1 || passes > EVOLVE_LIMITS.maxSweeps) {
          return fail(n, `sweep takes an integer from 1 to ${EVOLVE_LIMITS.maxSweeps}`)
        }
        steps.push({ op: 'sweep', passes })
      } else if (op === 'kick') {
        const flips = tokens.length === 3 ? parseInt10(tokens[1]) : null
        const seed = tokens.length === 3 ? parseInt10(tokens[2]) : null
        if (flips === null || flips < 1 || flips > numQubits) {
          return fail(n, `kick flips must be an integer from 1 to ${numQubits}`)
        }
        if (seed === null || seed < 0) return fail(n, 'kick takes a non-negative integer seed')
        steps.push({ op: 'kick', flips, seed })
      } else {
        return fail(n, `unknown classical line "${tokens[0]}"`)
      }
    }
    return { ok: true, program: { kind: 'classical', start, steps } }
  }

  if (kind === 'circuit') {
    const ops: GateOp[] = []
    const qubit = (tok: string, n: number): ParseResult | number => {
      const q = parseInt10(tok)
      if (q === null || q < 0 || q >= numQubits) {
        return fail(n, `qubit index "${tok}" is outside 0..${numQubits - 1}`)
      }
      return q
    }
    for (const { n, tokens } of body) {
      if (ops.length >= EVOLVE_LIMITS.maxGates) return fail(n, `more than ${EVOLVE_LIMITS.maxGates} gates`)
      const g = tokens[0].toLowerCase()
      const fixed = SINGLE_FIXED.get(g)
      const angled = SINGLE_ANGLE.get(g)
      const two = TWO_QUBIT.get(g)
      if (fixed !== undefined) {
        if (tokens.length !== 2) return fail(n, `${g} takes one qubit`)
        const q = qubit(tokens[1], n)
        if (typeof q !== 'number') return q
        ops.push({ name: fixed, qubits: [q] })
      } else if (angled !== undefined) {
        if (tokens.length !== 3) return fail(n, `${g} takes a qubit and an angle`)
        const q = qubit(tokens[1], n)
        if (typeof q !== 'number') return q
        const th = boundedAngle(parseAngle(tokens[2]), n, 'theta')
        if (typeof th !== 'number') return th
        ops.push({ name: angled, qubits: [q], theta: th })
      } else if (two !== undefined) {
        if (tokens.length !== 3) return fail(n, `${g} takes two qubits`)
        const a = qubit(tokens[1], n)
        if (typeof a !== 'number') return a
        const b = qubit(tokens[2], n)
        if (typeof b !== 'number') return b
        if (a === b) return fail(n, `${g} needs two different qubits`)
        ops.push({ name: two, qubits: [a, b] })
      } else if (g === 'ccx') {
        if (tokens.length !== 4) return fail(n, 'ccx takes three qubits')
        const qs: number[] = []
        for (const tok of tokens.slice(1)) {
          const q = qubit(tok, n)
          if (typeof q !== 'number') return q
          qs.push(q)
        }
        if (new Set(qs).size !== 3) return fail(n, 'ccx needs three different qubits')
        ops.push({ name: 'CCX', qubits: qs })
      } else {
        return fail(n, `unknown gate "${tokens[0]}"`)
      }
    }
    if (ops.length === 0) return fail(head.n, 'a circuit program needs at least one gate')
    return { ok: true, program: { kind: 'circuit', ops } }
  }

  return fail(head.n, `unknown program kind "${head.tokens[0]}"; expected qaoa, classical or circuit`)
}

const fmt = (v: number): string => {
  const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

/** Canonical text for a program — what the lineage shows and what re-parses to the same program. */
export function formatProgram(program: Program): string {
  switch (program.kind) {
    case 'qaoa':
      return ['qaoa', ...program.layers.flatMap((l) => [`cost ${fmt(l.gamma)}`, `mix ${l.mixer} ${fmt(l.beta)}`])].join('\n')
    case 'classical': {
      const s = program.start
      const start = s.kind === 'random' ? `start random ${s.seed}` : `start ${s.kind}`
      return [
        'classical',
        start,
        ...program.steps.map((st) => (st.op === 'sweep' ? `sweep ${st.passes}` : `kick ${st.flips} ${st.seed}`)),
      ].join('\n')
    }
    case 'circuit':
      return [
        'circuit',
        ...program.ops.map((op) => {
          const name = op.name.toLowerCase()
          return op.theta === undefined
            ? `${name} ${op.qubits.join(' ')}`
            : `${name} ${op.qubits.join(' ')} ${fmt(op.theta)}`
        }),
      ].join('\n')
  }
}

/** Layers, steps or gates — the size a tie-break prefers smaller. */
export function programSize(program: Program): number {
  switch (program.kind) {
    case 'qaoa': return program.layers.length
    case 'classical': return program.steps.length + 1
    case 'circuit': return program.ops.length
  }
}

// ────────────────────────────────────────────────────────────
// MaxCut
// ────────────────────────────────────────────────────────────

export interface Graph {
  n: number
  edges: readonly (readonly [number, number])[]
}

/** Number of edges whose endpoints land on different sides. */
export function cutValue(graph: Graph, assignment: readonly number[]): number {
  let cut = 0
  for (const [u, v] of graph.edges) if (assignment[u] !== assignment[v]) cut += 1
  return cut
}

/** Cut of the basis index `bits` read as the assignment (qubit q = bit q). */
export function cutOfIndex(graph: Graph, bits: number): number {
  let cut = 0
  for (const [u, v] of graph.edges) if (((bits >> u) & 1) !== ((bits >> v) & 1)) cut += 1
  return cut
}

/** Exhaustive optimum. n <= 12 by construction of the problem set. */
export function bruteForceMaxCut(graph: Graph): { value: number; assignments: number[] } {
  let best = -1
  let assignments: number[] = []
  for (let b = 0; b < 1 << graph.n; b++) {
    const c = cutOfIndex(graph, b)
    if (c > best) {
      best = c
      assignments = [b]
    } else if (c === best) assignments.push(b)
  }
  return { value: best, assignments }
}

/** exp(-iθ Z_u Z_v / 2) via CX · RZ · CX. */
function rzz(sv: StateVector, u: number, v: number, theta: number): void {
  sv.applyControlled('X', [u], v)
  sv.applySingle('RZ', v, theta)
  sv.applyControlled('X', [u], v)
}

/**
 * exp(-iγ C) with C = Σ_edges (1 - Z_u Z_v)/2. Up to a global phase that is
 * Π_edges exp(+iγ Z_u Z_v / 2) = Π RZZ(-γ).
 */
export function applyCost(sv: StateVector, graph: Graph, gamma: number): void {
  for (const [u, v] of graph.edges) rzz(sv, u, v, -gamma)
}

/**
 * The mixer layer. `x`: exp(-iβ Σ X_q) = RX(2β) on every qubit. `xy`: the
 * ring XY mixer exp(-iβ (X_i X_j + Y_i Y_j)/2) on pairs (i, i+1 mod n), which
 * commutes with the Hamming weight and so never changes the number of 1s —
 * the property evolve.test.ts checks. RXX = (H⊗H) RZZ (H⊗H) and
 * RYY = (RX(-π/2)⊗RX(-π/2)) RZZ (RX(π/2)⊗RX(π/2)), since RX(π/2)† Z RX(π/2) = Y.
 */
export function applyMixer(sv: StateVector, mixer: Mixer, beta: number): void {
  const n = sv.numQubits
  if (mixer === 'x') {
    for (let q = 0; q < n; q++) sv.applySingle('RX', q, 2 * beta)
    return
  }
  if (n < 2) return
  const pairs: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (n === 2 && i === 1) break
    pairs.push([i, j])
  }
  for (const [a, b] of pairs) {
    sv.applySingle('H', a)
    sv.applySingle('H', b)
    rzz(sv, a, b, beta)
    sv.applySingle('H', a)
    sv.applySingle('H', b)
    sv.applySingle('RX', a, Math.PI / 2)
    sv.applySingle('RX', b, Math.PI / 2)
    rzz(sv, a, b, beta)
    sv.applySingle('RX', a, -Math.PI / 2)
    sv.applySingle('RX', b, -Math.PI / 2)
  }
}

/** Run a qaoa program on the simulator and return the final state. */
export function runQaoa(graph: Graph, layers: readonly QaoaLayer[]): StateVector {
  const sv = new StateVector(graph.n)
  for (let q = 0; q < graph.n; q++) sv.applySingle('H', q)
  for (const layer of layers) {
    applyCost(sv, graph, layer.gamma)
    applyMixer(sv, layer.mixer, layer.beta)
  }
  return sv.normalize()
}

/** ⟨C⟩ = Σ_b p(b)·cut(b). */
export function expectedCut(graph: Graph, sv: StateVector): number {
  const probs = sv.probabilities()
  let e = 0
  for (let b = 0; b < probs.length; b++) e += probs[b] * cutOfIndex(graph, b)
  return e
}

// ── classical heuristic interpreter ──

function greedyStart(graph: Graph): number[] {
  // Place nodes in index order on whichever side cuts more already-placed neighbours.
  const side = new Array<number>(graph.n).fill(-1)
  const adj: number[][] = Array.from({ length: graph.n }, () => [])
  for (const [u, v] of graph.edges) {
    adj[u].push(v)
    adj[v].push(u)
  }
  for (let v = 0; v < graph.n; v++) {
    let on0 = 0
    let on1 = 0
    for (const u of adj[v]) {
      if (side[u] === 0) on0 += 1
      else if (side[u] === 1) on1 += 1
    }
    // Joining side 1 cuts the on0 edges; joining side 0 cuts the on1 edges.
    side[v] = on0 >= on1 ? 1 : 0
  }
  return side
}

/** Best-improvement single-flip local search; returns passes actually used. */
function sweep(graph: Graph, side: number[], passes: number): number {
  const adj: number[][] = Array.from({ length: graph.n }, () => [])
  for (const [u, v] of graph.edges) {
    adj[u].push(v)
    adj[v].push(u)
  }
  let used = 0
  for (let p = 0; p < passes; p++) {
    let bestGain = 0
    let bestNode = -1
    for (let v = 0; v < graph.n; v++) {
      let same = 0
      let diff = 0
      for (const u of adj[v]) if (side[u] === side[v]) same += 1; else diff += 1
      const gain = same - diff
      if (gain > bestGain) {
        bestGain = gain
        bestNode = v
      }
    }
    if (bestNode < 0) break
    side[bestNode] ^= 1
    used += 1
  }
  return used
}

export interface ClassicalTrace {
  assignment: number[]
  cut: number
  log: string[]
}

export function runClassical(graph: Graph, program: Extract<Program, { kind: 'classical' }>): ClassicalTrace {
  let side: number[]
  const s = program.start
  switch (s.kind) {
    case 'zeros': side = new Array<number>(graph.n).fill(0); break
    case 'alternate': side = Array.from({ length: graph.n }, (_, i) => i & 1); break
    case 'greedy': side = greedyStart(graph); break
    case 'random': {
      const rng = mulberry32(s.seed)
      side = Array.from({ length: graph.n }, () => (rng() < 0.5 ? 0 : 1))
    }
  }
  const log: string[] = [`start ${s.kind}: cut ${cutValue(graph, side)}`]
  let best = side.slice()
  let bestCut = cutValue(graph, best)
  for (const step of program.steps) {
    if (step.op === 'sweep') {
      const used = sweep(graph, side, step.passes)
      const c = cutValue(graph, side)
      log.push(`sweep ${step.passes}: ${used} flip${used === 1 ? '' : 's'}, cut ${c}`)
      if (c > bestCut) {
        bestCut = c
        best = side.slice()
      } else if (c < bestCut) {
        // A kick that no sweep could repair: fall back to the best seen, as
        // iterated local search does. The kick still counts as a step spent.
        side = best.slice()
        log.push(`  reverted to best (cut ${bestCut})`)
      }
    } else {
      const rng = mulberry32(step.seed)
      const flipped: number[] = []
      for (let k = 0; k < step.flips; k++) {
        const v = Math.floor(rng() * graph.n) % graph.n
        side[v] ^= 1
        flipped.push(v)
      }
      log.push(`kick ${step.flips}: flipped ${flipped.join(',')}, cut ${cutValue(graph, side)}`)
    }
  }
  return { assignment: best, cut: bestCut, log }
}

// ────────────────────────────────────────────────────────────
// Problems
// ────────────────────────────────────────────────────────────

export interface Evaluation {
  /** 0..1. MaxCut: ⟨cut⟩/optimum (qaoa) or cut/optimum (classical). Challenge: 1 − TVD. */
  fitness: number
  /** One or two lines a person can read under the candidate. */
  detail: string
  /** Challenge problems only: what the real grader said. */
  verified?: boolean
}

export interface Problem {
  id: string
  title: string
  /** For the page and the prompt: what is being optimised, in one paragraph. */
  description: string
  numQubits: number
  /** Which program kinds this problem accepts. */
  kinds: readonly ProgramKind[]
  /** The value fitness 1.0 corresponds to, as text. */
  optimumLabel: string
  evaluate(program: Program): Evaluation
  /** Hand-written starting population, one per kind at least. */
  seeds: readonly string[]
  /** Only for MaxCut problems: the graph, for drawing. */
  graph?: Graph
  challengeId?: string
}

const ring = (n: number): Graph => ({
  n,
  edges: Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as const),
})

/** A 7-node graph with odd cycles, so no assignment cuts every edge. Optimum 9 of 11. */
const HOUSE_GRAPH: Graph = {
  n: 7,
  edges: [
    [0, 1], [1, 2], [2, 0],          // a triangle
    [2, 3], [3, 4], [4, 5], [5, 3],  // a triangle hanging off it
    [4, 6], [5, 6],                  // a third triangle sharing an edge
    [0, 6], [1, 4],                  // long edges closing odd cycles
  ],
}

function maxCutProblem(id: string, title: string, graph: Graph, seeds: readonly string[]): Problem {
  const optimum = bruteForceMaxCut(graph)
  const edgeList = graph.edges.map(([u, v]) => `${u}-${v}`).join(', ')
  return {
    id,
    title,
    graph,
    numQubits: graph.n,
    kinds: ['qaoa', 'classical'],
    optimumLabel: `cut ${optimum.value} of ${graph.edges.length} edges`,
    description:
      `MaxCut on a graph with ${graph.n} nodes (0..${graph.n - 1}) and ${graph.edges.length} edges: ${edgeList}. ` +
      `Split the nodes into two sides so as many edges as possible cross the split. The optimum is ${optimum.value}. ` +
      'A qaoa candidate is scored by the expected cut of its final state divided by the optimum; ' +
      'a classical candidate by the cut it reaches divided by the optimum.',
    seeds,
    evaluate(program) {
      if (program.kind === 'qaoa') {
        const sv = runQaoa(graph, program.layers)
        const e = expectedCut(graph, sv)
        const probs = sv.probabilities()
        let top = 0
        for (let b = 1; b < probs.length; b++) if (probs[b] > probs[top]) top = b
        const pOpt = optimum.assignments.reduce((acc, b) => acc + probs[b], 0)
        return {
          fitness: e / optimum.value,
          detail:
            `⟨cut⟩ = ${e.toFixed(3)} of ${optimum.value} (ratio ${(e / optimum.value).toFixed(3)}); ` +
            `P(optimal cut) = ${(pOpt * 100).toFixed(1)}%; most likely string ${top.toString(2).padStart(graph.n, '0')} at ${(probs[top] * 100).toFixed(1)}%`,
        }
      }
      if (program.kind === 'classical') {
        const trace = runClassical(graph, program)
        return {
          fitness: trace.cut / optimum.value,
          detail: `cut ${trace.cut} of ${optimum.value}; sides ${trace.assignment.join('')}. ${trace.log.join(' · ')}`,
        }
      }
      return { fitness: 0, detail: 'a circuit program is not a MaxCut heuristic' }
    },
  }
}

function tvd(a: readonly number[], b: readonly number[]): number {
  let s = 0
  for (let i = 0; i < b.length; i++) s += Math.abs((a[i] ?? 0) - b[i])
  return s / 2
}

function challengeProblem(challenge: Challenge, seeds: readonly string[]): Problem {
  const target = challenge.targetProbabilities ?? []
  const targetText = target
    .map((p, i) => (p > 0 ? `|${i.toString(2).padStart(challenge.numQubits, '0')}⟩: ${(p * 100).toFixed(0)}%` : null))
    .filter((s): s is string => s !== null)
    .join(', ')
  return {
    id: `challenge:${challenge.id}`,
    title: `Challenge · ${challenge.title}`,
    challengeId: challenge.id,
    numQubits: challenge.numQubits,
    kinds: ['circuit'],
    optimumLabel: 'target distribution exactly, graded by lib/challenges',
    description:
      `${challenge.brief} Target measurement probabilities: ${targetText}. Qubit 0 is the least significant bit. ` +
      'A candidate is scored by 1 minus the total-variation distance between its output distribution and the target; ' +
      `the real challenge grader then confirms a pass (par is ${challenge.maxGates ?? '—'} gates).`,
    seeds,
    evaluate(program) {
      if (program.kind !== 'circuit') return { fitness: 0, detail: 'this challenge needs a circuit program' }
      const circuit: Circuit = { numQubits: challenge.numQubits, ops: program.ops }
      const probs = simulate(circuit).probabilities()
      const g = grade(challenge, circuit)
      const fitness = 1 - tvd(probs, target)
      return {
        fitness,
        verified: g.passed,
        detail: `${g.passed ? 'PASSES the grader' : 'does not pass yet'} · ${g.summary} (${g.gateCount} gate${g.gateCount === 1 ? '' : 's'})`,
      }
    },
  }
}

function buildProblems(): Problem[] {
  const ghz = getChallenge('ghz-three')
  const problems: Problem[] = [
    maxCutProblem('maxcut-ring-6', 'MaxCut · 6-node ring', ring(6), [
      'qaoa\ncost 0.5\nmix x 0.3',
      'qaoa\nanneal 3 1.2 0.8',
      'classical\nstart zeros\nsweep 6',
      'classical\nstart random 7\nsweep 4\nkick 2 3\nsweep 4',
    ]),
    maxCutProblem('maxcut-house-7', 'MaxCut · 7 nodes, odd cycles', HOUSE_GRAPH, [
      'qaoa\ncost 0.4\nmix x 0.4',
      'qaoa\nanneal 4 1.0 0.7',
      'classical\nstart greedy\nsweep 6',
      'classical\nstart random 11\nsweep 5\nkick 2 5\nsweep 5',
    ]),
  ]
  if (ghz) {
    problems.push(
      challengeProblem(ghz, [
        'circuit\nh 0\nh 1\nh 2',
        'circuit\nh 0\ncx 0 1',
        'circuit\nry 0 1.2\ncx 0 2',
      ]),
    )
  }
  return problems
}

export const PROBLEMS: readonly Problem[] = buildProblems()

export function getProblem(id: string): Problem | undefined {
  return PROBLEMS.find((p) => p.id === id)
}

// ────────────────────────────────────────────────────────────
// Providers
// ────────────────────────────────────────────────────────────

export interface EliteBrief {
  id: string
  text: string
  fitness: number
  detail: string
}

export interface ProposalContext {
  problem: Pick<Problem, 'id' | 'title' | 'description' | 'numQubits' | 'kinds' | 'optimumLabel'>
  grammar: string
  elites: EliteBrief[]
  generation: number
  /** How many programs the provider should return. */
  count: number
}

export interface ProviderAdapter {
  /** Shown in the lineage as the operator that produced a candidate. */
  name: string
  /** Raw candidate texts. May be empty, may be garbage — the parser decides. */
  propose(ctx: ProposalContext): Promise<string[]>
}

/** The instruction a real model receives. Exported so the API route and the tests share it. */
export function buildProposalPrompt(ctx: ProposalContext): string {
  const elites = ctx.elites
    .map((e, i) => `### Candidate ${i + 1} (fitness ${e.fitness.toFixed(4)})\n${e.text}\n# ${e.detail}`)
    .join('\n\n')
  return [
    'You are one proposer in an evolutionary search over heuristics for a small optimisation problem.',
    `Problem: ${ctx.problem.title}. ${ctx.problem.description}`,
    `Fitness 1.0 means: ${ctx.problem.optimumLabel}.`,
    '',
    'Candidates are programs in a tiny domain-specific language. The ONLY accepted grammar is:',
    '```',
    ctx.grammar,
    '```',
    '',
    `This is generation ${ctx.generation}. The current best candidates are:`,
    '',
    elites || '(none yet)',
    '',
    `Propose ${ctx.count} NEW candidate program${ctx.count === 1 ? '' : 's'} that you expect to score higher. ` +
      'Vary angles, depth, mixers or search steps; keep what works. Return each program in its own ```dsl code block ' +
      'and nothing else. Any line outside the grammar rejects the whole candidate.',
  ].join('\n')
}

/**
 * Pull candidate programs out of a model reply: every fenced code block, or,
 * when there are none, the whole reply as one candidate. Never interprets
 * anything — the parser does that later.
 */
export function extractPrograms(reply: string): string[] {
  const blocks: string[] = []
  const fence = /```[a-zA-Z]*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fence.exec(reply)) !== null) {
    const body = m[1].trim()
    if (body) blocks.push(body)
  }
  if (blocks.length > 0) return blocks
  const whole = reply.trim()
  return whole ? [whole] : []
}

/** Deterministic mutation of a parsed program: the operator that needs no model. */
export function mutateProgram(program: Program, rng: () => number, numQubits: number): Program {
  const jitter = (v: number, scale: number): number => {
    const next = v + (rng() * 2 - 1) * scale
    return Math.max(-EVOLVE_LIMITS.maxAngle, Math.min(EVOLVE_LIMITS.maxAngle, next))
  }
  switch (program.kind) {
    case 'qaoa': {
      const layers = program.layers.map((l) => ({ ...l }))
      const roll = rng()
      if (roll < 0.15 && layers.length < EVOLVE_LIMITS.maxLayers) {
        const src = layers[Math.floor(rng() * layers.length)]
        layers.push({ gamma: jitter(src.gamma, 0.3), mixer: src.mixer, beta: jitter(src.beta, 0.3) })
      } else if (roll < 0.25 && layers.length > 1) {
        layers.splice(Math.floor(rng() * layers.length), 1)
      } else if (roll < 0.32) {
        const i = Math.floor(rng() * layers.length)
        layers[i].mixer = layers[i].mixer === 'x' ? 'xy' : 'x'
      } else {
        const i = Math.floor(rng() * layers.length)
        const scale = rng() < 0.5 ? 0.1 : 0.4
        if (rng() < 0.5) layers[i].gamma = jitter(layers[i].gamma, scale)
        else layers[i].beta = jitter(layers[i].beta, scale)
      }
      return { kind: 'qaoa', layers }
    }
    case 'classical': {
      const steps = program.steps.map((s) => ({ ...s }))
      let start = program.start
      const roll = rng()
      if (roll < 0.2) {
        const starts: ClassicalStart[] = [
          { kind: 'zeros' },
          { kind: 'alternate' },
          { kind: 'greedy' },
          { kind: 'random', seed: Math.floor(rng() * 1000) },
        ]
        start = starts[Math.floor(rng() * starts.length)]
      } else if (roll < 0.5 && steps.length + 2 <= EVOLVE_LIMITS.maxSteps) {
        steps.push({ op: 'kick', flips: 1 + Math.floor(rng() * Math.min(3, numQubits)), seed: Math.floor(rng() * 1000) })
        steps.push({ op: 'sweep', passes: 1 + Math.floor(rng() * 6) })
      } else if (roll < 0.65 && steps.length > 1) {
        steps.splice(Math.floor(rng() * steps.length), 1)
      } else if (steps.length > 0) {
        const i = Math.floor(rng() * steps.length)
        const st = steps[i]
        if (st.op === 'sweep') st.passes = Math.max(1, Math.min(EVOLVE_LIMITS.maxSweeps, st.passes + (rng() < 0.5 ? -1 : 2)))
        else st.seed = Math.floor(rng() * 1000)
      } else {
        steps.push({ op: 'sweep', passes: 1 + Math.floor(rng() * 6) })
      }
      return { kind: 'classical', start, steps }
    }
    case 'circuit': {
      const ops = program.ops.map((op) => ({ ...op, qubits: op.qubits.slice() }))
      const q = () => Math.floor(rng() * numQubits)
      const roll = rng()
      if (roll < 0.4 && ops.length < EVOLVE_LIMITS.maxGates) {
        const choice = rng()
        let op: GateOp
        if (choice < 0.35) op = { name: 'H', qubits: [q()] }
        else if (choice < 0.5) op = { name: 'X', qubits: [q()] }
        else if (choice < 0.65) op = { name: 'RY', qubits: [q()], theta: jitter(0, Math.PI) }
        else {
          const a = q()
          let b = q()
          while (numQubits > 1 && b === a) b = q()
          op = numQubits > 1 ? { name: 'CX', qubits: [a, b] } : { name: 'Z', qubits: [a] }
        }
        ops.splice(Math.floor(rng() * (ops.length + 1)), 0, op)
      } else if (roll < 0.65 && ops.length > 1) {
        ops.splice(Math.floor(rng() * ops.length), 1)
      } else {
        const i = Math.floor(rng() * ops.length)
        const op = ops[i]
        if (op.theta !== undefined) op.theta = jitter(op.theta, 0.5)
        else if (op.qubits.length === 1) op.qubits[0] = q()
        else if (numQubits > 1) op.qubits.reverse()
      }
      return { kind: 'circuit', ops }
    }
  }
}

// ────────────────────────────────────────────────────────────
// The loop
// ────────────────────────────────────────────────────────────

export interface EvolveConfig {
  problemId: string
  populationSize: number
  generations: number
  eliteCount: number
  seed: number
}

export interface Candidate {
  id: string
  generation: number
  parentIds: string[]
  /** 'seed', 'mutation', or a provider's name. */
  operator: string
  text: string
  program: Program
  fitness: number
  detail: string
  verified?: boolean
  size: number
}

export interface Rejection {
  generation: number
  operator: string
  text: string
  reason: string
}

export interface Generation {
  index: number
  /** Sorted best-first. Elites carried over keep their original id and generation. */
  population: Candidate[]
  best: Candidate
  rejected: Rejection[]
  /** Provider failures (thrown adapters) this generation, by name. */
  providerErrors: { provider: string; message: string }[]
}

export interface EvolutionRun {
  problemId: string
  config: EvolveConfig
  generations: Generation[]
  best: Candidate
  /** True when the run ended before `config.generations` because it was stopped. */
  stopped: boolean
}

export interface EvolveHooks {
  onGeneration?: (generation: Generation, run: EvolutionRun) => void
  /** Polled after every generation; return true to end the run early. */
  shouldStop?: () => boolean
  /** Yield to the host between generations; the page passes a rAF/timeout, tests pass nothing. */
  yieldToHost?: () => Promise<void>
}

function clampConfig(config: EvolveConfig): EvolveConfig {
  const L = EVOLVE_LIMITS
  const populationSize = Math.max(L.populationMin, Math.min(L.populationMax, Math.floor(config.populationSize)))
  return {
    problemId: config.problemId,
    populationSize,
    generations: Math.max(L.generationsMin, Math.min(L.generationsMax, Math.floor(config.generations))),
    eliteCount: Math.max(1, Math.min(L.eliteMax, populationSize - 1, Math.floor(config.eliteCount))),
    seed: config.seed >>> 0,
  }
}

/** Best-first; ties go to the smaller program, then the earlier id. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.fitness !== a.fitness) return b.fitness - a.fitness
  if (a.size !== b.size) return a.size - b.size
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Run the evolutionary loop. Deterministic for a fixed seed and a
 * deterministic set of providers; providers are awaited in registration
 * order so the lineage is reproducible.
 */
export async function evolve(
  rawConfig: EvolveConfig,
  providers: readonly ProviderAdapter[],
  hooks: EvolveHooks = {},
): Promise<EvolutionRun> {
  const config = clampConfig(rawConfig)
  const problem = getProblem(config.problemId)
  if (!problem) throw new Error(`unknown problem "${config.problemId}"`)
  const rng = mulberry32(config.seed)
  const grammar = problem.kinds.map((k) => GRAMMAR[k]).join('\n\n')
  const seen = new Set<string>()
  let counter = 0

  const make = (generation: number, program: Program, parentIds: string[], operator: string): Candidate => {
    const text = formatProgram(program)
    const ev = problem.evaluate(program)
    counter += 1
    return {
      id: `g${generation}-${counter}`,
      generation,
      parentIds,
      operator,
      text,
      program,
      fitness: ev.fitness,
      detail: ev.detail,
      verified: ev.verified,
      size: programSize(program),
    }
  }

  /** Parse, dedupe against everything seen, and evaluate — or record why not. */
  const admit = (
    generation: number,
    text: string,
    parentIds: string[],
    operator: string,
    rejected: Rejection[],
  ): Candidate | null => {
    let parsed: ParseResult
    try {
      parsed = parseProgram(text, problem.numQubits)
    } catch (cause) {
      // The parser is total by construction; this is belt-and-braces so a
      // single provider reply can never reject the whole run.
      parsed = { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }
    if (!parsed.ok) {
      rejected.push({ generation, operator, text, reason: parsed.error })
      return null
    }
    if (!problem.kinds.includes(parsed.program.kind)) {
      rejected.push({
        generation,
        operator,
        text,
        reason: `this problem accepts ${problem.kinds.join(' or ')} programs, not ${parsed.program.kind}`,
      })
      return null
    }
    const canonical = formatProgram(parsed.program)
    if (seen.has(canonical)) {
      rejected.push({ generation, operator, text, reason: 'duplicate of a candidate already evaluated' })
      return null
    }
    seen.add(canonical)
    try {
      return make(generation, parsed.program, parentIds, operator)
    } catch (cause) {
      seen.delete(canonical)
      rejected.push({
        generation,
        operator,
        text,
        reason: `evaluation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
      return null
    }
  }

  const mutateFrom = (generation: number, parents: Candidate[], rejected: Rejection[]): Candidate | null => {
    // A few attempts: mutation of a tiny program can land on a duplicate.
    for (let attempt = 0; attempt < 8; attempt++) {
      const parent = parents[Math.floor(rng() * parents.length)]
      const child = mutateProgram(parent.program, rng, problem.numQubits)
      const c = admit(generation, formatProgram(child), [parent.id], 'mutation', rejected)
      if (c) return c
      rejected.pop() // duplicates from the local operator are not worth a lineage entry
    }
    return null
  }

  const generations: Generation[] = []
  const run: EvolutionRun = {
    problemId: problem.id,
    config,
    generations,
    best: undefined as unknown as Candidate,
    stopped: false,
  }

  // ── generation 0: the hand-written seeds, padded with mutations of them ──
  const g0Rejected: Rejection[] = []
  let population: Candidate[] = []
  for (const text of problem.seeds) {
    const c = admit(0, text, [], 'seed', g0Rejected)
    if (c) population.push(c)
    if (population.length >= config.populationSize) break
  }
  while (population.length < config.populationSize && population.length > 0) {
    const c = mutateFrom(0, population, g0Rejected)
    if (!c) break
    population.push(c)
  }
  population.sort(compareCandidates)
  const g0: Generation = { index: 0, population, best: population[0], rejected: g0Rejected, providerErrors: [] }
  generations.push(g0)
  run.best = g0.best
  hooks.onGeneration?.(g0, run)

  for (let g = 1; g <= config.generations; g++) {
    if (hooks.shouldStop?.()) {
      run.stopped = true
      break
    }
    if (hooks.yieldToHost) await hooks.yieldToHost()

    const elites = population.slice(0, config.eliteCount)
    const rejected: Rejection[] = []
    const providerErrors: Generation['providerErrors'] = []
    const children: Candidate[] = []
    const ctx: ProposalContext = {
      problem: {
        id: problem.id,
        title: problem.title,
        description: problem.description,
        numQubits: problem.numQubits,
        kinds: problem.kinds,
        optimumLabel: problem.optimumLabel,
      },
      grammar,
      elites: elites.map((e) => ({ id: e.id, text: e.text, fitness: e.fitness, detail: e.detail })),
      generation: g,
      count: EVOLVE_LIMITS.proposalsPerProvider,
    }
    // Every current elite goes in one prompt to each provider, so a proposed
    // child's true "inspiration" isn't knowable — `parentIds` here records
    // the whole elite set it was proposed against, not a single-parent edge.
    // `mutation`-operator children (elsewhere in this file) track one exact
    // parent; don't read this array the same way for provider-sourced ones.
    const parentIds = elites.map((e) => e.id)

    for (const provider of providers) {
      let texts: string[]
      try {
        texts = (await provider.propose(ctx)).slice(0, EVOLVE_LIMITS.proposalsPerProvider)
      } catch (cause) {
        providerErrors.push({ provider: provider.name, message: cause instanceof Error ? cause.message : String(cause) })
        continue
      }
      for (const text of texts) {
        const c = admit(g, text, parentIds, provider.name, rejected)
        if (c) children.push(c)
      }
    }

    // Fill the rest of the population with the seeded local operator.
    const slots = config.populationSize - elites.length
    while (children.length < slots) {
      const c = mutateFrom(g, elites, rejected)
      if (!c) break
      children.push(c)
    }

    population = [...elites, ...children].sort(compareCandidates).slice(0, config.populationSize)
    const gen: Generation = { index: g, population, best: population[0], rejected, providerErrors }
    generations.push(gen)
    if (compareCandidates(gen.best, run.best) < 0) run.best = gen.best
    hooks.onGeneration?.(gen, run)
  }

  return run
}

/**
 * The one assignment a MaxCut candidate "means", for drawing: a classical
 * program's final sides, or a qaoa program's most likely bitstring (bit q =
 * node q). Null for a circuit program.
 */
export function representativeCut(graph: Graph, program: Program): number | null {
  if (program.kind === 'classical') {
    return runClassical(graph, program).assignment.reduce((acc, s, i) => acc | (s << i), 0)
  }
  if (program.kind === 'qaoa') {
    const probs = runQaoa(graph, program.layers).probabilities()
    let top = 0
    for (let b = 1; b < probs.length; b++) if (probs[b] > probs[top]) top = b
    return top
  }
  return null
}

/** The fitness-per-generation curve the page plots: [best, mean] per generation. */
export function fitnessCurve(run: EvolutionRun): { best: number; mean: number }[] {
  return run.generations.map((g) => ({
    best: g.best.fitness,
    mean: g.population.reduce((s, c) => s + c.fitness, 0) / g.population.length,
  }))
}

/**
 * A plain-language rendering of one candidate — what the inspector shows next
 * to the DSL text. Numbers only, no adjectives.
 */
export function describeProgram(program: Program): string {
  switch (program.kind) {
    case 'qaoa':
      return (
        `QAOA with ${program.layers.length} layer${program.layers.length === 1 ? '' : 's'}. ` +
        program.layers
          .map((l, i) => `Layer ${i + 1}: cost γ=${fmt(l.gamma)}, ${l.mixer === 'x' ? 'X' : 'XY-ring'} mixer β=${fmt(l.beta)}.`)
          .join(' ')
      )
    case 'classical': {
      const s = program.start
      const startText =
        s.kind === 'zeros' ? 'everything on one side'
          : s.kind === 'alternate' ? 'alternate sides by index'
            : s.kind === 'greedy' ? 'greedy placement in index order'
              : `a random split from seed ${s.seed}`
      const steps = program.steps.map((st) =>
        st.op === 'sweep'
          ? `up to ${st.passes} best-improvement flip${st.passes === 1 ? '' : 's'}`
          : `kick ${st.flips} node${st.flips === 1 ? '' : 's'} (seed ${st.seed})`,
      )
      return `Local search starting from ${startText}${steps.length ? '; then ' + steps.join(', ') : ''}.`
    }
    case 'circuit':
      return `${program.ops.length} gate${program.ops.length === 1 ? '' : 's'}: ` +
        program.ops.map((op) => `${op.name}(${op.qubits.join(',')}${op.theta !== undefined ? `; θ=${fmt(op.theta)}` : ''})`).join(' → ')
  }
}
