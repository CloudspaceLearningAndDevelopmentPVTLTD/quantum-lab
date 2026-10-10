import { describe, expect, it } from 'vitest'
import { mulberry32, simulate, type Circuit } from '@/lib/quantum'
import { NOISELESS, expectation, overlap2, runNoisy, type NoiseModel } from '@/lib/quantum/noise'
import {
  LearnedExtrapolator,
  Mlp,
  ZNE_SCALES,
  calibrateReadout,
  clipToProbabilities,
  exponentialFit,
  extrapolateToZero,
  foldCircuit,
  invertConfusionMatrix,
  inverseGate,
  mitigateReadout,
  mitigationPipeline,
  polynomialFit,
  postProcess,
  resampleCounts,
  syntheticCurve,
} from './mitigation'

/**
 * Expected values are hand-computed from the definitions: a confusion matrix
 * multiplied out by hand, a line's intercept, e^{−a·0}. None come from the
 * functions under test.
 */

describe('readout mitigation', () => {
  it('per-qubit inversion recovers a known distribution from its confused image', () => {
    // True 2-qubit distribution and per-qubit confusion.
    const pTrue = [0.5, 0.1, 0.15, 0.25]
    const q0 = { p1given0: 0.03, p0given1: 0.12 }
    const q1 = { p1given0: 0.07, p0given1: 0.05 }
    // Forward-apply the confusion by hand: index bit0 = qubit 0, bit1 = qubit 1.
    const a0 = [[1 - q0.p1given0, q0.p0given1], [q0.p1given0, 1 - q0.p0given1]]
    const a1 = [[1 - q1.p1given0, q1.p0given1], [q1.p1given0, 1 - q1.p0given1]]
    const measured = new Array<number>(4).fill(0)
    for (let rep = 0; rep < 4; rep++) {
      for (let tru = 0; tru < 4; tru++) {
        const r0 = rep & 1, r1 = (rep >> 1) & 1
        const t0 = tru & 1, t1 = (tru >> 1) & 1
        measured[rep] += a0[r0][t0] * a1[r1][t1] * pTrue[tru]
      }
    }
    const recovered = mitigateReadout(measured, { numQubits: 2, qubits: [q0, q1] })
    for (let i = 0; i < 4; i++) expect(recovered[i]).toBeCloseTo(pTrue[i], 10)
  })

  it('full-matrix inversion recovers a distribution through a correlated confusion matrix', () => {
    const A = [
      [0.9, 0.05, 0.1, 0.02],
      [0.04, 0.85, 0.02, 0.08],
      [0.04, 0.02, 0.8, 0.1],
      [0.02, 0.08, 0.08, 0.8],
    ]
    const pTrue = [0.2, 0.3, 0.4, 0.1]
    const measured = A.map((row) => row.reduce((s, a, j) => s + a * pTrue[j], 0))
    const recovered = invertConfusionMatrix(A, measured)
    recovered.forEach((v, i) => expect(v).toBeCloseTo(pTrue[i], 10))
  })

  it('calibrates from the |0…0⟩ and |1…1⟩ circuits run on the noisy engine', () => {
    const model: NoiseModel = { ...NOISELESS, readout: { p1given0: 0.04, p0given1: 0.1 } }
    const shots = 40000
    const cal = calibrateReadout((c) => runNoisy(c, model, shots, 3).distribution, 2)
    for (const q of cal.qubits) {
      expect(Math.abs(q.p1given0 - 0.04)).toBeLessThan(4 * Math.sqrt((0.04 * 0.96) / shots))
      expect(Math.abs(q.p0given1 - 0.1)).toBeLessThan(4 * Math.sqrt((0.1 * 0.9) / shots))
    }
  })

  it('mitigated ⟨ZZ⟩ of a Bell pair moves from 1−2(e0+e1)-ish back toward 1', () => {
    const bell: Circuit = { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }] }
    const model: NoiseModel = { ...NOISELESS, readout: { p1given0: 0.05, p0given1: 0.05 } }
    const shots = 40000
    const raw = runNoisy(bell, model, shots, 5).distribution
    const cal = calibrateReadout((c) => runNoisy(c, model, shots, 9).distribution, 2)
    const zz = { type: 'pauliZ' as const, qubits: [0, 1] }
    // Symmetric 5% flips on each of two qubits: ⟨ZZ⟩ = (1−2·0.05)² = 0.81.
    expect(Math.abs(expectation(raw, zz) - 0.81)).toBeLessThan(0.02)
    expect(Math.abs(expectation(mitigateReadout(raw, cal), zz) - 1)).toBeLessThan(0.02)
  })

  it('a singular per-qubit matrix throws; clipping renormalises', () => {
    expect(() => mitigateReadout([1, 0], { numQubits: 1, qubits: [{ p1given0: 0.5, p0given1: 0.5 }] })).toThrow()
    const clipped = clipToProbabilities([-0.1, 0.6, 0.5, 0])
    expect(Array.from(clipped)).toEqual([0, 0.6 / 1.1, 0.5 / 1.1, 0])
  })
})

describe('gate folding', () => {
  const circuit: Circuit = {
    numQubits: 2,
    ops: [
      { name: 'H', qubits: [0] },
      { name: 'T', qubits: [0] },
      { name: 'RY', qubits: [1], theta: 0.4 },
      { name: 'CX', qubits: [0, 1] },
      { name: 'S', qubits: [1] },
      { name: 'BARRIER', qubits: [] },
    ],
  }

  it('leaves the ideal state unchanged and multiplies the gate count', () => {
    const ideal = simulate(circuit)
    for (const scale of [1, 3, 5, 7]) {
      const folded = foldCircuit(circuit, scale)
      const unitaryOps = (c: Circuit) => c.ops.filter((o) => o.name !== 'BARRIER').length
      expect(unitaryOps(folded)).toBe(scale * unitaryOps(circuit))
      expect(folded.ops.filter((o) => o.name === 'BARRIER')).toHaveLength(1)
      expect(overlap2(ideal, simulate(folded))).toBeCloseTo(1, 10)
    }
  })

  it('inverses are inverses', () => {
    const one = (name: Circuit['ops'][number]['name'], theta?: number) => {
      const sv = simulate({ numQubits: 1, ops: [{ name: 'H', qubits: [0] }, { name: 'T', qubits: [0] }] })
      const sv2 = sv.clone().apply({ name, qubits: [0], theta }).apply(inverseGate({ name, qubits: [0], theta }))
      return overlap2(sv, sv2)
    }
    for (const g of ['H', 'X', 'Y', 'Z', 'S', 'SDG', 'T', 'TDG'] as const) expect(one(g)).toBeCloseTo(1, 12)
    for (const g of ['RX', 'RY', 'RZ', 'P'] as const) expect(one(g, 1.234)).toBeCloseTo(1, 12)
  })

  it('rejects even scales', () => {
    expect(() => foldCircuit(circuit, 2)).toThrow()
    expect(() => foldCircuit(circuit, 0)).toThrow()
  })

  it('a folded circuit really is noisier', () => {
    const model: NoiseModel = { ...NOISELESS, depolarising1: 0.02, depolarising2: 0.05 }
    const f1 = runNoisy(foldCircuit(circuit, 1), model, 3000, 2).fidelity
    const f5 = runNoisy(foldCircuit(circuit, 5), model, 3000, 2).fidelity
    expect(f1).toBeGreaterThan(f5 + 0.1)
  })
})

describe('extrapolation', () => {
  it('linear ZNE on a synthetic line recovers the intercept', () => {
    // E(λ) = 0.87 − 0.09λ
    const values = ZNE_SCALES.map((s) => 0.87 - 0.09 * s)
    const lin = extrapolateToZero(ZNE_SCALES, values, 'linear')
    expect(lin.value).toBeCloseTo(0.87, 10)
    expect(lin.curve(3)).toBeCloseTo(0.6, 10)
    const quad = extrapolateToZero(ZNE_SCALES, values, 'quadratic')
    expect(quad.value).toBeCloseTo(0.87, 10)
  })

  it('quadratic ZNE recovers a parabola exactly; linear does not', () => {
    const values = ZNE_SCALES.map((s) => 0.5 + 0.1 * s - 0.03 * s * s)
    expect(extrapolateToZero(ZNE_SCALES, values, 'quadratic').value).toBeCloseTo(0.5, 10)
    expect(Math.abs(extrapolateToZero(ZNE_SCALES, values, 'linear').value - 0.5)).toBeGreaterThan(0.01)
  })

  it('polynomialFit is least squares on an overdetermined system', () => {
    // Points on y = 2 + 3x with symmetric ±1 residuals: the line is still 2 + 3x.
    const xs = [0, 1, 2, 3]
    const ys = [2 + 1, 5 - 1, 8 - 1, 11 + 1]
    const c = polynomialFit(xs, ys, 1)
    expect(c[0]).toBeCloseTo(2, 10)
    expect(c[1]).toBeCloseTo(3, 10)
  })

  it('exponential fit recovers an exact exponential decay', () => {
    // E(λ) = 0.05 + 0.75·e^{−0.3λ}; E(0) = 0.8
    const values = ZNE_SCALES.map((s) => 0.05 + 0.75 * Math.exp(-0.3 * s))
    const fit = exponentialFit(ZNE_SCALES, values)
    expect(fit.a).toBeCloseTo(0.3, 2)
    expect(fit.c).toBeCloseTo(0.05, 2)
    expect(extrapolateToZero(ZNE_SCALES, values, 'exponential').value).toBeCloseTo(0.8, 2)
  })
})

describe('the learned extrapolator', () => {
  it('MLP gradient matches central finite differences', () => {
    const net = new Mlp([3, 5, 4, 1], mulberry32(2))
    const xs = [[0.3, -0.2, 0.5], [-0.7, 0.1, 0.9]]
    const ys = [0.4, -0.3]
    const { grads } = net.gradient(xs, ys)
    const params = net.parameters()
    const loss = () => net.gradient(xs, ys).loss
    const h = 1e-6
    let checked = 0
    for (let p = 0; p < params.length; p++) {
      for (let i = 0; i < params[p].length; i += 3) {
        const orig = params[p][i]
        params[p][i] = orig + h
        const lp = loss()
        params[p][i] = orig - h
        const lm = loss()
        params[p][i] = orig
        const fd = (lp - lm) / (2 * h)
        expect(Math.abs(fd - grads[p][i])).toBeLessThan(1e-6 * Math.max(1, Math.abs(fd)))
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('respects its step budget and is deterministic for a seed', () => {
    const a = new LearnedExtrapolator({ seed: 3, budget: 20 })
    expect(a.trainSteps(7).step).toBe(7)
    expect(a.trainSteps(100).step).toBe(20)
    expect(a.status().done).toBe(true)
    const b = new LearnedExtrapolator({ seed: 3, budget: 20 })
    b.trainSteps(20)
    expect(a.predict([0.8, 0.5, 0.3])).toBe(b.predict([0.8, 0.5, 0.3]))
  })

  it('after training, beats the linear fit on held-out noisy exponentials', () => {
    const ex = new LearnedExtrapolator({ seed: 11, budget: 500 })
    ex.trainSteps(500)
    expect(ex.status().loss).toBeLessThan(0.02)
    const rng = mulberry32(99)
    let mlpErr = 0, linErr = 0
    const trials = 200
    for (let t = 0; t < trials; t++) {
      const { inputs, target } = syntheticCurve(rng)
      mlpErr += (ex.predict(inputs) - target) ** 2
      linErr += (extrapolateToZero(ZNE_SCALES, inputs, 'linear').value - target) ** 2
    }
    expect(mlpErr / trials).toBeLessThan(linErr / trials)
    // And a clean exponential's intercept lands close.
    const clean = ZNE_SCALES.map((s) => 0.02 + 0.68 * Math.exp(-0.25 * s))
    expect(Math.abs(ex.predict(clean) - 0.7)).toBeLessThan(0.08)
  })
})

describe('the pipeline', () => {
  const bell: Circuit = { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }] }
  const zz = { type: 'pauliZ' as const, qubits: [0, 1] }

  it('with zero noise every number is the ideal one and the error bars are tiny', () => {
    const r = mitigationPipeline(bell, zz, NOISELESS, { shots: 2000, method: 'linear', bootstrap: 10 })
    expect(r.ideal).toBeCloseTo(1, 12)
    expect(r.noisy).toBe(1)
    expect(r.readoutMitigated).toBeCloseTo(1, 10)
    expect(r.zne).toBeCloseTo(1, 10)
    expect(r.zneStderr).toBeLessThan(1e-9)
    expect(r.points.map((p) => p.gateCount)).toEqual([2, 6, 10])
  })

  /**
   * Bell pair, two-qubit depolarising p after the CX, readout flips on top.
   * Of the 15 non-identity Paulis, 8 flip the ZZ parity (X or Y on exactly
   * one qubit), so one fold gives ⟨ZZ⟩ = 1 − 2·(8/15)·p, and λ folds give
   * (1 − 2·(8/15)·p)^λ: an exact exponential in the fold count. With p = 0.08:
   * 0.9147, 0.765, 0.640 at scales 1, 3, 5. The exponential fit therefore
   * recovers 1 up to shot noise; the least-squares line through those three
   * points has intercept 0.979 — biased low by the curvature, still far
   * closer than the unextrapolated 0.9147.
   */
  const p2 = 0.08
  const q = (8 / 15) * p2
  const noisyModel: NoiseModel = {
    depolarising1: 0,
    depolarising2: p2,
    t1: Infinity,
    t2: Infinity,
    readout: { p1given0: 0.03, p0given1: 0.06 },
  }

  it('readout mitigation lands on the analytic gate-noise-only value', () => {
    const r = mitigationPipeline(bell, zz, noisyModel, { shots: 8000, method: 'linear', seed: 4, bootstrap: 30 })
    // Raw: parity also flips with readout; for Bell the mean per-qubit flip is 0.045.
    expect(Math.abs(r.noisy - (1 - 2 * q) * (1 - 0.09) ** 2)).toBeLessThan(0.02)
    expect(Math.abs(r.readoutMitigated - (1 - 2 * q))).toBeLessThan(3 * r.readoutStderr + 0.005)
    expect(r.readoutStderr).toBeGreaterThan(r.noisyStderr)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(r.points[i].readoutMitigated - (1 - 2 * q) ** ZNE_SCALES[i])).toBeLessThan(0.03)
    }
    expect(r.points[2].fidelity).toBeLessThan(r.points[0].fidelity)
  })

  it('exponential ZNE recovers the ideal; linear ZNE lands at the curvature-biased 0.979', () => {
    const exp = mitigationPipeline(bell, zz, noisyModel, { shots: 8000, method: 'exponential', seed: 4, bootstrap: 30 })
    expect(Math.abs(exp.zne - 1)).toBeLessThan(3 * exp.zneStderr + 0.01)
    expect(exp.zneStderr).toBeGreaterThan(exp.readoutStderr)
    const lin = mitigationPipeline(bell, zz, noisyModel, { shots: 8000, method: 'linear', seed: 4, bootstrap: 30 })
    expect(Math.abs(lin.zne - 0.979)).toBeLessThan(0.03)
    expect(Math.abs(lin.zne - 1)).toBeLessThan(Math.abs(lin.readoutMitigated - 1))
    expect(typeof lin.curve).toBe('function')
    expect(lin.curve!(0)).toBeCloseTo(lin.zne, 12)
  })

  it('a faulty X in the calibration circuit is booked as readout error and over-corrects', () => {
    // Same device plus depolarising 0.03 on single-qubit gates: the |1…1⟩
    // calibration circuit's X gates flip back with probability 2·0.03/3 = 0.02
    // per qubit, which the calibration cannot tell from p(0|1). The corrected
    // ⟨ZZ⟩ then overshoots the true gate-noise value — the SPAM ambiguity
    // every hardware readout calibration has.
    const r = mitigationPipeline(bell, zz, { ...noisyModel, depolarising1: 0.03 }, { shots: 8000, method: 'linear', seed: 2, bootstrap: 20 })
    for (const c of r.calibration.qubits) expect(c.p0given1).toBeGreaterThan(0.06 + 0.01)
    expect(r.readoutMitigated).toBeGreaterThan(1 - 2 * q + 0.01)
  })

  it('postProcess refits the same measurements under another method', () => {
    const lin = mitigationPipeline(bell, zz, noisyModel, { shots: 2000, method: 'linear', seed: 4, bootstrap: 10 })
    const quad = postProcess(lin.raw, 'quadratic')
    expect(quad.points.map((p) => p.readoutMitigated)).toEqual(lin.points.map((p) => p.readoutMitigated))
    expect(quad.noisy).toBe(lin.noisy)
    expect(quad.method).toBe('quadratic')
    expect(quad.zne).not.toBe(lin.zne)
    // Refitting linearly reproduces the original exactly.
    expect(postProcess(lin.raw, 'linear').zne).toBe(lin.zne)
  })

  it('resampleCounts keeps the total and roughly the shape', () => {
    const out = resampleCounts([700, 200, 100, 0], mulberry32(1))
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    expect(out[3]).toBe(0)
    expect(Math.abs(out[0] - 0.7)).toBeLessThan(0.06)
  })
})
