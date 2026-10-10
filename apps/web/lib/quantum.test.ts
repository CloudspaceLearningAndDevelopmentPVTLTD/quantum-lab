import { describe, it, expect } from 'vitest'
import {
  c,
  cAdd,
  cSub,
  cMul,
  cScale,
  cAbs,
  cAbs2,
  cArg,
  cConj,
  cExp,
  StateVector,
  emptyCircuit,
  simulate,
  simulateSteps,
  run,
  mulberry32,
  toQasm,
  fromQasm,
  PRESETS,
  formatComplex,
  formatKet,
  execute,
  outcomeBranches,
  hasClassicalControl,
  gateMatrix,
  type Circuit,
  type Complex,
  type GateName,
  type GateOp,
} from './quantum'
import { circuitUnitary, processFidelity } from './workbench/verify'
import { u3Matrix } from './quantum/gates-extended'

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

const near = (a: number, b: number, digits = 9) => expect(a).toBeCloseTo(b, digits)

const nearC = (a: Complex, b: Complex, digits = 9) => {
  expect(a.re).toBeCloseTo(b.re, digits)
  expect(a.im).toBeCloseTo(b.im, digits)
}

const sv = (n: number) => new StateVector(n)

const preset = (id: string): Circuit => {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`missing preset ${id}`)
  return p.circuit
}

const R2 = Math.SQRT1_2

// ────────────────────────────────────────────────────────────

describe('complex arithmetic', () => {
  it('multiplies (1+2i)(3+4i) = -5+10i', () => {
    nearC(cMul(c(1, 2), c(3, 4)), c(-5, 10))
  })

  it('takes the modulus of 3+4i', () => {
    near(cAbs(c(3, 4)), 5)
    near(cAbs2(c(3, 4)), 25)
  })

  it('takes the argument of i', () => {
    near(cArg(c(0, 1)), Math.PI / 2)
    near(cArg(c(1, 0)), 0)
  })

  it('evaluates e^{i pi} = -1', () => {
    nearC(cExp(Math.PI), c(-1, 0))
    nearC(cExp(0), c(1, 0))
    nearC(cExp(Math.PI / 2), c(0, 1))
  })

  it('conjugates and scales', () => {
    nearC(cConj(c(2, -3)), c(2, 3))
    nearC(cScale(c(2, -3), 2), c(4, -6))
    nearC(cMul(c(2, 3), cConj(c(2, 3))), c(cAbs2(c(2, 3)), 0))
  })

  it('adds and subtracts', () => {
    nearC(cAdd(c(1, 2), c(3, -5)), c(4, -3))
    nearC(cSub(c(1, 2), c(3, -5)), c(-2, 7))
  })
})

describe('single-qubit gates', () => {
  it('H on |0> gives equal probabilities', () => {
    const s = sv(1).applySingle('H', 0)
    near(s.probability(0), 0.5)
    near(s.probability(1), 0.5)
  })

  it('X on |0> gives |1> with certainty', () => {
    const s = sv(1).applySingle('X', 0)
    near(s.probability(1), 1)
    near(s.probability(0), 0)
  })

  it('Z keeps probabilities but flips the sign of the |1> amplitude', () => {
    const before = sv(1).applySingle('H', 0)
    const after = before.clone().applySingle('Z', 0)
    near(after.probability(0), before.probability(0))
    near(after.probability(1), before.probability(1))
    near(after.amplitude(0).re, before.amplitude(0).re)
    near(after.amplitude(1).re, -before.amplitude(1).re)
  })

  it('S twice equals Z', () => {
    const ss = sv(1).applySingle('H', 0).applySingle('S', 0).applySingle('S', 0)
    const z = sv(1).applySingle('H', 0).applySingle('Z', 0)
    for (let i = 0; i < 2; i++) nearC(ss.amplitude(i), z.amplitude(i))
  })

  it('T twice equals S', () => {
    const tt = sv(1).applySingle('H', 0).applySingle('T', 0).applySingle('T', 0)
    const s = sv(1).applySingle('H', 0).applySingle('S', 0)
    for (let i = 0; i < 2; i++) nearC(tt.amplitude(i), s.amplitude(i))
  })

  it('H twice returns exactly to |0> (interference)', () => {
    const s = sv(1).applySingle('H', 0).applySingle('H', 0)
    expect(s.probability(1)).toBe(0)
    near(s.probability(0), 1)
  })

  it('RY(pi) maps |0> to |1>', () => {
    const s = sv(1).applySingle('RY', 0, Math.PI)
    near(s.probability(1), 1)
    nearC(s.amplitude(1), c(1, 0))
  })

  it('RX(pi) maps |0> to |1> up to a global phase', () => {
    const s = sv(1).applySingle('RX', 0, Math.PI)
    near(s.probability(1), 1)
    near(s.probability(0), 0)
    // amplitude is -i, not 1 — a global phase
    near(cAbs(s.amplitude(1)), 1)
  })

  it('RZ does not change probabilities', () => {
    const before = sv(1).applySingle('H', 0)
    const after = before.clone().applySingle('RZ', 0, 0.77)
    near(after.probability(0), before.probability(0))
    near(after.probability(1), before.probability(1))
  })

  it('P(theta) multiplies the |1> amplitude by e^{i theta}', () => {
    const theta = Math.PI / 3
    const s = sv(1).applySingle('H', 0).applySingle('P', 0, theta)
    nearC(s.amplitude(0), c(R2, 0))
    nearC(s.amplitude(1), cScale(cExp(theta), R2))
  })

  it('SDG and TDG invert S and T', () => {
    const s = sv(1).applySingle('H', 0).applySingle('S', 0).applySingle('SDG', 0)
    const t = sv(1).applySingle('H', 0).applySingle('T', 0).applySingle('TDG', 0)
    const ref = sv(1).applySingle('H', 0)
    for (let i = 0; i < 2; i++) {
      nearC(s.amplitude(i), ref.amplitude(i))
      nearC(t.amplitude(i), ref.amplitude(i))
    }
  })
})

describe('Bloch vectors', () => {
  const len = (v: { x: number; y: number; z: number }) =>
    Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)

  it('|0> points at +Z and |1> at -Z', () => {
    const zero = sv(1).blochVector(0)
    near(zero.x, 0); near(zero.y, 0); near(zero.z, 1)
    const one = sv(1).applySingle('X', 0).blochVector(0)
    near(one.x, 0); near(one.y, 0); near(one.z, -1)
  })

  it('H|0> points at +X', () => {
    const v = sv(1).applySingle('H', 0).blochVector(0)
    near(v.x, 1); near(v.y, 0); near(v.z, 0)
  })

  it('S H|0> points at +Y', () => {
    const v = sv(1).applySingle('H', 0).applySingle('S', 0).blochVector(0)
    near(v.x, 0); near(v.y, 1); near(v.z, 0)
  })

  it('every pure single-qubit state lies on the unit sphere', () => {
    const N = 20
    for (let i = 0; i < N; i++) {
      const theta = (i / (N - 1)) * Math.PI
      for (let j = 0; j < N; j++) {
        const phi = (j / (N - 1)) * 2 * Math.PI
        const s = sv(1).applySingle('RY', 0, theta).applySingle('RZ', 0, phi)
        expect(Math.abs(len(s.blochVector(0)) - 1)).toBeLessThan(1e-9)
      }
    }
  })
})

describe('entanglement', () => {
  it('the Bell state has entropy 1 on both qubits', () => {
    const s = simulate(preset('bell'))
    near(s.entanglementEntropy(0), 1)
    near(s.entanglementEntropy(1), 1)
  })

  it('a product state has entropy 0 on both qubits', () => {
    const s = simulate({ numQubits: 2, ops: [{ name: 'H', qubits: [0] }] })
    near(s.entanglementEntropy(0), 0)
    near(s.entanglementEntropy(1), 0)
  })

  it('GHZ has entropy 1 on all three qubits', () => {
    const s = simulate(preset('ghz'))
    for (let q = 0; q < 3; q++) near(s.entanglementEntropy(q), 1)
  })

  it('entropy increases monotonically with the rotation angle', () => {
    const samples: number[] = []
    const N = 8
    for (let i = 0; i < N; i++) {
      const theta = (i / (N - 1)) * (Math.PI / 2)
      const s = simulate({
        numQubits: 2,
        ops: [{ name: 'RY', qubits: [0], theta }, { name: 'CX', qubits: [0, 1] }],
      })
      samples.push(s.entanglementEntropy(0))
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1])
    }
    near(samples[0], 0)
    near(samples[samples.length - 1], 1)
  })

  it("an entangled qubit's Bloch vector is shorter than 1", () => {
    const s = simulate(preset('bell'))
    const v = s.blochVector(0)
    expect(Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)).toBeLessThan(1 - 1e-9)
  })
})

describe('multi-qubit gates', () => {
  it('CX does nothing when the control is |0>', () => {
    const s = simulate({ numQubits: 2, ops: [{ name: 'CX', qubits: [0, 1] }] })
    near(s.probability(0), 1)
  })

  it('CX flips the target when the control is |1>', () => {
    const s = simulate({
      numQubits: 2,
      ops: [{ name: 'X', qubits: [0] }, { name: 'CX', qubits: [0, 1] }],
    })
    // both qubits are 1 -> index 3, label "11"
    near(s.probability(3), 1)
    expect(s.label(3)).toBe('11')
  })

  it('CZ only adds a phase to |11>', () => {
    const base = simulate({
      numQubits: 2,
      ops: [{ name: 'H', qubits: [0] }, { name: 'H', qubits: [1] }],
    })
    const after = base.clone()
    after.apply({ name: 'CZ', qubits: [0, 1] })
    for (let i = 0; i < 4; i++) {
      near(after.probability(i), 0.25)
      if (i === 3) nearC(after.amplitude(i), cScale(base.amplitude(i), -1))
      else nearC(after.amplitude(i), base.amplitude(i))
    }
  })

  it('SWAP exchanges two qubits', () => {
    const s = simulate({
      numQubits: 2,
      ops: [{ name: 'X', qubits: [0] }, { name: 'SWAP', qubits: [0, 1] }],
    })
    near(s.probability(2), 1)
    near(s.qubitProbability(0), 0)
    near(s.qubitProbability(1), 1)
  })

  it('CCX fires only when both controls are |1>', () => {
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const ops: Circuit['ops'] = []
      if (a) ops.push({ name: 'X', qubits: [0] })
      if (b) ops.push({ name: 'X', qubits: [1] })
      ops.push({ name: 'CCX', qubits: [0, 1, 2] })
      const s = simulate({ numQubits: 3, ops })
      near(s.qubitProbability(2), a && b ? 1 : 0)
    }
  })

  it('respects the qubit-0-is-LSB convention', () => {
    const s = simulate({ numQubits: 2, ops: [{ name: 'X', qubits: [0] }] })
    near(s.probability(1), 1)
    expect(s.label(1)).toBe('01')
    expect(formatKet(1, 2)).toBe('|01⟩')
  })
})

describe('known algorithms', () => {
  it('Bell gives [0.5, 0, 0, 0.5]', () => {
    const p = simulate(preset('bell')).probabilities()
    near(p[0], 0.5); near(p[1], 0); near(p[2], 0); near(p[3], 0.5)
  })

  it('GHZ gives 0.5 at 000 and 111 only', () => {
    const p = simulate(preset('ghz')).probabilities()
    expect(p).toHaveLength(8)
    p.forEach((v, i) => near(v, i === 0 || i === 7 ? 0.5 : 0))
  })

  it("Grover's 2-qubit search finds |11> with certainty", () => {
    const s = simulate(preset('grover2'))
    near(s.probability(3), 1)
    expect(s.label(3)).toBe('11')
  })

  it('teleportation moves the RY(pi/3) state onto qubit 2', () => {
    const s = simulate(preset('teleport'))
    near(s.qubitProbability(2), 0.25)
  })

  it('the interference preset lands on |1> with certainty', () => {
    const s = simulate(preset('interference'))
    near(s.probability(1), 1)
  })

  it('uniform superposition on 3 qubits gives 1/8 everywhere', () => {
    const p = simulate(preset('superposition')).probabilities()
    expect(p).toHaveLength(8)
    p.forEach((v) => near(v, 1 / 8))
  })
})

describe('normalization', () => {
  it('every preset ends normalised', () => {
    for (const p of PRESETS) {
      const total = simulate(p.circuit).probabilities().reduce((a, b) => a + b, 0)
      near(total, 1, 9)
    }
  })

  it('a random 40-gate circuit stays normalised', () => {
    const rng = mulberry32(7)
    const singles: GateName[] = ['H', 'X', 'Y', 'Z', 'S', 'SDG', 'T', 'TDG', 'RX', 'RY', 'RZ', 'P']
    const doubles: GateName[] = ['CX', 'CY', 'CZ', 'SWAP']
    const numQubits = 4
    const ops: Circuit['ops'] = []
    for (let i = 0; i < 40; i++) {
      const twoQubit = rng() < 0.4
      const a = Math.floor(rng() * numQubits)
      if (twoQubit) {
        let b = Math.floor(rng() * numQubits)
        if (b === a) b = (a + 1) % numQubits
        ops.push({ name: doubles[Math.floor(rng() * doubles.length)], qubits: [a, b] })
      } else {
        const name = singles[Math.floor(rng() * singles.length)]
        ops.push({ name, qubits: [a], theta: rng() * 2 * Math.PI })
      }
    }
    expect(ops).toHaveLength(40)
    const total = simulate({ numQubits, ops }).probabilities().reduce((x, y) => x + y, 0)
    near(total, 1, 9)
  })
})

describe('measurement', () => {
  it('measuring |0> always yields 0', () => {
    for (let i = 0; i < 50; i++) {
      expect(sv(2).measureQubit(0)).toBe(0)
    }
  })

  it('measuring one half of a Bell pair collapses the partner', () => {
    for (let i = 0; i < 25; i++) {
      const s = simulate(preset('bell'))
      const outcome = s.measureQubit(0)
      near(s.qubitProbability(1), outcome, 12)
      near(s.qubitProbability(0), outcome, 12)
    }
  })

  it('leaves the state normalised', () => {
    const s = simulate(preset('ghz'))
    s.measureQubit(1, mulberry32(3))
    near(s.probabilities().reduce((a, b) => a + b, 0), 1, 12)
  })

  it('is reproducible with a seeded rng', () => {
    const seq = (seed: number) => {
      const s = simulate(preset('bell'))
      const rng = mulberry32(seed)
      return [s.measureQubit(0, rng), s.measureQubit(1, rng)]
    }
    expect(seq(42)).toEqual(seq(42))
  })
})

describe('shot sampling', () => {
  const bell = preset('bell')

  it('only ever produces 00 and 11', () => {
    const r = run(bell, 4000, 0, 1234)
    expect(Object.keys(r.counts).sort()).toEqual(['00', '11'])
  })

  it('counts sum to the requested shots', () => {
    const r = run(bell, 4000, 0, 1234)
    expect(r.shots).toBe(4000)
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(4000)
  })

  it('is deterministic per seed and varies across seeds', () => {
    const a = run(bell, 4000, 0, 99).counts
    const b = run(bell, 4000, 0, 99).counts
    const d = run(bell, 4000, 0, 12345).counts
    expect(a).toEqual(b)
    expect(d).not.toEqual(a)
  })

  it('noise produces 01 and 10 outcomes', () => {
    const r = run(bell, 4000, 0.5, 7)
    expect(r.counts['01']).toBeGreaterThan(0)
    expect(r.counts['10']).toBeGreaterThan(0)
  })

  it('reports the statevector probabilities', () => {
    const r = run(bell, 256, 0, 5)
    const p = simulate(bell).probabilities()
    expect(r.probabilities).toHaveLength(p.length)
    r.probabilities.forEach((v, i) => near(v, p[i]))
    expect(r.labels).toEqual(['00', '01', '10', '11'])
    expect(r.statevector).toHaveLength(4)
  })
})

describe('OpenQASM round-trip', () => {
  it('emits an OpenQASM 3 header', () => {
    const q = toQasm(preset('bell'))
    expect(q).toContain('OPENQASM 3.0;')
    expect(q).toContain('include "stdgates.inc";')
    expect(q).toContain('h q[0];')
    expect(q).toContain('cx q[0], q[1];')
  })

  it('preserves the op count for every preset', () => {
    for (const p of PRESETS) {
      expect(fromQasm(toQasm(p.circuit)).ops).toHaveLength(p.circuit.ops.length)
    }
  })

  it('preserves the physics for every preset', () => {
    for (const p of PRESETS) {
      // toQasm emits angles as exact pi fractions (or a round-trip-safe decimal),
      // so export -> import must be BIT-exact, including for rotation circuits.
      const before = simulate(p.circuit).probabilities()
      const after = simulate(fromQasm(toQasm(p.circuit))).probabilities()
      expect(after).toHaveLength(before.length)
      before.forEach((v, i) => expect(after[i]).toBe(v))
    }
  })

  it('parses pi expressions and decimals', () => {
    const a = fromQasm('qubit[1] q;\nrx(pi/2) q[0];')
    expect(a.ops).toHaveLength(1)
    near(a.ops[0].theta as number, Math.PI / 2)

    const b = fromQasm('qubit[1] q;\nrz(1.234567) q[0];')
    near(b.ops[0].theta as number, 1.234567)

    const c2 = fromQasm('qubit[1] q;\nry(pi) q[0];')
    near(c2.ops[0].theta as number, Math.PI)
  })

  it('ignores comments, blank lines and measurements; keeps a barrier as a BARRIER op', () => {
    const src = [
      '// a leading comment',
      'OPENQASM 3.0;',
      'include "stdgates.inc";',
      '',
      'qubit[2] q;',
      'bit[2] c;',
      '',
      'h q[0]; // make a superposition',
      'barrier q;',
      'cx q[0], q[1];',
      '',
      'c = measure q;',
    ].join('\n')
    const circuit = fromQasm(src)
    expect(circuit.numQubits).toBe(2)
    // Wave 2: barriers round-trip (they are a palette gate now), so the op
    // list keeps it; the statevector is unaffected because apply() skips it.
    expect(circuit.ops.map((o) => o.name)).toEqual(['H', 'BARRIER', 'CX'])
    expect(simulate(circuit).probabilities()).toEqual(simulate(preset('bell')).probabilities())
  })

  it('returns an empty circuit for garbage instead of throwing', () => {
    const circuit = fromQasm('!!! total nonsense ???\nnothing to see {}\n12345\n')
    expect(circuit.ops).toHaveLength(0)
    expect(circuit.numQubits).toBeGreaterThanOrEqual(1)
  })
})

describe('simulateSteps', () => {
  const circuit = preset('ghz')

  it('returns ops.length + 1 frames', () => {
    expect(simulateSteps(circuit)).toHaveLength(circuit.ops.length + 1)
  })

  it('starts from |000>', () => {
    const first = simulateSteps(circuit)[0]
    expect(first.probability(0)).toBe(1)
    for (let i = 1; i < first.dim; i++) expect(first.probability(i)).toBe(0)
  })

  it('ends at the simulated state', () => {
    const frames = simulateSteps(circuit)
    const last = frames[frames.length - 1]
    const final = simulate(circuit)
    for (let i = 0; i < final.dim; i++) nearC(last.amplitude(i), final.amplitude(i))
  })

  it('handles the empty circuit', () => {
    expect(simulateSteps(emptyCircuit(2))).toHaveLength(1)
  })
})

describe('guards', () => {
  it('rejects zero qubits', () => {
    expect(() => new StateVector(0)).toThrow()
  })

  it('rejects more than 16 qubits', () => {
    expect(() => new StateVector(17)).toThrow()
  })

  it('rejects amplitude counts that are not a power of two', () => {
    expect(() => StateVector.fromAmplitudes([c(1), c(0), c(0)])).toThrow()
  })
})

describe('formatting', () => {
  it('formats kets MSB-first', () => {
    expect(formatKet(3, 2)).toBe('|11⟩')
    expect(formatKet(1, 3)).toBe('|001⟩')
  })

  it('omits the imaginary part of a real number', () => {
    expect(formatComplex(c(0.5, 0))).toBe('0.500')
    expect(formatComplex(c(-1, 0))).toBe('-1.000')
  })

  it('omits the real part of a pure imaginary number', () => {
    expect(formatComplex(c(0, 0.5))).toBe('0.500i')
  })

  it('renders a negative imaginary part with a minus sign', () => {
    expect(formatComplex(c(1, -2))).toBe('1.000-2.000i')
    expect(formatComplex(c(0, -0.25))).toBe('-0.250i')
  })
})

// ────────────────────────────────────────────────────────────
// Wave 3 — RESET, POSTSELECT, U3, generic extraControls, initialStates
// ────────────────────────────────────────────────────────────

/** 2×2 matrix from a flat [m00,m01,m10,m11] tuple, for processFidelity. */
const toMat2 = ([a, b, cc, d]: readonly [Complex, Complex, Complex, Complex]): Complex[][] => [
  [a, b],
  [cc, d],
]

describe('RESET', () => {
  it('apply() throws and directs callers to execute()', () => {
    const s = sv(1)
    expect(() => s.apply({ name: 'RESET', qubits: [0] })).toThrow(/execute/)
  })

  it('circuitUnitary() and simulate() route a RESET-containing circuit through branching, not an unrelated throw', () => {
    const circuit: Circuit = { numQubits: 1, ops: [{ name: 'X', qubits: [0] }, { name: 'RESET', qubits: [0] }] }
    // The standard "no unitary" message, not the RESET-internal apply() error.
    expect(() => circuitUnitary(circuit)).toThrow(/classical control|no unitary/i)
    expect(hasClassicalControl(circuit)).toBe(true)
    let result: StateVector | undefined
    expect(() => { result = simulate(circuit) }).not.toThrow()
    near(result!.probability(0), 1) // RESET always leaves the qubit at |0>
  })

  it('(a) RESET on a qubit starting in |1> always yields the qubit reading 0, with certainty, across every branch', () => {
    const circuit: Circuit = { numQubits: 1, ops: [{ name: 'X', qubits: [0] }, { name: 'RESET', qubits: [0] }] }
    const branches = outcomeBranches(circuit)
    let totalP0 = 0
    for (const b of branches) totalP0 += b.probability * b.state.probability(0)
    near(totalP0, 1)
    for (const b of branches) near(b.state.probability(0), 1) // deterministic per branch too
  })

  it('(b) RESET on an equal superposition (after H) still always yields qubit 0 after the reset, across ALL branches', () => {
    const circuit: Circuit = { numQubits: 1, ops: [{ name: 'H', qubits: [0] }, { name: 'RESET', qubits: [0] }] }
    const branches = outcomeBranches(circuit)
    let totalWeight = 0
    for (const b of branches) {
      near(b.state.probability(0), 1)
      totalWeight += b.probability
    }
    near(totalWeight, 1)
  })

  it('(c) RESET on one qubit of a Bell pair leaves the OTHER qubit deterministic, matching the measurement outcome in each branch', () => {
    // (|00> + |11>) / sqrt(2); qubit 0 is reset, qubit 1 is the survivor.
    const circuit: Circuit = {
      numQubits: 2,
      ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }, { name: 'RESET', qubits: [0] }],
    }
    const branches = outcomeBranches(circuit)
    expect(branches).toHaveLength(2)
    let totalWeight = 0
    const q1Values = branches.map((b) => {
      // qubit 0 (the reset qubit) must read 0 with certainty:
      near(b.state.qubitProbability(0), 0)
      totalWeight += b.probability
      near(b.probability, 0.5)
      // qubit 1 must be a DEFINITE computational-basis value (0 or 1), never a
      // superposition — reset-and-trace-out of an entangled qubit leaves the
      // partner in a mixed-but-per-branch-pure basis state.
      const p1 = b.state.qubitProbability(1)
      expect(p1 === 0 || Math.abs(p1 - 1) < 1e-12).toBe(true)
      return p1 > 0.5 ? 1 : 0
    })
    near(totalWeight, 1)
    // The two branches disagree on qubit 1 — one says 0, the other says 1 —
    // which is exactly "qubit 1 matches whatever qubit 0 read before the reset".
    expect(new Set(q1Values).size).toBe(2)
  })

  it('QASM: reset q[i]; round-trips', () => {
    const circuit: Circuit = { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'RESET', qubits: [1] }] }
    const qasm = toQasm(circuit)
    expect(qasm).toContain('reset q[1];')
    const back = fromQasm(qasm)
    expect(back.ops.some((op) => op.name === 'RESET' && op.qubits[0] === 1)).toBe(true)
  })
})

describe('POSTSELECT', () => {
  it('apply() throws and directs callers to execute()', () => {
    const s = sv(1)
    expect(() => s.apply({ name: 'POSTSELECT', qubits: [0], postselectValue: 0 })).toThrow(/execute/)
  })

  it('(a) postselecting a Bell pair’s first qubit to 1 leaves the second qubit deterministically |1>', () => {
    const circuit: Circuit = {
      numQubits: 2,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'POSTSELECT', qubits: [0], postselectValue: 1 },
      ],
    }
    const branches = outcomeBranches(circuit)
    expect(branches).toHaveLength(1)
    near(branches[0].probability, 1)
    near(branches[0].state.probability(3), 1) // |11>, qubit1(MSB)=1 and qubit0=1
    near(cAbs(branches[0].state.amplitude(3)), 1)
  })

  it('(b) postselecting an impossible outcome throws a clear error from execute() AND from outcomeBranches() (not empty/NaN)', () => {
    const circuit: Circuit = {
      numQubits: 1,
      ops: [{ name: 'X', qubits: [0] }, { name: 'POSTSELECT', qubits: [0], postselectValue: 0 }],
    }
    expect(() => execute(circuit)).toThrow(/probability/i)
    expect(() => outcomeBranches(circuit)).toThrow(/impossible/i)
  })

  it('(c) two sequential postselections renormalize correctly and match the hand-computed conditional probability', () => {
    // Bell pair on q0/q1 (perfectly correlated), an INDEPENDENT superposition
    // on q2, then q2 is measured (branching), and both branches are
    // postselected on q0=1 and q1=1 (redundant given the Bell correlation,
    // but exercises two POSTSELECT ops in sequence).
    const circuit: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'H', qubits: [2] },
        { name: 'MEASURE', qubits: [2], clbit: 0 },
        { name: 'POSTSELECT', qubits: [0], postselectValue: 1 },
        { name: 'POSTSELECT', qubits: [1], postselectValue: 1 },
      ],
    }
    const branches = outcomeBranches(circuit)
    expect(branches).toHaveLength(2)
    const totalP = branches.reduce((s, b) => s + b.probability, 0)
    near(totalP, 1) // renormalized to a proper distribution
    // Hand computation: P(q0=1) = 1/2, q1 is forced equal to q0 by the Bell
    // pair (so P(q1=1 | q0=1) = 1), and q2 is INDEPENDENT with P(q2=0) =
    // P(q2=1) = 1/2. So conditioned on q0=1 AND q1=1 (probability 1/2 · 1 =
    // 1/2 unconditionally), q2 is still exactly 50/50 — each branch should
    // land at conditional probability 1/2.
    for (const b of branches) {
      near(b.probability, 0.5)
      near(b.state.qubitProbability(0), 1)
      near(b.state.qubitProbability(1), 1)
    }
    // The two branches disagree on qubit 2 — that is the surviving randomness.
    const q2Values = branches.map((b) => (b.state.qubitProbability(2) > 0.5 ? 1 : 0))
    expect(new Set(q2Values)).toEqual(new Set([0, 1]))
  })

  it('QASM: the postselect comment round-trips through our own export/import', () => {
    const circuit: Circuit = { numQubits: 1, ops: [{ name: 'POSTSELECT', qubits: [0], postselectValue: 1 }] }
    const qasm = toQasm(circuit)
    expect(qasm).toContain('// qubit16:postselect q[0]==1')
    const back = fromQasm(qasm)
    expect(back.ops).toContainEqual({ name: 'POSTSELECT', qubits: [0], postselectValue: 1 })
  })
})

describe('U3 — the universal single-qubit gate', () => {
  it('U3(pi, 0, pi) equals X up to global phase', () => {
    const f = processFidelity(toMat2(gateMatrix('X')), toMat2(u3Matrix(Math.PI, 0, Math.PI) as [Complex, Complex, Complex, Complex]))
    expect(f).toBeGreaterThan(1 - 1e-9)
  })

  it('U3(pi/2, 0, pi) equals H up to global phase', () => {
    const f = processFidelity(toMat2(gateMatrix('H')), toMat2(u3Matrix(Math.PI / 2, 0, Math.PI) as [Complex, Complex, Complex, Complex]))
    expect(f).toBeGreaterThan(1 - 1e-9)
  })

  it('U3(0, 0, lambda) equals P(lambda) up to global phase', () => {
    const lambda = 0.73
    const f = processFidelity(toMat2(gateMatrix('P', lambda)), toMat2(u3Matrix(0, 0, lambda) as [Complex, Complex, Complex, Complex]))
    expect(f).toBeGreaterThan(1 - 1e-9)
  })

  it('U3(theta, -pi/2, pi/2) equals RX(theta) up to global phase — a well-known identity, checked numerically', () => {
    for (const theta of [0.3, 1.1, 2.7, -0.9]) {
      const f = processFidelity(
        toMat2(gateMatrix('RX', theta)),
        toMat2(u3Matrix(theta, -Math.PI / 2, Math.PI / 2) as [Complex, Complex, Complex, Complex])
      )
      expect(f).toBeGreaterThan(1 - 1e-9)
    }
  })

  it('apply() dispatches U3 through u3Matrix, matching applySingleMatrix directly', () => {
    const theta = 0.4, phi = 1.1, lambda = -0.6
    const viaOp = sv(1).apply({ name: 'U3', qubits: [0], theta, phi, lambda })
    const viaMatrix = sv(1).applySingleMatrix(
      u3Matrix(theta, phi, lambda) as [Complex, Complex, Complex, Complex],
      0
    )
    for (let i = 0; i < 2; i++) nearC(viaOp.amplitude(i), viaMatrix.amplitude(i))
  })

  it('QASM: U3 exports as U(...) and imports both U( and u3( spellings', () => {
    const circuit: Circuit = { numQubits: 1, ops: [{ name: 'U3', qubits: [0], theta: Math.PI / 2, phi: 0, lambda: Math.PI }] }
    const qasm = toQasm(circuit)
    expect(qasm).toMatch(/U\(pi\/2, 0, pi\) q\[0\];/)
    const back = fromQasm(qasm)
    expect(back.ops).toHaveLength(1)
    expect(back.ops[0].name).toBe('U3')
    near(back.ops[0].theta as number, Math.PI / 2)
    near(back.ops[0].phi as number, 0)
    near(back.ops[0].lambda as number, Math.PI)

    const legacy = fromQasm('OPENQASM 2.0;\nqreg q[1];\nu3(pi/2, 0, pi) q[0];')
    expect(legacy.ops).toHaveLength(1)
    expect(legacy.ops[0].name).toBe('U3')
    near(legacy.ops[0].theta as number, Math.PI / 2)
  })
})

describe('generic extraControls — any single-qubit gate, any control basis, positive or anti', () => {
  const P1: Complex[][] = [[c(0), c(0)], [c(0), c(1)]] // |1><1|
  const P0: Complex[][] = [[c(1), c(0)], [c(0), c(0)]] // |0><0|
  const Pplus: Complex[][] = [[c(0.5), c(0.5)], [c(0.5), c(0.5)]] // |+><+|
  const Pminus: Complex[][] = [[c(0.5), c(-0.5)], [c(-0.5), c(0.5)]] // |-><-|
  const PplusI: Complex[][] = [[c(0.5), c(0, -0.5)], [c(0, 0.5), c(0.5)]] // |+i><+i|
  const PminusI: Complex[][] = [[c(0.5), c(0, 0.5)], [c(0, -0.5), c(0.5)]] // |-i><-i|
  const I2: Complex[][] = [[c(1), c(0)], [c(0), c(1)]]

  /** msbMat ⊗ lsbMat with this module's LSB-first qubit convention (row/col index = msb*dLsb + lsb). */
  function kronLSB(msb: Complex[][], lsb: Complex[][]): Complex[][] {
    const d1 = msb.length, d0 = lsb.length
    const d = d1 * d0
    const out: Complex[][] = Array.from({ length: d }, () => Array.from({ length: d }, () => c(0)))
    for (let a1 = 0; a1 < d1; a1++) for (let a0 = 0; a0 < d0; a0++)
      for (let b1 = 0; b1 < d1; b1++) for (let b0 = 0; b0 < d0; b0++) {
        out[a1 * d0 + a0][b1 * d0 + b0] = cAdd(out[a1 * d0 + a0][b1 * d0 + b0], cMul(msb[a1][b1], lsb[a0][b0]))
      }
    return out
  }

  const matSub = (a: Complex[][], b: Complex[][]): Complex[][] =>
    a.map((row, i) => row.map((z, j) => cSub(z, b[i][j])))
  const matAdd = (a: Complex[][], b: Complex[][]): Complex[][] =>
    a.map((row, i) => row.map((z, j) => cAdd(z, b[i][j])))

  const expectMatClose = (actual: Complex[][], expected: Complex[][], eps = 1e-9) => {
    for (let i = 0; i < expected.length; i++) {
      for (let j = 0; j < expected.length; j++) {
        near(actual[i][j].re, expected[i][j].re, 9)
        near(actual[i][j].im, expected[i][j].im, 9)
      }
    }
    void eps
  }

  /** control = qubit 0 (LSB), target = qubit 1 (MSB) — one extraControls entry. */
  function engineMatrix1(targetGate: GateOp, control: { basis?: 'X' | 'Y' | 'Z'; anti?: boolean }): Complex[][] {
    const op: GateOp = { ...targetGate, qubits: [1], extraControls: [{ qubit: 0, ...control }] }
    return circuitUnitary({ numQubits: 2, ops: [op] })
  }

  it('sanity check: a plain Z-basis extraControls X reproduces the engine’s own, already-tested CX — validates the kron ordering before trusting the harder cases', () => {
    const viaExtraControls = engineMatrix1({ name: 'X', qubits: [1] }, {})
    const viaCX = circuitUnitary({ numQubits: 2, ops: [{ name: 'CX', qubits: [0, 1] }] })
    expectMatClose(viaExtraControls, viaCX)
    // And against the direct projector formula, independently.
    const reference = matAdd(kronLSB([[c(0), c(1)], [c(1), c(0)]], P1), kronLSB(I2, P0))
    expectMatClose(viaCX, reference)
  })

  it('X-basis positive control + X target', () => {
    const X: Complex[][] = [[c(0), c(1)], [c(1), c(0)]]
    const actual = engineMatrix1({ name: 'X', qubits: [1] }, { basis: 'X' })
    const reference = matAdd(kronLSB(X, Pplus), kronLSB(I2, matSub(I2, Pplus)))
    expectMatClose(actual, reference)
  })

  it('X-basis anti control + X target', () => {
    const X: Complex[][] = [[c(0), c(1)], [c(1), c(0)]]
    const actual = engineMatrix1({ name: 'X', qubits: [1] }, { basis: 'X', anti: true })
    const reference = matAdd(kronLSB(X, Pminus), kronLSB(I2, matSub(I2, Pminus)))
    expectMatClose(actual, reference)
  })

  it('Y-basis positive control + Z target', () => {
    const Z: Complex[][] = [[c(1), c(0)], [c(0), c(-1)]]
    const actual = engineMatrix1({ name: 'Z', qubits: [1] }, { basis: 'Y' })
    const reference = matAdd(kronLSB(Z, PplusI), kronLSB(I2, matSub(I2, PplusI)))
    expectMatClose(actual, reference)
  })

  it('Y-basis anti control + H target', () => {
    const H: Complex[][] = [[c(Math.SQRT1_2), c(Math.SQRT1_2)], [c(Math.SQRT1_2), c(-Math.SQRT1_2)]]
    const actual = engineMatrix1({ name: 'H', qubits: [1] }, { basis: 'Y', anti: true })
    const reference = matAdd(kronLSB(H, PminusI), kronLSB(I2, matSub(I2, PminusI)))
    expectMatClose(actual, reference)
  })

  it('TWO extraControls of different bases (one Z, one X) on the same op', () => {
    // qubit 0 = control 0 (Z, positive), qubit 1 = control 1 (X, positive), qubit 2 = target.
    const X: Complex[][] = [[c(0), c(1)], [c(1), c(0)]]
    const op: GateOp = {
      name: 'X',
      qubits: [2],
      extraControls: [{ qubit: 0 }, { qubit: 1, basis: 'X' }],
    }
    const actual = circuitUnitary({ numQubits: 3, ops: [op] })
    // R = P_c1(MSB of the control pair) ⊗ P_c0(LSB of the control pair) — the
    // combined "both controls fire" projector on the 2-qubit control space.
    const R = kronLSB(Pplus, P1)
    const I4: Complex[][] = kronLSB(I2, I2)
    const reference = matAdd(kronLSB(X, R), kronLSB(I2, matSub(I4, R)))
    expectMatClose(actual, reference)
  })

  it('rejects extraControls on an already-controlled gate (CX), a register block, and a 2-qubit UNITARY', () => {
    const ecx: GateOp = { name: 'CX', qubits: [0, 1], extraControls: [{ qubit: 2 }] }
    expect(() => sv(3).apply(ecx)).toThrow(/extraControls/)
    const eaddk: GateOp = { name: 'ADDK', qubits: [0, 1], k: 1, modulus: 3, extraControls: [{ qubit: 2 }] }
    expect(() => sv(3).apply(eaddk)).toThrow(/extraControls/)
    const iMat: Complex[] = [c(1), c(0), c(0), c(0), c(0), c(1), c(0), c(0), c(0), c(0), c(1), c(0), c(0), c(0), c(0), c(1)]
    const eunitary: GateOp = { name: 'UNITARY', qubits: [0, 1], matrix: iMat, extraControls: [{ qubit: 2 }] }
    expect(() => sv(3).apply(eunitary)).toThrow(/extraControls/)
  })

  it('QASM: an all-Z-basis extraControls op round-trips exactly through our own export/import', () => {
    const op: GateOp = { name: 'H', qubits: [1], extraControls: [{ qubit: 0 }] }
    const circuit: Circuit = { numQubits: 2, ops: [op] }
    const qasm = toQasm(circuit)
    expect(qasm).toContain('ctrl @ h q[0], q[1];')
    const back = fromQasm(qasm)
    expect(back.ops).toHaveLength(1)
    expect(back.ops[0]).toMatchObject({ name: 'H', qubits: [1], extraControls: [{ qubit: 0, anti: false }] })
  })
})

describe('initialStates — sparse per-qubit starting state', () => {
  const cases: { state: NonNullable<Circuit['initialStates']>[number]; bloch: [number, number, number]; p1: number }[] = [
    { state: '0', bloch: [0, 0, 1], p1: 0 },
    { state: '1', bloch: [0, 0, -1], p1: 1 },
    { state: '+', bloch: [1, 0, 0], p1: 0.5 },
    { state: '-', bloch: [-1, 0, 0], p1: 0.5 },
    { state: 'i', bloch: [0, 1, 0], p1: 0.5 },
    { state: '-i', bloch: [0, -1, 0], p1: 0.5 },
  ]

  for (const { state, bloch, p1 } of cases) {
    it(`'${state}' matches the textbook Bloch-sphere point and P(1)`, () => {
      const circuit: Circuit = { numQubits: 1, ops: [], initialStates: { 0: state } }
      const result = simulate(circuit)
      const { x, y, z } = result.blochVector(0)
      near(x, bloch[0]); near(y, bloch[1]); near(z, bloch[2])
      near(result.qubitProbability(0), p1)
    })
  }

  it('is backward compatible: a preset with no initialStates field is unaffected, byte for byte', () => {
    const circuit = preset('bell')
    expect(circuit.initialStates).toBeUndefined()
    const withField: Circuit = { ...circuit } // no initialStates key at all
    const a = simulate(circuit).amplitudes()
    const b = simulate(withField).amplitudes()
    for (let i = 0; i < a.length; i++) {
      expect(a[i].re).toBe(b[i].re)
      expect(a[i].im).toBe(b[i].im)
    }
    // And matches the hand-known Bell amplitudes exactly.
    near(a[0].re, Math.SQRT1_2); near(a[3].re, Math.SQRT1_2)
    near(a[1].re, 0); near(a[2].re, 0)
  })

  it('applies before the ops loop, in execute() and outcomeBranches() too', () => {
    const circuit: Circuit = {
      numQubits: 1,
      initialStates: { 0: '1' },
      ops: [{ name: 'MEASURE', qubits: [0], clbit: 0 }],
    }
    const result = execute(circuit, { rng: () => 0.999 })
    expect(result.clbits[0]).toBe(1) // started at |1>, so the only possible outcome
    const branches = outcomeBranches(circuit)
    expect(branches).toHaveLength(1)
    expect(branches[0].clbits[0]).toBe(1)
  })
})
