/**
 * quantum.classical.test.ts — the classical-control execution path.
 *
 * This is engine code that other visualizations will build on, so the tests
 * below check the mechanism itself rather than any one protocol: does a
 * measurement actually write the bit, does a conditioned gate actually run only
 * when it should, does branch enumeration agree with sampling, and does every
 * way of getting this wrong throw instead of returning something plausible.
 *
 * Where a number is asserted it comes from somewhere other than this engine —
 * a hand-computed amplitude, a Born-rule probability worked out on paper, or
 * the frequency of an independently seeded Monte Carlo run.
 */

import { describe, it, expect } from 'vitest'
import {
  StateVector,
  classicalBitCount,
  clbitDistribution,
  execute,
  hasClassicalControl,
  highestClassicalBit,
  mulberry32,
  outcomeBranches,
  outcomeProbabilities,
  recordedMeasurementCount,
  run,
  simulate,
  simulateSteps,
  fromQasm,
  toQasm,
  type Circuit,
} from './quantum'

const near = (a: number, b: number, eps = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(eps)

/** |0⟩ → X → measure into c0. The outcome can only be 1. */
const forcedOne: Circuit = {
  numQubits: 1,
  ops: [
    { name: 'X', qubits: [0] },
    { name: 'MEASURE', qubits: [0], clbit: 0 },
  ],
}

/** A Bell pair with both halves measured into c0 and c1. */
const bellMeasured: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
    { name: 'MEASURE', qubits: [0], clbit: 0 },
    { name: 'MEASURE', qubits: [1], clbit: 1 },
  ],
}

describe('register sizing', () => {
  it('defaults to one classical bit per qubit', () => {
    expect(classicalBitCount({ numQubits: 3, ops: [] })).toBe(3)
    expect(highestClassicalBit({ numQubits: 3, ops: [] })).toBe(-1)
  })

  it('widens to cover any bit an op names, so an index is never out of range', () => {
    const c: Circuit = {
      numQubits: 1,
      ops: [
        { name: 'MEASURE', qubits: [0], clbit: 4 },
        { name: 'X', qubits: [0], condition: { bit: 6, value: 1 } },
      ],
    }
    expect(highestClassicalBit(c)).toBe(6)
    expect(classicalBitCount(c)).toBe(7)
    // The point of the widening: this must not throw.
    expect(() => execute(c)).not.toThrow()
  })

  it('recognises classical control only when a bit is actually used', () => {
    expect(hasClassicalControl({ numQubits: 1, ops: [{ name: 'H', qubits: [0] }] })).toBe(false)
    // A bare MEASURE is the old destructive-measurement op and stays that way.
    expect(hasClassicalControl({ numQubits: 1, ops: [{ name: 'MEASURE', qubits: [0] }] })).toBe(false)
    expect(hasClassicalControl(forcedOne)).toBe(true)
    expect(
      hasClassicalControl({ numQubits: 1, ops: [{ name: 'X', qubits: [0], condition: { bit: 0, value: 1 } }] })
    ).toBe(true)
    expect(recordedMeasurementCount(bellMeasured)).toBe(2)
    expect(recordedMeasurementCount({ numQubits: 1, ops: [{ name: 'MEASURE', qubits: [0] }] })).toBe(0)
  })
})

describe('execute — measurement records a bit', () => {
  it('writes the outcome and collapses the qubit', () => {
    const r = execute(forcedOne)
    expect(r.clbits[0]).toBe(1)
    expect(r.measurements).toEqual([{ op: 1, qubit: 0, clbit: 0, outcome: 1, p1: 1 }])
    near(r.state.probability(1), 1)
  })

  it('leaves bits that were never written reading zero', () => {
    const r = execute({ numQubits: 3, ops: [{ name: 'MEASURE', qubits: [0], clbit: 0 }] })
    expect(r.clbits).toEqual([0, 0, 0])
  })

  it('collapses a Bell pair consistently: both bits always agree', () => {
    const rng = mulberry32(11)
    for (let trial = 0; trial < 200; trial++) {
      const r = execute(bellMeasured, { rng })
      expect(r.clbits[0]).toBe(r.clbits[1])
      // ...and the state matches the bits it recorded.
      const index = r.clbits[0] === 1 ? 0b11 : 0b00
      near(r.state.probability(index), 1)
    }
  })

  it('records the pre-collapse probability, not the post-collapse one', () => {
    // Second measurement of the same qubit: p1 is 0 or 1, never 1/2 again.
    const c: Circuit = {
      numQubits: 1,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'MEASURE', qubits: [0], clbit: 1 },
      ],
    }
    const r = execute(c, { rng: mulberry32(3) })
    near(r.measurements[0].p1, 0.5)
    expect(r.measurements[1].p1).toBe(r.clbits[0] === 1 ? 1 : 0)
    expect(r.clbits[0]).toBe(r.clbits[1])
  })

  it('a bare MEASURE (no clbit) still does not collapse anything', () => {
    const r = execute({
      numQubits: 1,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'MEASURE', qubits: [0] },
      ],
    })
    near(r.state.probability(0), 0.5)
    expect(r.measurements).toHaveLength(0)
  })
})

describe('execute — conditional gates', () => {
  const conditionalX = (value: 0 | 1): Circuit => ({
    numQubits: 2,
    ops: [
      { name: 'X', qubits: [0] },
      { name: 'MEASURE', qubits: [0], clbit: 0 },
      { name: 'X', qubits: [1], condition: { bit: 0, value } },
    ],
  })

  it('runs the gate when the bit matches and skips it when it does not', () => {
    // c0 is certainly 1 here, so "if c0 == 1" fires and "if c0 == 0" does not.
    const fired = execute(conditionalX(1))
    expect(fired.skipped).toEqual([])
    near(fired.state.probability(0b11), 1)

    const skipped = execute(conditionalX(0))
    expect(skipped.skipped).toEqual([2])
    near(skipped.state.probability(0b01), 1)
  })

  it('reads a bit written earlier in the same run, not a stale one', () => {
    // q0 is flipped, measured (c0 = 1), flipped back and measured again
    // (c0 = 0). The conditional at the end must see 0.
    const c: Circuit = {
      numQubits: 2,
      ops: [
        { name: 'X', qubits: [0] },
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'X', qubits: [0] },
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'X', qubits: [1], condition: { bit: 0, value: 1 } },
      ],
    }
    const r = execute(c)
    expect(r.clbits[0]).toBe(0)
    expect(r.skipped).toEqual([4])
    near(r.state.probability(0b00), 1)
  })

  it('conditions rotation gates with their angle intact', () => {
    const c: Circuit = {
      numQubits: 2,
      ops: [
        { name: 'X', qubits: [0] },
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'RY', qubits: [1], theta: Math.PI, condition: { bit: 0, value: 1 } },
      ],
    }
    // RY(π)|0⟩ = |1⟩ exactly, so all the weight lands on q1 = 1.
    near(execute(c).state.probability(0b11), 1, 1e-12)
  })

  it('produces a frame for a skipped op so frame indices stay aligned', () => {
    const c = conditionalX(0)
    const r = execute(c, { collectFrames: true })
    expect(r.frames).toHaveLength(c.ops.length + 1)
    // The skipped op changed nothing, so its frame equals the one before it.
    expect(Array.from(r.frames![3].data)).toEqual(Array.from(r.frames![2].data))
  })

  it('refuses to apply a conditioned op through the plain statevector path', () => {
    const sv = new StateVector(1)
    expect(() => sv.apply({ name: 'X', qubits: [0], condition: { bit: 0, value: 1 } })).toThrow(
      /use execute\(\)/
    )
  })

  it('rejects a condition value that is not a bit', () => {
    const c: Circuit = {
      numQubits: 1,
      ops: [{ name: 'X', qubits: [0], condition: { bit: 0, value: 2 as unknown as 0 } }],
    }
    expect(() => execute(c)).toThrow(/condition value/)
  })
})

describe('forced outcomes', () => {
  it('pins the branch and reports it', () => {
    for (const outcome of [0, 1] as const) {
      const r = execute(bellMeasured, { forceOutcomes: { 0: outcome, 1: outcome } })
      expect(r.clbits).toEqual([outcome, outcome])
      near(r.state.probability(outcome === 1 ? 0b11 : 0b00), 1)
    }
  })

  it('throws rather than postselect on something impossible', () => {
    // The Bell pair can never give c0 = 0 with c1 = 1.
    expect(() => execute(bellMeasured, { forceOutcomes: { 0: 0, 1: 1 } })).toThrow(
      /probability/
    )
    expect(() => execute(forcedOne, { forceOutcomes: { 0: 0 } })).toThrow(/probability/)
  })

  it('collapseQubit refuses an impossible projection instead of zeroing the state', () => {
    const sv = new StateVector(1)
    sv.applySingle('X', 0)
    expect(() => sv.collapseQubit(0, 0)).toThrow(/probability/)
    // The state is untouched by the failed attempt.
    near(sv.probability(1), 1)
  })
})

describe('outcomeBranches — the exact answer', () => {
  it('splits a Bell measurement into two half-weight branches', () => {
    const branches = outcomeBranches(bellMeasured)
    expect(branches).toHaveLength(2)
    // Outcome 0 is explored first, so the order is stable.
    expect(branches.map((b) => b.clbits)).toEqual([[0, 0], [1, 1]])
    branches.forEach((b) => near(b.probability, 0.5))
    near(branches[0].state.probability(0b00), 1)
    near(branches[1].state.probability(0b11), 1)
  })

  it('prunes branches of probability zero instead of carrying them', () => {
    // A deterministic measurement has exactly one branch, not two.
    expect(outcomeBranches(forcedOne)).toHaveLength(1)
  })

  it('probabilities sum to one across a range of circuits', () => {
    const rng = mulberry32(7)
    for (let trial = 0; trial < 40; trial++) {
      const ops: Circuit['ops'] = []
      for (let i = 0; i < 6; i++) {
        const q = Math.floor(rng() * 3)
        ops.push({ name: 'RY', qubits: [q], theta: rng() * Math.PI * 2 })
        if (rng() < 0.4) ops.push({ name: 'CX', qubits: [q, (q + 1) % 3] })
      }
      ops.push({ name: 'MEASURE', qubits: [0], clbit: 0 })
      ops.push({ name: 'X', qubits: [2], condition: { bit: 0, value: 1 } })
      ops.push({ name: 'MEASURE', qubits: [1], clbit: 1 })
      const total = outcomeBranches({ numQubits: 3, ops }).reduce((a, b) => a + b.probability, 0)
      near(total, 1, 1e-10)
      // ...and so does the marginal over basis states.
      near(outcomeProbabilities({ numQubits: 3, ops }).reduce((a, b) => a + b, 0), 1, 1e-10)
    }
  })

  it('agrees with sampled execution to within Monte Carlo error', () => {
    // Independent check: enumeration says one thing, 20 000 seeded trajectories
    // say another, and the two must line up. Deliberately an asymmetric circuit
    // so a symmetric bug would not hide.
    const c: Circuit = {
      numQubits: 2,
      ops: [
        { name: 'RY', qubits: [0], theta: 2 * Math.acos(Math.sqrt(0.7)) }, // P(1) = 0.3
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'X', qubits: [1], condition: { bit: 0, value: 1 } },
        { name: 'H', qubits: [1] },
        { name: 'MEASURE', qubits: [1], clbit: 1 },
      ],
    }
    const exact = clbitDistribution(outcomeBranches(c))
    near(exact['00'], 0.35, 1e-12)
    near(exact['10'], 0.35, 1e-12)
    near(exact['01'], 0.15, 1e-12)
    near(exact['11'], 0.15, 1e-12)

    const rng = mulberry32(20240)
    const shots = 20000
    const seen: Record<string, number> = { '00': 0, '01': 0, '10': 0, '11': 0 }
    for (let s = 0; s < shots; s++) {
      const { clbits } = execute(c, { rng })
      seen[`${clbits[1]}${clbits[0]}`] += 1
    }
    for (const key of Object.keys(seen)) {
      // 4 sigma on a binomial with p ≈ 0.15–0.35 at 20 000 shots is under 0.015.
      expect(Math.abs(seen[key] / shots - exact[key])).toBeLessThan(0.015)
    }
  })

  it('throws rather than enumerate an unreasonable number of branches', () => {
    const ops: Circuit['ops'] = [{ name: 'H', qubits: [0] }]
    for (let i = 0; i < 20; i++) {
      ops.push({ name: 'H', qubits: [0] })
      ops.push({ name: 'MEASURE', qubits: [0], clbit: i })
    }
    expect(() => outcomeBranches({ numQubits: 1, ops })).toThrow(/branches/)
    // ...but a lower cap can be asked for, and is honoured.
    expect(() => outcomeBranches(bellMeasured, { maxBranches: 1 })).toThrow(/branches/)
  })
})

describe('simulate / simulateSteps / run with classical control', () => {
  it('simulate returns the same trajectory every time for the same circuit', () => {
    const a = Array.from(simulate(bellMeasured).data)
    const b = Array.from(simulate({ ...bellMeasured, ops: [...bellMeasured.ops] }).data)
    expect(a).toEqual(b)
  })

  it('simulate returns a genuine branch, not a smeared average', () => {
    const sv = simulate(bellMeasured)
    const p = sv.probabilities()
    // One basis state holds everything: |00⟩ or |11⟩, never a mixture of both.
    expect(p.filter((v) => v > 1e-9)).toHaveLength(1)
    expect(p[0b01]).toBeLessThan(1e-12)
    expect(p[0b10]).toBeLessThan(1e-12)
  })

  it("simulateSteps' last frame is what simulate returns", () => {
    const frames = simulateSteps(bellMeasured)
    expect(frames).toHaveLength(bellMeasured.ops.length + 1)
    expect(Array.from(frames[frames.length - 1].data)).toEqual(Array.from(simulate(bellMeasured).data))
  })

  it('run reports the exact mixture, not the single displayed branch', () => {
    const r = run(bellMeasured, 4096, 0, 99)
    near(r.probabilities[0b00], 0.5, 1e-12)
    near(r.probabilities[0b11], 0.5, 1e-12)
    expect(r.probabilities[0b01]).toBe(0)
    // Both outcomes actually show up in the sampled counts.
    expect(r.counts['00']).toBeGreaterThan(1500)
    expect(r.counts['11']).toBeGreaterThan(1500)
  })

  it('leaves circuits without classical control byte-for-byte unchanged', () => {
    const plain: Circuit = {
      numQubits: 2,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'MEASURE', qubits: [0] },
      ],
    }
    // The bare MEASURE is still ignored: this is the pre-measurement state.
    const p = simulate(plain).probabilities()
    near(p[0b00], 0.5)
    near(p[0b11], 0.5)
  })
})

describe('OpenQASM round trip with classical control', () => {
  it('carries measurement targets and conditions through export and import', () => {
    const c: Circuit = {
      numQubits: 3,
      numClbits: 2,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'MEASURE', qubits: [1], clbit: 1 },
        { name: 'X', qubits: [2], condition: { bit: 1, value: 1 } },
        { name: 'Z', qubits: [2], condition: { bit: 0, value: 0 } },
      ],
    }
    const qasm = toQasm(c)
    expect(qasm).toContain('c[0] = measure q[0];')
    /*
     * Braced, and compared against a boolean — not `if (c[1] == 1) x q[2];`,
     * which is what this used to emit and what no Qiskit parser will read. A
     * single `bit` compares to `true`/`false`; only a whole register compares
     * to an integer. services/api rejected every classically-controlled
     * circuit until this changed, so these two strings are a wire contract
     * with the Python service, not a formatting preference.
     */
    expect(qasm).toContain('if (c[1] == true) { x q[2]; }')
    expect(qasm).toContain('if (c[0] == false) { z q[2]; }')

    const back = fromQasm(qasm)
    expect(back.ops).toEqual(c.ops)
    // The distribution survives, which is the claim that actually matters.
    const before = outcomeProbabilities(c)
    const after = outcomeProbabilities(back)
    before.forEach((v, i) => near(after[i], v, 1e-12))
  })

  it('accepts the braced form and the OpenQASM 2 arrow form', () => {
    const src = [
      'qubit[2] q;',
      'bit[2] c;',
      'h q[0];',
      'measure q[0] -> c[0];',
      'if (c[0] == 1) { x q[1]; }',
    ].join('\n')
    const c = fromQasm(src)
    expect(c.ops).toEqual([
      { name: 'H', qubits: [0] },
      { name: 'MEASURE', qubits: [0], clbit: 0 },
      { name: 'X', qubits: [1], condition: { bit: 0, value: 1 } },
    ])
    // H then measure then conditional X gives |00⟩ or |11⟩, half each.
    const p = outcomeProbabilities(c)
    near(p[0b00], 0.5)
    near(p[0b11], 0.5)
  })

  it('reads every spelling of a condition, including the one it no longer writes', () => {
    // `== 1` / `== 0` is what toQasm emitted before the boolean form, so it is
    // sitting in saved circuits and in already-shared links. Dropping support
    // would silently turn a conditioned gate into an unconditional one, which
    // changes the answer rather than failing.
    const spellings: Array<[string, 0 | 1]> = [
      ['if (c[0] == 1) x q[1];', 1],
      ['if (c[0] == 0) x q[1];', 0],
      ['if (c[0] == true) { x q[1]; }', 1],
      ['if (c[0] == False) { x q[1]; }', 0],
    ]
    for (const [line, value] of spellings) {
      const parsed = fromQasm(['qubit[2] q;', 'bit[2] c;', 'c[0] = measure q[0];', line].join('\n'))
      expect(parsed.ops, line).toEqual([
        { name: 'MEASURE', qubits: [0], clbit: 0 },
        { name: 'X', qubits: [1], condition: { bit: 0, value } },
      ])
    }
  })

  it('still drops the trailing whole-register measure-all', () => {
    const c = fromQasm(toQasm({ numQubits: 2, ops: [{ name: 'H', qubits: [0] }] }))
    expect(c.ops).toEqual([{ name: 'H', qubits: [0] }])
  })

  it('never throws on hostile classical-control syntax', () => {
    const hostile = [
      'if (c[] == 1) x q[0];',
      'if (c[0] == 2) x q[0];',
      'c[] = measure q[0];',
      'if (c[0] == 1)',
      'c[999999999999] = measure q[0];',
    ]
    for (const src of hostile) expect(() => fromQasm(src)).not.toThrow()
  })
})
