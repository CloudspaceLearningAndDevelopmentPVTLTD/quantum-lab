import { describe, expect, it } from 'vitest'
import { StateVector, simulate, type Circuit } from '@/lib/quantum'
import {
  circuitMetrics,
  createRouterTrainer,
  decomposeToffoli,
  embedState,
  expandForRouting,
  greedyPolicyChooser,
  heuristicChooser,
  heuristicPolicyWeights,
  logPolicyGradient,
  policyLogits,
  POLICY_FEATURES,
  RECENCY_PENALTY,
  UNDO_PENALTY,
  routedEquivalent,
  sabreRoute,
  softmax,
  trainLearnedRouter,
  validateOnMap,
  type SwapCandidate,
} from './routing'
import { controlledPhase, ghzStarCircuit, qftCircuit, randomCircuit, ROUTING_PRESETS } from './routingPresets'
import { allToAllMap, buildTopology, gridMap, heavyHexMap, linearMap, ringMap, TOPOLOGY_KINDS } from './topology'

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol

describe('preprocessing', () => {
  it('the Toffoli decomposition matches CCX on every basis state and a superposition', () => {
    for (let x = 0; x < 8; x++) {
      const direct = StateVector.fromAmplitudes(
        Array.from({ length: 8 }, (_, i) => ({ re: i === x ? 1 : 0, im: 0 })),
      ).apply({ name: 'CCX', qubits: [0, 1, 2] })
      const viaOps = StateVector.fromAmplitudes(
        Array.from({ length: 8 }, (_, i) => ({ re: i === x ? 1 : 0, im: 0 })),
      )
      for (const op of decomposeToffoli(0, 1, 2)) viaOps.apply(op)
      for (let i = 0; i < 16; i++) expect(close(direct.data[i], viaOps.data[i])).toBe(true)
    }
    // Superposition: exercise the phases, not just the permutation.
    const a = new StateVector(3).applySingle('H', 0).applySingle('H', 1).applySingle('T', 2)
    const b = a.clone()
    a.apply({ name: 'CCX', qubits: [1, 2, 0] })
    for (const op of decomposeToffoli(1, 2, 0)) b.apply(op)
    for (let i = 0; i < 16; i++) expect(close(a.data[i], b.data[i])).toBe(true)
  })

  it('the controlled-phase decomposition is diag(1, 1, 1, e^{iθ})', () => {
    const theta = 0.7
    for (let x = 0; x < 4; x++) {
      const sv = StateVector.fromAmplitudes(
        Array.from({ length: 4 }, (_, i) => ({ re: i === x ? 1 : 0, im: 0 })),
      )
      for (const op of controlledPhase(0, 1, theta)) sv.apply(op)
      const amp = sv.amplitude(x)
      const want = x === 3 ? { re: Math.cos(theta), im: Math.sin(theta) } : { re: 1, im: 0 }
      expect(close(amp.re, want.re)).toBe(true)
      expect(close(amp.im, want.im)).toBe(true)
      for (let i = 0; i < 4; i++) if (i !== x) expect(sv.probability(i)).toBeLessThan(1e-18)
    }
  })

  it('QFT-3 on |1⟩ gives e^{2πi k/8}/√8 on the bit-reversed index', () => {
    const circuit = qftCircuit(3)
    circuit.ops.unshift({ name: 'X', qubits: [0] }) // |x=1⟩
    const sv = simulate(circuit)
    const rev = (k: number) => ((k & 1) << 2) | (k & 2) | ((k >> 2) & 1)
    for (let k = 0; k < 8; k++) {
      const amp = sv.amplitude(rev(k))
      const phase = (2 * Math.PI * k) / 8
      expect(close(amp.re, Math.cos(phase) / Math.SQRT2 / 2)).toBe(true)
      expect(close(amp.im, Math.sin(phase) / Math.SQRT2 / 2)).toBe(true)
    }
  })

  it('expandForRouting drops barriers, expands Toffolis and rejects bad operands', () => {
    const c: Circuit = {
      numQubits: 3,
      ops: [{ name: 'BARRIER', qubits: [] }, { name: 'CCX', qubits: [0, 1, 2] }, { name: 'H', qubits: [0] }],
    }
    const e = expandForRouting(c)
    expect(e.ops).toHaveLength(16)
    expect(e.ops.every((op) => op.qubits.length <= 2)).toBe(true)
    expect(() => expandForRouting({ numQubits: 2, ops: [{ name: 'CX', qubits: [0, 5] }] })).toThrow()
    expect(() => expandForRouting({ numQubits: 2, ops: [{ name: 'CX', qubits: [0] }] })).toThrow()
  })

  it('circuitMetrics counts a SWAP as three CX layers and three 2Q gates', () => {
    const c: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'SWAP', qubits: [1, 2] },
        { name: 'CX', qubits: [0, 2] },
        { name: 'BARRIER', qubits: [] },
      ],
    }
    // H(0)→1, CX(0,1)→2, SWAP(1,2) starts at 2 ends 5, CX(0,2) starts at 5 ends 6.
    expect(circuitMetrics(c)).toEqual({ ops: 4, twoQubitGates: 5, swaps: 1, depth: 6 })
  })
})

describe('the heuristic router', () => {
  const families = TOPOLOGY_KINDS

  it('routes a random 5-qubit circuit validly and equivalently on every family', () => {
    const circuit = randomCircuit(5, 4, 4, 11)
    for (const kind of families) {
      const map = buildTopology(kind, 5)
      const routed = sabreRoute(circuit, map, { seed: 3 })
      expect(routed.circuit.numQubits).toBe(5)
      expect(validateOnMap(routed.circuit, map), kind).toEqual([])
      const report = routedEquivalent(circuit, routed)
      expect(report.equivalent, `${kind}: max error ${report.maxError}`).toBe(true)
    }
  })

  it('routes QFT-5 on a line and GHZ-5 on a ring, with swaps, and stays equivalent', () => {
    const qft = sabreRoute(qftCircuit(5), linearMap(5), { seed: 1 })
    expect(qft.swapsAdded).toBeGreaterThan(0)
    expect(validateOnMap(qft.circuit, linearMap(5))).toEqual([])
    expect(routedEquivalent(qftCircuit(5), qft).equivalent).toBe(true)

    const ghz = sabreRoute(ghzStarCircuit(5), ringMap(5), { seed: 1 })
    expect(validateOnMap(ghz.circuit, ringMap(5))).toEqual([])
    expect(routedEquivalent(ghzStarCircuit(5), ghz).equivalent).toBe(true)
  })

  it('places 4 logical qubits on a 12-qubit heavy-hex and 5 on a 3×2 grid, equivalently', () => {
    const hex = heavyHexMap(12)
    const c4 = randomCircuit(4, 4, 5, 5)
    const r4 = sabreRoute(c4, hex, { seed: 2 })
    expect(r4.circuit.numQubits).toBe(12)
    expect(validateOnMap(r4.circuit, hex)).toEqual([])
    expect(routedEquivalent(c4, r4).equivalent).toBe(true)
    // The final layout is a real claim: perturb it and the check must fail.
    const wrong = { ...r4, finalLayout: [...r4.finalLayout].reverse() }
    expect(routedEquivalent(c4, wrong).equivalent).toBe(false)

    const grid = gridMap(6, 3)
    const c5 = randomCircuit(5, 3, 6, 9)
    const r5 = sabreRoute(c5, grid, { seed: 2 })
    expect(validateOnMap(r5.circuit, grid)).toEqual([])
    expect(routedEquivalent(c5, r5).equivalent).toBe(true)
  })

  it('never adds a SWAP on an all-to-all map, for every preset', () => {
    for (const preset of ROUTING_PRESETS) {
      const map = allToAllMap(preset.circuit.numQubits)
      const routed = sabreRoute(preset.circuit, map, { seed: 1 })
      expect(routed.swapsAdded, preset.id).toBe(0)
      expect(routed.circuit.ops).toHaveLength(expandForRouting(preset.circuit).ops.length)
      expect(routed.metrics.twoQubitGates).toBe(circuitMetrics(expandForRouting(preset.circuit)).twoQubitGates)
    }
  })

  it('GHZ-12 star on a line needs between 5 and 15 swaps', () => {
    // Lower bound: qubit 0 must become adjacent to 11 partners on a path where
    // it has at most 2 neighbours and each swap can introduce at most 2 new
    // ones. Upper bound: walking qubit 0 down the line costs 10.
    const routed = sabreRoute(ghzStarCircuit(12), linearMap(12), { seed: 1 })
    expect(routed.swapsAdded).toBeGreaterThanOrEqual(5)
    expect(routed.swapsAdded).toBeLessThanOrEqual(15)
    expect(validateOnMap(routed.circuit, linearMap(12))).toEqual([])
  })

  it('every preset routes validly on every family and is deterministic for a seed', () => {
    for (const preset of ROUTING_PRESETS) {
      for (const kind of families) {
        const map = buildTopology(kind, preset.circuit.numQubits)
        const a = sabreRoute(preset.circuit, map, { seed: 4 })
        const b = sabreRoute(preset.circuit, map, { seed: 4 })
        expect(validateOnMap(a.circuit, map), `${preset.id} on ${kind}`).toEqual([])
        expect(a.circuit.ops).toEqual(b.circuit.ops)
        expect(a.metrics.twoQubitGates).toBe(
          circuitMetrics(expandForRouting(preset.circuit)).twoQubitGates + 3 * a.swapsAdded,
        )
      }
    }
  })

  it('keeps a measurement after the gate that reads its bit', () => {
    const c: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'X', qubits: [2], condition: { bit: 0, value: 1 } },
        { name: 'MEASURE', qubits: [1], clbit: 0 },
      ],
    }
    const routed = sabreRoute(c, linearMap(3))
    const names = routed.circuit.ops.map((op) => `${op.name}${op.clbit ?? ''}${op.condition ? 'c' : ''}`)
    const i1 = names.indexOf('MEASURE0')
    const ix = names.indexOf('Xc')
    const i2 = names.lastIndexOf('MEASURE0')
    expect(i1).toBeLessThan(ix)
    expect(ix).toBeLessThan(i2)
  })

  it('rejects a circuit wider than the map and a disconnected map', () => {
    expect(() => sabreRoute(ghzStarCircuit(5), linearMap(4))).toThrow(/needs 5 qubits/)
    const disconnected = { ...linearMap(4), adjacency: [[1], [0], [3], [2]], distance: [[0, 1, Infinity, Infinity], [1, 0, Infinity, Infinity], [Infinity, Infinity, 0, 1], [Infinity, Infinity, 1, 0]] }
    expect(() => sabreRoute(ghzStarCircuit(4), disconnected)).toThrow(/not connected/)
  })

  it('embedState puts logical qubit q on physical qubit layout[q]', () => {
    const psi = new StateVector(2).applySingle('X', 1) // |10⟩ → logical 1 is set
    const phys = embedState(psi, [3, 0], 4)
    expect(phys.probability(1)).toBeCloseTo(1, 12) // physical qubit 0 is set
  })
})

describe('the learned router', () => {
  const candidate = (features: number[], heuristic: number): SwapCandidate => ({
    a: 0, b: 1, features, heuristic,
  })

  it('log-policy gradient matches finite differences', () => {
    const theta = [0.3, -1.2, 0.8, -0.4, 0.5, -0.7, 0.2, 1.1]
    const cands = [
      candidate([0.2, -0.1, 0.5, 0.0, 0, -1, 0.5, 0], 1),
      candidate([-0.5, 0.3, 0.0, 0.1, 1, 0, 0.25, 1], 2),
      candidate([0.1, 0.1, 0.25, 0.2, 0, 1, 1, 0], 3),
    ]
    expect(theta).toHaveLength(POLICY_FEATURES)
    const logp = (th: number[]) => Math.log(softmax(policyLogits(th, cands))[1])
    const grad = logPolicyGradient(theta, cands, 1)
    const h = 1e-6
    for (let i = 0; i < theta.length; i++) {
      const up = theta.slice(); up[i] += h
      const dn = theta.slice(); dn[i] -= h
      const numeric = (logp(up) - logp(dn)) / (2 * h)
      expect(Math.abs(grad[i] - numeric)).toBeLessThan(1e-6)
    }
  })

  it('the initial policy ranks candidates exactly as the heuristic does', () => {
    // The heuristic score is an affine function of the feature vector
    // (Δfront + 0.5·Δext + 0.125·recency + 0.25·undo, plus a shared constant)
    // and the initial logits are −8 times it, so argmax = argmin.
    for (let trial = 0; trial < 20; trial++) {
      const cands: SwapCandidate[] = []
      for (let i = 0; i < 6; i++) {
        const df = ((i * 5 + trial) % 3) - 1 + 0.1 * i
        const de = ((i * 7 + trial) % 5) / 5 - 0.4
        const rec = ((i + trial) % 4) * 0.1
        const undo = (i + trial) % 5 === 0 ? 1 : 0
        cands.push(candidate([df, de, i % 2 ? 0.5 : 0, rec, undo, 0, 0.5, 0], 3 + df + 0.5 * de + RECENCY_PENALTY * rec + UNDO_PENALTY * undo))
      }
      const greedy = greedyPolicyChooser(heuristicPolicyWeights())(cands, 0)
      const sabre = heuristicChooser(() => 0)(cands, 0)
      expect(cands[greedy].heuristic).toBeCloseTo(cands[sabre].heuristic, 12)
    }
  })

  it('trains on a 6-qubit circuit over a line: valid, equivalent, and no worse than the heuristic', () => {
    const circuit = randomCircuit(6, 5, 6, 21)
    const map = linearMap(6)
    const learned = trainLearnedRouter(circuit, map, 60, { seed: 3 })
    expect(learned.episodes).toBe(60)
    expect(learned.rewards).toHaveLength(60)
    expect(validateOnMap(learned.routed.circuit, map)).toEqual([])
    expect(validateOnMap(learned.greedy.circuit, map)).toEqual([])
    expect(routedEquivalent(circuit, learned.routed).equivalent).toBe(true)
    expect(routedEquivalent(circuit, learned.greedy).equivalent).toBe(true)
    expect(learned.routed.swapsAdded).toBeLessThanOrEqual(learned.heuristic.swapsAdded)
    expect(learned.routed.initialLayout).toEqual(learned.heuristic.initialLayout)
  })

  it('the trainer is incremental and its result is the better of greedy and best sample', () => {
    const circuit = ghzStarCircuit(5)
    const trainer = createRouterTrainer(circuit, ringMap(5), { seed: 8 })
    const p1 = trainer.episode()
    expect(p1.episode).toBe(1)
    expect(Number.isFinite(p1.reward)).toBe(true)
    for (let i = 0; i < 9; i++) trainer.episode()
    expect(trainer.episodes).toBe(10)
    const r = trainer.result()
    const cost = (m: { twoQubitGates: number; depth: number }) => m.twoQubitGates + 0.5 * m.depth
    expect(cost(r.routed.metrics)).toBe(Math.min(cost(r.greedy.metrics), cost(r.bestSampled.metrics)))
    expect(routedEquivalent(circuit, r.routed).equivalent).toBe(true)
  })

  it('never adds a SWAP on an all-to-all map either', () => {
    const learned = trainLearnedRouter(ROUTING_PRESETS[2].circuit, allToAllMap(10), 3, { seed: 1 })
    expect(learned.routed.swapsAdded).toBe(0)
    expect(learned.rewards.every((r) => r === -1)).toBe(true)
  })
})
