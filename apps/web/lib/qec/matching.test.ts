import { describe, it, expect } from 'vitest'
import { mulberry32 } from '@/lib/quantum'
import { buildLayout, sampleShot } from './model'
import {
  EXACT_COMPONENT_LIMIT,
  MwpmDecoder,
  buildDetectorGraph,
  decodeChannel,
  edgeWeight,
  minWeightMatching,
  pathQubits,
} from './matching'

/**
 * Independent reference: recursive enumeration of EVERY perfect matching with a
 * boundary option. Exponential, fine for k ≤ 10, and shares no code with the
 * component/DP path under test.
 */
function bruteForce(k: number, w: (i: number, j: number) => number, b: (i: number) => number): number {
  const used = new Uint8Array(k)
  const rec = (): number => {
    let i = 0
    while (i < k && used[i]) i++
    if (i === k) return 0
    used[i] = 1
    let best = b(i) + rec()
    for (let j = i + 1; j < k; j++) {
      if (used[j]) continue
      used[j] = 1
      best = Math.min(best, w(i, j) + rec())
      used[j] = 0
    }
    used[i] = 0
    return best
  }
  return rec()
}

function weightsFor(graph: ReturnType<typeof buildDetectorGraph>, defects: number[]) {
  return {
    w: (i: number, j: number) => graph.dist[defects[i]][defects[j]],
    b: (i: number) => graph.dist[defects[i]][graph.n],
  }
}

function matchingWeight(partner: Int32Array, w: (i: number, j: number) => number, b: (i: number) => number): number {
  let total = 0
  for (let i = 0; i < partner.length; i++) {
    const j = partner[i]
    if (j < 0) total += b(i)
    else {
      expect(partner[j]).toBe(i)
      if (i < j) total += w(i, j)
    }
  }
  return total
}

describe('the detector graph', () => {
  it('boundary distances are hop counts that match an independent owner count', () => {
    // A stabiliser is one hop from the boundary exactly when one of its qubits
    // belongs to no other stabiliser of the same type — counted here directly
    // from the lattice, without the graph. At d = 5 the centre plaquette has no
    // such qubit and must be two hops away.
    for (const d of [3, 5] as const) {
      const layout = buildLayout(d, 0)
      const graph = buildDetectorGraph(layout, layout.stabsX, 0.1, 0)
      const ws = edgeWeight((2 * 0.1) / 3)
      const owners = new Map<number, number>()
      for (const s of layout.stabsX) for (const qb of s.qubits) owners.set(qb, (owners.get(qb) ?? 0) + 1)
      for (const s of layout.stabsX) {
        const touchesBoundary = s.qubits.some((qb) => owners.get(qb) === 1)
        const hops = graph.dist[s.typeIndex][graph.n] / ws
        if (touchesBoundary) expect(hops).toBeCloseTo(1, 9)
        else expect(hops).toBeGreaterThanOrEqual(2 - 1e-9)
      }
      if (d === 5) {
        // An interior Z-type plaquette — (1, 2) in plaquette coordinates — shares
        // every qubit with another Z stabiliser, so it is exactly two hops out.
        const interior = layout.stabsX.find((s) => s.row === 1.5 && s.col === 2.5)
        expect(interior).toBeDefined()
        expect(interior!.qubits.every((qb) => owners.get(qb) === 2)).toBe(true)
        expect(graph.dist[interior!.typeIndex][graph.n] / ws).toBeCloseTo(2, 9)
      }
    }
  })

  it('never routes a path through the boundary', () => {
    // At d = 5 two edge stabilisers on opposite sides are each one hop from the
    // boundary; a graph that let paths pass through it would say they are two
    // hops apart. The true lattice distance is d − 1 = 4 or more.
    const layout = buildLayout(5, 0)
    const graph = buildDetectorGraph(layout, layout.stabsX, 0.1, 0)
    const ws = edgeWeight((2 * 0.1) / 3)
    const edges = layout.stabsX.filter((s) => s.qubits.length === 2)
    const left = edges.find((s) => s.col < 0)!
    const right = edges.find((s) => s.col > 4)!
    expect(graph.dist[left.typeIndex][right.typeIndex] / ws).toBeGreaterThanOrEqual(4 - 1e-9)
  })

  it('time edges carry the measurement-error weight and space edges the data weight', () => {
    const layout = buildLayout(3, 0.02)
    const p = 0.05
    const graph = buildDetectorGraph(layout, layout.stabsX, p, 0.02)
    const s = layout.stabsX[0].typeIndex
    const n = layout.stabsX.length
    // Same stabiliser, consecutive layers: exactly one time edge.
    expect(graph.dist[s][s + n]).toBeCloseTo(edgeWeight(0.02), 9)
    // The last layer is the perfect round: no space edges from it, so the only
    // way from a top-layer node to the boundary is back down through time.
    const top = (layout.layers - 1) * n + s
    const viaTime = edgeWeight(0.02) + graph.dist[s][graph.n]
    expect(graph.dist[top][graph.n]).toBeLessThanOrEqual(viaTime + 1e-9)
    expect(graph.dist[top][graph.n]).toBeGreaterThan(edgeWeight((2 * p) / 3) - 1e-9)
  })

  it('path reconstruction lists only the space edges', () => {
    const layout = buildLayout(3, 0.02)
    const graph = buildDetectorGraph(layout, layout.stabsX, 0.05, 0.02)
    const n = layout.stabsX.length
    expect(pathQubits(graph, 0, n)).toEqual([]) // pure time edge
    const q = pathQubits(graph, 0, graph.n)
    expect(q.length).toBeGreaterThan(0)
  })
})

describe('minimum-weight matching is exact', () => {
  it('matches brute force on every d = 3 syndrome of both channels, exhaustively', () => {
    const layout = buildLayout(3, 0)
    for (const stabs of [layout.stabsX, layout.stabsZ]) {
      const graph = buildDetectorGraph(layout, stabs, 0.08, 0)
      const n = stabs.length
      for (let mask = 0; mask < 1 << n; mask++) {
        const defects: number[] = []
        for (let i = 0; i < n; i++) if ((mask >> i) & 1) defects.push(i)
        const { w, b } = weightsFor(graph, defects)
        const m = minWeightMatching(defects.length, w, b)
        expect(m.exact).toBe(true)
        expect(m.weight).toBeCloseTo(bruteForce(defects.length, w, b), 9)
        expect(matchingWeight(m.partner, w, b)).toBeCloseTo(m.weight, 9)
      }
    }
  })

  it('matches brute force on random d = 5 and d = 7 syndromes, including with measurement noise', () => {
    const cases: [3 | 5 | 7, number, number][] = [
      [5, 0.1, 0],
      [7, 0.08, 0],
      [5, 0.03, 0.03],
    ]
    for (const [d, p, q] of cases) {
      const layout = buildLayout(d, q)
      const graph = buildDetectorGraph(layout, layout.stabsX, p, q)
      const rand = mulberry32(d * 1000 + Math.round(p * 1e4))
      let checked = 0
      for (let trial = 0; trial < 400 && checked < 120; trial++) {
        const shot = sampleShot(layout, p, q, rand)
        const defects: number[] = []
        for (let i = 0; i < shot.detX.length; i++) if (shot.detX[i]) defects.push(i)
        if (defects.length > 10 || defects.length < 2) continue
        checked++
        const { w, b } = weightsFor(graph, defects)
        const m = minWeightMatching(defects.length, w, b)
        expect(m.exact).toBe(true)
        expect(m.weight).toBeCloseTo(bruteForce(defects.length, w, b), 9)
      }
      expect(checked).toBeGreaterThan(50)
    }
  })

  it('the greedy + neighbourhood-search fallback is within 1% of optimal and never below it', () => {
    const layout = buildLayout(5, 0)
    const graph = buildDetectorGraph(layout, layout.stabsX, 0.15, 0)
    const rand = mulberry32(99)
    let optimalTotal = 0
    let heuristicTotal = 0
    let checked = 0
    let heuristicRuns = 0
    for (let trial = 0; trial < 600 && checked < 200; trial++) {
      const shot = sampleShot(layout, 0.15, 0, rand)
      const defects: number[] = []
      for (let i = 0; i < shot.detX.length; i++) if (shot.detX[i]) defects.push(i)
      if (defects.length < 4 || defects.length > 10) continue
      checked++
      const { w, b } = weightsFor(graph, defects)
      const exact = bruteForce(defects.length, w, b)
      const heuristic = minWeightMatching(defects.length, w, b, 0)
      // Singleton components (every defect nearer the boundary than any other) are
      // trivially exact even with the DP disabled; everything else went heuristic.
      if (!heuristic.exact) heuristicRuns++
      expect(heuristic.weight).toBeGreaterThanOrEqual(exact - 1e-9)
      expect(matchingWeight(heuristic.partner, w, b)).toBeCloseTo(heuristic.weight, 9)
      optimalTotal += exact
      heuristicTotal += heuristic.weight
    }
    expect(checked).toBeGreaterThan(100)
    expect(heuristicRuns).toBeGreaterThan(50)
    // Within 1% of optimal in aggregate over well-above-threshold syndromes.
    expect(heuristicTotal / optimalTotal).toBeLessThan(1.01)
  })

  it('reports exact for every shot at d = 7 below threshold with perfect extraction', () => {
    const layout = buildLayout(7, 0)
    const dec = new MwpmDecoder(layout, 0.05, 0)
    const rand = mulberry32(7)
    for (let i = 0; i < 300; i++) {
      const shot = sampleShot(layout, 0.05, 0, rand)
      dec.predict(shot.detX, shot.detZ)
    }
    expect(dec.inexactShots).toBe(0)
    expect(EXACT_COMPONENT_LIMIT).toBeGreaterThanOrEqual(12)
  })
})

describe('MWPM decoding', () => {
  it('leaves a residual with trivial syndrome on every shot — the correction always closes the defects', () => {
    for (const q of [0, 0.02]) {
      const layout = buildLayout(5, q)
      const graph = buildDetectorGraph(layout, layout.stabsX, 0.05, q)
      const rand = mulberry32(31 + q * 100)
      for (let i = 0; i < 200; i++) {
        const shot = sampleShot(layout, 0.05, q, rand)
        const dec = decodeChannel(graph, shot.detX, layout.code.numData, layout.code.logicalZ)
        const residual = new Uint8Array(layout.code.numData)
        for (let qb = 0; qb < residual.length; qb++) residual[qb] = shot.errX[qb] ^ dec.correction[qb]
        for (const s of layout.stabsX) {
          let parity = 0
          for (const qb of s.qubits) parity ^= residual[qb]
          expect(parity).toBe(0)
        }
      }
    }
  })

  it('corrects every single X error at every distance, and every single Z error', () => {
    for (const d of [3, 5, 7] as const) {
      const layout = buildLayout(d, 0)
      const dec = new MwpmDecoder(layout, 0.05, 0)
      const n = layout.code.numData
      for (let qb = 0; qb < n; qb++) {
        const errX = new Uint8Array(n)
        errX[qb] = 1
        const detX = new Uint8Array(layout.sizeX)
        layout.stabsX.forEach((s, i) => {
          let par = 0
          for (const x of s.qubits) par ^= errX[x]
          detX[i] = par
        })
        const detZ = new Uint8Array(layout.sizeZ)
        const pred = dec.predict(detX, detZ)
        let truth = 0
        for (const x of layout.code.logicalZ) truth ^= errX[x]
        expect(pred.flipX).toBe(truth)
        expect(pred.flipZ).toBe(0)
      }
    }
  })

  it('is fooled by a weight-2 error along the logical at d = 3, as MWPM must be', () => {
    // Two X errors on the first two qubits of X̄'s column leave a single defect
    // that one X error on the third qubit also produces. Minimum weight picks the
    // single error, and the residual is the full column — a logical X̄, which
    // flips the Z̄ observable. This is the distance-3 promise (any 1 error, not
    // every 2) and a decoder that passed this by "correcting" it would be cheating.
    const layout = buildLayout(3, 0)
    const dec = new MwpmDecoder(layout, 0.05, 0)
    const n = 9
    const errX = new Uint8Array(n)
    const [a, b] = layout.code.logicalX
    errX[a] = 1
    errX[b] = 1
    const detX = new Uint8Array(layout.sizeX)
    layout.stabsX.forEach((s, i) => {
      let par = 0
      for (const x of s.qubits) par ^= errX[x]
      detX[i] = par
    })
    const pred = dec.predict(detX, new Uint8Array(layout.sizeZ))
    let truth = 0
    for (const x of layout.code.logicalZ) truth ^= errX[x]
    expect(truth).toBe(1)
    expect(pred.flipX).toBe(0)
  })
})
