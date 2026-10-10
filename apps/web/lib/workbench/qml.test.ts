/**
 * Tests for lib/workbench/qml.ts — every expected value here is analytic,
 * a known benchmark or an independent numerical method, never the module's
 * own output read back.
 */
import { describe, expect, it } from 'vitest'
import {
  COMPARISON_DEFAULT,
  CostMeter,
  HIDDEN_CIRCUIT,
  VQC_DEFAULT,
  createLogRegTrainer,
  createMlpTrainer,
  decisionGrid,
  makeCircles,
  makeDataset,
  makeMoons,
  makeQuantumDataset,
  polynomialFeatures,
  runComparison,
  seededRng,
  splitDataset,
  vqcExpectation,
  vqcGradient,
  vqcLoss,
  vqcParamCount,
  type Dataset,
  type Split,
  type VqcConfig,
  type VqcParams,
} from './qml'

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

/** Tiny hand-built split: no generator involved, so nothing here depends on the datasets. */
function toySplit(rows: [number, number, 1 | -1][]): Split {
  const trainX = new Float64Array(rows.flatMap(([a, b]) => [a, b]))
  const trainY = Int8Array.from(rows.map((r) => r[2]))
  return {
    trainX,
    trainY,
    testX: trainX,
    testY: trainY,
    nTrain: rows.length,
    nTest: rows.length,
    mean: [0, 0],
    std: [1, 1],
  }
}

// ────────────────────────────────────────────────────────────
// The circuit
// ────────────────────────────────────────────────────────────

describe('vqcExpectation', () => {
  const cfg: VqcConfig = { numQubits: 2, layers: 1, encodingScale: 1 }

  it('reduces to cos(x₀)·cos(x₁) at θ = 0 — Heisenberg picture: CX maps Z₁ to Z₀Z₁', () => {
    const theta = new Float64Array(vqcParamCount(cfg))
    for (const [x0, x1] of [
      [0, 0],
      [0.7, -1.3],
      [Math.PI / 2, 0.4],
      [2.1, 2.9],
    ]) {
      near(vqcExpectation(cfg, theta, x0, x1), Math.cos(x0) * Math.cos(x1), 1e-12)
    }
  })

  it('folds a trainable RY on the readout qubit into the encoding angle, and ignores RZ', () => {
    // Layer 0 parameter order: q0 RY, q0 RZ, q1 RY, q1 RZ.
    const theta = Float64Array.from([0, 0.9, 0.55, -1.7])
    near(vqcExpectation(cfg, theta, 0.3, 1.1), Math.cos(0.3) * Math.cos(1.1 + 0.55), 1e-12)
  })

  it('scales features by κ', () => {
    const scaled: VqcConfig = { ...cfg, encodingScale: 2.5 }
    const theta = new Float64Array(vqcParamCount(scaled))
    near(vqcExpectation(scaled, theta, 0.4, 0.2), Math.cos(1.0) * Math.cos(0.5), 1e-12)
  })

  it('has 2·n·L trainable angles', () => {
    expect(vqcParamCount({ numQubits: 4, layers: 3, encodingScale: 1 })).toBe(24)
    expect(vqcParamCount(HIDDEN_CIRCUIT)).toBe(12)
  })

  it('charges the meter one circuit evaluation per call', () => {
    const meter = new CostMeter()
    const theta = new Float64Array(vqcParamCount(cfg))
    vqcExpectation(cfg, theta, 0.1, 0.2, meter)
    vqcExpectation(cfg, theta, 0.1, 0.2, meter)
    expect(meter.circuitEvals).toBe(2)
    expect(meter.flops).toBeGreaterThan(0)
  })

  /**
   * Schuld, Sweke & Meyer (2021): a circuit that encodes x through ONE rotation
   * outputs a + b·cos(κx) + c·sin(κx) in that feature, whatever θ is. Fit that
   * basis by least squares to samples of the model and the residual must
   * vanish; re-upload x three times and it must not.
   */
  it('is a single-frequency Fourier series in a feature encoded once', () => {
    const rng = seededRng(3)
    const residual = (layers: number) => {
      const c: VqcConfig = { numQubits: 2, layers, encodingScale: 1 }
      const theta = new Float64Array(vqcParamCount(c))
      for (let k = 0; k < theta.length; k++) theta[k] = 2 * Math.PI * rng()
      const xs = Array.from({ length: 12 }, (_, i) => -3 + i * 0.5)
      const f = xs.map((x) => vqcExpectation(c, theta, x, 0.4))
      // Normal equations for the 3-term basis.
      const basis = xs.map((x) => [1, Math.cos(x), Math.sin(x)])
      const A = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]
      const b = [0, 0, 0]
      basis.forEach((row, i) => {
        for (let p = 0; p < 3; p++) {
          b[p] += row[p] * f[i]
          for (let q = 0; q < 3; q++) A[p][q] += row[p] * row[q]
        }
      })
      // 3×3 Cramer's rule.
      const det = (m: number[][]) =>
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
      const D = det(A)
      const coef = [0, 1, 2].map((col) => {
        const m = A.map((row) => row.slice())
        for (let r = 0; r < 3; r++) m[r][col] = b[r]
        return det(m) / D
      })
      let ss = 0
      basis.forEach((row, i) => {
        const fit = row[0] * coef[0] + row[1] * coef[1] + row[2] * coef[2]
        ss += (fit - f[i]) ** 2
      })
      return Math.sqrt(ss / xs.length)
    }
    expect(residual(1)).toBeLessThan(1e-9)
    expect(residual(3)).toBeGreaterThan(0.05)
  })
})

// ────────────────────────────────────────────────────────────
// Gradients
// ────────────────────────────────────────────────────────────

describe('parameter-shift gradient', () => {
  it('matches the analytic derivative −cos(x₀)·sin(x₁ + θ) on the one-layer circuit', () => {
    const cfg: VqcConfig = { numQubits: 2, layers: 1, encodingScale: 1 }
    const t = 0.55
    const theta = Float64Array.from([0, 0, t, 0])
    const x0 = 0.3
    const x1 = 1.1
    const plus = Float64Array.from(theta)
    const minus = Float64Array.from(theta)
    plus[2] += Math.PI / 2
    minus[2] -= Math.PI / 2
    const shift = (vqcExpectation(cfg, plus, x0, x1) - vqcExpectation(cfg, minus, x0, x1)) / 2
    near(shift, -Math.cos(x0) * Math.sin(x1 + t), 1e-12)
  })

  for (const cfg of [
    { numQubits: 2, layers: 3, encodingScale: Math.PI / 2 },
    { numQubits: 4, layers: 2, encodingScale: 1 },
  ] as VqcConfig[]) {
    it(`agrees with central finite differences of the loss on ${cfg.numQubits} qubits × ${cfg.layers} layers`, () => {
      const rng = seededRng(11)
      const P = vqcParamCount(cfg)
      const theta = new Float64Array(P)
      for (let k = 0; k < P; k++) theta[k] = 2 * Math.PI * rng()
      const p: VqcParams = { theta, w: 1.7, b: -0.2 }
      const X = new Float64Array(16)
      for (let i = 0; i < X.length; i++) X[i] = 3 * rng() - 1.5
      const Y = Int8Array.from([1, -1, 1, 1, -1, -1, 1, -1])
      const rows = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7])
      const meter = new CostMeter()
      const g = vqcGradient(cfg, p, X, Y, rows, meter)

      const h = 1e-4
      for (let k = 0; k < P; k++) {
        const up = { ...p, theta: Float64Array.from(theta) }
        const down = { ...p, theta: Float64Array.from(theta) }
        up.theta[k] += h
        down.theta[k] -= h
        const fd = (vqcLoss(cfg, up, X, Y, rows) - vqcLoss(cfg, down, X, Y, rows)) / (2 * h)
        near(g.theta[k], fd, 1e-6)
      }
      const fdW = (vqcLoss(cfg, { ...p, w: p.w + h }, X, Y, rows) - vqcLoss(cfg, { ...p, w: p.w - h }, X, Y, rows)) / (2 * h)
      const fdB = (vqcLoss(cfg, { ...p, b: p.b + h }, X, Y, rows) - vqcLoss(cfg, { ...p, b: p.b - h }, X, Y, rows)) / (2 * h)
      near(g.w, fdW, 1e-6)
      near(g.b, fdB, 1e-6)
      near(g.loss, vqcLoss(cfg, p, X, Y, rows), 1e-12)

      // (2P + 1) circuit runs per row: one forward, two shifted per angle.
      expect(meter.circuitEvals).toBe((2 * P + 1) * rows.length)
    })
  }
})

// ────────────────────────────────────────────────────────────
// Datasets and the split
// ────────────────────────────────────────────────────────────

describe('datasets', () => {
  it('moons: noiseless points lie on the two semicircles of make_moons', () => {
    const ds = makeMoons(60, 0, seededRng(1))
    for (let i = 0; i < ds.n; i++) {
      const x = ds.x[2 * i]
      const y = ds.x[2 * i + 1]
      if (ds.y[i] === 1) {
        near(x * x + y * y, 1, 1e-12)
        expect(y).toBeGreaterThanOrEqual(-1e-12)
      } else {
        near((x - 1) ** 2 + (y - 0.5) ** 2, 1, 1e-12)
        expect(y).toBeLessThanOrEqual(0.5 + 1e-12)
      }
    }
  })

  it('circles: noiseless radii are 1 and the factor', () => {
    const ds = makeCircles(50, 0, 0.5, seededRng(1))
    for (let i = 0; i < ds.n; i++) {
      const r = Math.hypot(ds.x[2 * i], ds.x[2 * i + 1])
      near(r, ds.y[i] === 1 ? 1 : 0.5, 1e-12)
    }
  })

  it('quantum: labels are the hidden circuit thresholded at its median, balanced and reproducible', () => {
    const a = makeQuantumDataset(101, seededRng(4))
    const b = makeQuantumDataset(101, seededRng(4))
    expect(Array.from(a.y)).toEqual(Array.from(b.y))
    let plus = 0
    for (const v of a.y) if (v === 1) plus++
    expect(Math.abs(2 * plus - a.n)).toBeLessThanOrEqual(1)
    // Every input sits on the unit-variance square.
    for (let i = 0; i < 2 * a.n; i++) expect(Math.abs(a.x[i])).toBeLessThanOrEqual(Math.sqrt(3))
    // A larger circuit output means a +1 label, for every pair of rows.
    const theta = (() => {
      const r = seededRng(2026)
      const t = new Float64Array(vqcParamCount(HIDDEN_CIRCUIT))
      for (let i = 0; i < t.length; i++) t[i] = 2 * Math.PI * r()
      return t
    })()
    const f = Array.from({ length: a.n }, (_, i) =>
      vqcExpectation(HIDDEN_CIRCUIT, theta, a.x[2 * i], a.x[2 * i + 1]),
    )
    const maxMinus = Math.max(...f.filter((_, i) => a.y[i] === -1))
    const minPlus = Math.min(...f.filter((_, i) => a.y[i] === 1))
    expect(minPlus).toBeGreaterThanOrEqual(maxMinus)
  })

  it('shuffles the classical sets so a prefix split is not one class', () => {
    const ds = makeDataset('moons', 7, 100)
    let plusInFirstHalf = 0
    for (let i = 0; i < 50; i++) if (ds.y[i] === 1) plusInFirstHalf++
    expect(plusInFirstHalf).toBeGreaterThan(10)
    expect(plusInFirstHalf).toBeLessThan(40)
  })

  it('splitDataset holds out the last 30% and standardises on training statistics only', () => {
    const ds = makeDataset('circles', 3, 100)
    const s = splitDataset(ds, 0.3)
    expect(s.nTrain).toBe(70)
    expect(s.nTest).toBe(30)
    for (let f = 0; f < 2; f++) {
      let m = 0
      for (let i = 0; i < s.nTrain; i++) m += s.trainX[2 * i + f]
      m /= s.nTrain
      let v = 0
      for (let i = 0; i < s.nTrain; i++) v += (s.trainX[2 * i + f] - m) ** 2
      near(m, 0, 1e-12)
      near(Math.sqrt(v / s.nTrain), 1, 1e-12)
      // Test rows are the raw rows through the SAME affine map.
      near(s.testX[f], (ds.x[2 * s.nTrain + f] - s.mean[f]) / s.std[f], 1e-12)
    }
    expect(Array.from(s.testY)).toEqual(Array.from(ds.y.slice(70)))
  })
})

// ────────────────────────────────────────────────────────────
// Classical baselines
// ────────────────────────────────────────────────────────────

describe('logistic regression', () => {
  it('builds the ten cubic monomials, constant first', () => {
    const phi = Array.from(polynomialFeatures(2, 3, 3))
    expect(phi).toEqual([1, 2, 3, 4, 6, 9, 8, 12, 18, 27])
    expect(polynomialFeatures(0.5, 0.5, 1).length).toBe(3)
  })

  it('separates a linearly separable set perfectly with degree 1', () => {
    const split = toySplit([
      [-1, -1, -1],
      [-1, 1, -1],
      [-2, 0.5, -1],
      [1, 1, 1],
      [1, -1, 1],
      [2, -0.5, 1],
    ])
    const t = createLogRegTrainer(split, { degree: 1, l2: 1e-3, maxSteps: 25 })
    while (!t.step()) {
      /* converge */
    }
    expect(t.report().trainAcc).toBe(1)
    expect(t.report().cost.circuitEvals).toBe(0)
  })

  it('reaches above 90% held-out accuracy on moons', () => {
    const split = splitDataset(makeDataset('moons', 7))
    const t = createLogRegTrainer(split)
    while (!t.step()) {
      /* converge */
    }
    const r = t.report()
    expect(r.done).toBe(true)
    expect(r.testAcc).toBeGreaterThan(0.9)
    // And a straight line cannot: the known ceiling of a linear fit on moons.
    const line = createLogRegTrainer(split, { degree: 1, l2: 1e-3, maxSteps: 25 })
    while (!line.step()) {
      /* converge */
    }
    expect(line.report().testAcc).toBeLessThan(r.testAcc)
  })
})

describe('mlp', () => {
  it('learns circles, which no straight line can', () => {
    const split = splitDataset(makeDataset('circles', 7))
    const t = createMlpTrainer(split, { hidden: 16, lr: 0.02, batchSize: 32, maxSteps: 600 }, seededRng(9))
    let steps = 0
    while (!t.step()) steps++
    expect(steps + 1).toBe(600)
    const r = t.report()
    expect(r.testAcc).toBeGreaterThan(0.9)
    expect(r.params).toBe(2 * 16 + 16 + 16 + 1)
    expect(r.cost.circuitEvals).toBe(0)
    expect(r.cost.flops).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────────────────
// The headline comparison
// ────────────────────────────────────────────────────────────

describe('runComparison', () => {
  it('on the quantum-generated set the VQC beats logistic regression by at least 15 points (seed 7)', () => {
    const r = runComparison({ ...COMPARISON_DEFAULT, dataset: 'quantum', seed: 7 })
    expect(r.vqc.testAcc - r.logreg.testAcc).toBeGreaterThanOrEqual(0.15)
    expect(r.vqc.testAcc).toBeGreaterThan(0.9)
    expect(r.logreg.testAcc).toBeLessThan(0.8)
    expect(r.vqc.done && r.mlp.done && r.logreg.done).toBe(true)
    // Cost is reported in the right currency for each model.
    expect(r.vqc.cost.circuitEvals).toBeGreaterThan(100_000)
    expect(r.logreg.cost.circuitEvals).toBe(0)
    expect(r.mlp.cost.circuitEvals).toBe(0)
    expect(r.vqc.cost.flops).toBeGreaterThan(r.mlp.cost.flops)
  })

  it('on moons the classical baselines are at least as good as the VQC (seed 7)', () => {
    const r = runComparison({ ...COMPARISON_DEFAULT, dataset: 'moons', seed: 7 })
    expect(r.logreg.testAcc).toBeGreaterThanOrEqual(r.vqc.testAcc)
    expect(r.logreg.testAcc).toBeGreaterThan(0.9)
    expect(r.mlp.testAcc).toBeGreaterThan(0.9)
  })

  it('paints a decision grid of the requested resolution', () => {
    const split = splitDataset(makeDataset('circles', 7, 60))
    const t = createLogRegTrainer(split)
    while (!t.step()) {
      /* converge */
    }
    const g = decisionGrid(t, 8, 2)
    expect(g.length).toBe(64)
    // Circles: the centre is the inner class (−1), the corners are outside (+1).
    expect(g[3 * 8 + 3]).toBeLessThan(0)
    expect(g[0]).toBeGreaterThan(0)
  })
})

// A dataset the trainers never see, to make sure nothing reads global state.
describe('trainer isolation', () => {
  it('two VQC trainers on different seeds do not share parameters', () => {
    const ds: Dataset = makeDataset('moons', 1, 40)
    const split = splitDataset(ds)
    const a = createMlpTrainer(split, { hidden: 4, lr: 0.05, batchSize: 8, maxSteps: 3 }, seededRng(1))
    const b = createMlpTrainer(split, { hidden: 4, lr: 0.05, batchSize: 8, maxSteps: 3 }, seededRng(2))
    a.step()
    b.step()
    expect(a.score(0.1, 0.2)).not.toBe(b.score(0.1, 0.2))
    expect(VQC_DEFAULT.numQubits).toBe(2)
  })
})
