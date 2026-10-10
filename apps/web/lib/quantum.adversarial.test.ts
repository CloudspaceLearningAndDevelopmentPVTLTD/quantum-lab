/**
 * quantum.adversarial.test.ts — tests written to break lib/quantum.ts.
 *
 * quantum.test.ts checks that the simulator does what the textbook says on
 * known circuits. This file assumes the code is wrong until forced otherwise:
 * randomised properties over thousands of circuits, the bit-order convention
 * checked on every path that can flip it, exact (not approximate) QASM round
 * trips, and the inputs a user or a pasted file can actually produce —
 * out-of-range qubits, control === target, NaN angles, 16-qubit registers.
 *
 * Everything here is deterministic: every "random" circuit comes from
 * mulberry32 with a fixed seed, so a failure is reproducible from the seed
 * printed in the test name. Do not swap these for Math.random.
 */

import { describe, it, expect } from 'vitest'
import {
  StateVector,
  simulate,
  simulateSteps,
  run,
  mulberry32,
  toQasm,
  fromQasm,
  emptyCircuit,
  PRESETS,
  type Circuit,
  type GateOp,
  type GateName,
} from './quantum'

// ────────────────────────────────────────────────────────────
// Random circuit generation
// ────────────────────────────────────────────────────────────

const ONE_Q: GateName[] = ['H', 'X', 'Y', 'Z', 'S', 'SDG', 'T', 'TDG']
const ROT: GateName[] = ['RX', 'RY', 'RZ', 'P']
const TWO_Q: GateName[] = ['CX', 'CY', 'CZ', 'SWAP']

/** Inverse of a single op, as an op list (reversed order is the caller's job). */
function invert(op: GateOp): GateOp {
  switch (op.name) {
    case 'S': return { name: 'SDG', qubits: op.qubits }
    case 'SDG': return { name: 'S', qubits: op.qubits }
    case 'T': return { name: 'TDG', qubits: op.qubits }
    case 'TDG': return { name: 'T', qubits: op.qubits }
    case 'RX': case 'RY': case 'RZ': case 'P':
      return { name: op.name, qubits: op.qubits, theta: -(op.theta ?? 0) }
    // H, X, Y, Z, CX, CY, CZ, SWAP, CCX are all self-inverse.
    default: return op
  }
}

/** Pick `count` distinct qubits from [0, n). */
function distinctQubits(rng: () => number, n: number, count: number): number[] {
  const pool = Array.from({ length: n }, (_, i) => i)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}

/**
 * A random but always-legal circuit: distinct qubits per gate, finite angles,
 * every index inside the register. Illegal inputs are tested separately and
 * on purpose — mixing them in here would only prove the generator is buggy.
 */
function randomCircuit(rng: () => number, numQubits: number, depth: number): Circuit {
  const ops: GateOp[] = []
  for (let d = 0; d < depth; d++) {
    const roll = rng()
    if (roll < 0.4 || numQubits < 2) {
      const g = ONE_Q[Math.floor(rng() * ONE_Q.length)]
      ops.push({ name: g, qubits: distinctQubits(rng, numQubits, 1) })
    } else if (roll < 0.7) {
      const g = ROT[Math.floor(rng() * ROT.length)]
      ops.push({
        name: g,
        qubits: distinctQubits(rng, numQubits, 1),
        theta: (rng() * 8 - 4) * Math.PI,
      })
    } else if (roll < 0.95 || numQubits < 3) {
      const g = TWO_Q[Math.floor(rng() * TWO_Q.length)]
      ops.push({ name: g, qubits: distinctQubits(rng, numQubits, 2) })
    } else {
      ops.push({ name: 'CCX', qubits: distinctQubits(rng, numQubits, 3) })
    }
  }
  return { numQubits, ops }
}

const norm2 = (s: StateVector) => s.probabilities().reduce((a, b) => a + b, 0)

/** Largest absolute amplitude difference between two states of equal size. */
function maxAmpDiff(a: StateVector, b: StateVector): number {
  let worst = 0
  for (let i = 0; i < a.data.length; i++) {
    worst = Math.max(worst, Math.abs(a.data[i] - b.data[i]))
  }
  return worst
}

// ────────────────────────────────────────────────────────────
// Properties over random circuits
// ────────────────────────────────────────────────────────────

describe('properties of random circuits', () => {
  const CASES = 200

  it('keeps the norm at 1 for 200 random circuits (before normalize())', () => {
    const rng = mulberry32(0xc0ffee)
    let worst = 0
    for (let k = 0; k < CASES; k++) {
      const n = 1 + Math.floor(rng() * 5)
      const circuit = randomCircuit(rng, n, 1 + Math.floor(rng() * 25))
      // Deliberately NOT simulate(): that calls normalize(), which would hide
      // a non-unitary gate by rescaling the answer it produced.
      const sv = new StateVector(n)
      for (const op of circuit.ops) sv.apply(op)
      worst = Math.max(worst, Math.abs(norm2(sv) - 1))
    }
    // 25 gates of accumulated double rounding; measured worst case ~4e-16.
    expect(worst).toBeLessThan(1e-12)
  })

  it('measurement probabilities sum to 1 and are each in [0, 1]', () => {
    const rng = mulberry32(7)
    for (let k = 0; k < CASES; k++) {
      const n = 1 + Math.floor(rng() * 4)
      const probs = simulate(randomCircuit(rng, n, 12)).probabilities()
      expect(probs).toHaveLength(1 << n)
      for (const p of probs) {
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThanOrEqual(1 + 1e-12)
      }
      expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    }
  })

  it('circuit followed by its inverse returns the original state', () => {
    const rng = mulberry32(31337)
    let worst = 0
    for (let k = 0; k < CASES; k++) {
      const n = 1 + Math.floor(rng() * 4)
      const circuit = randomCircuit(rng, n, 1 + Math.floor(rng() * 20))
      const undone: Circuit = {
        numQubits: n,
        ops: [...circuit.ops, ...[...circuit.ops].reverse().map(invert)],
      }
      const start = new StateVector(n)
      worst = Math.max(worst, maxAmpDiff(simulate(undone), start))
    }
    expect(worst).toBeLessThan(1e-12)
  })

  it('is deterministic — the same circuit gives bit-identical amplitudes', () => {
    const rng = mulberry32(99)
    for (let k = 0; k < 40; k++) {
      const circuit = randomCircuit(rng, 3, 15)
      expect(Array.from(simulate(circuit).data)).toEqual(Array.from(simulate(circuit).data))
    }
  })

  it('applying a gate twice where the gate is self-inverse is the identity', () => {
    const rng = mulberry32(5)
    for (const name of ['H', 'X', 'Y', 'Z'] as GateName[]) {
      const base = randomCircuit(rng, 3, 8)
      const before = simulate(base)
      const after = simulate({
        numQubits: 3,
        ops: [...base.ops, { name, qubits: [1] }, { name, qubits: [1] }],
      })
      expect(maxAmpDiff(before, after)).toBeLessThan(1e-13)
    }
  })

  it('simulateSteps agrees with simulate at the last frame and never drifts', () => {
    const rng = mulberry32(1234)
    for (let k = 0; k < 30; k++) {
      const circuit = randomCircuit(rng, 3, 14)
      const frames = simulateSteps(circuit)
      expect(frames).toHaveLength(circuit.ops.length + 1)
      // simulateSteps does not normalize; simulate does. If the two disagree
      // by more than float noise, a gate is non-unitary.
      expect(maxAmpDiff(frames[frames.length - 1], simulate(circuit))).toBeLessThan(1e-12)
      for (const f of frames) expect(Math.abs(norm2(f) - 1)).toBeLessThan(1e-12)
    }
  })
})

// ────────────────────────────────────────────────────────────
// Reduced density matrix / entropy
// ────────────────────────────────────────────────────────────

describe('reduced state and entanglement entropy', () => {
  it('a product state has zero entropy on every qubit', () => {
    const rng = mulberry32(88)
    for (let k = 0; k < 50; k++) {
      // Independent single-qubit rotations can never entangle.
      const ops: GateOp[] = []
      for (let q = 0; q < 3; q++) {
        ops.push({ name: 'RY', qubits: [q], theta: rng() * 2 * Math.PI })
        ops.push({ name: 'RZ', qubits: [q], theta: rng() * 2 * Math.PI })
      }
      const sv = simulate({ numQubits: 3, ops })
      for (let q = 0; q < 3; q++) {
        expect(sv.entanglementEntropy(q)).toBeLessThan(1e-12)
        const b = sv.blochVector(q)
        expect(Math.hypot(b.x, b.y, b.z)).toBeCloseTo(1, 12)
      }
    }
  })

  it('a Bell state has exactly ln 2 of entropy in nats (1 bit)', () => {
    const bell = simulate({
      numQubits: 2,
      ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }],
    })
    for (const q of [0, 1]) {
      // entanglementEntropy is in BITS. Nats = bits * ln 2.
      expect(bell.entanglementEntropy(q) * Math.LN2).toBeCloseTo(Math.LN2, 12)
      const b = bell.blochVector(q)
      // Maximally mixed reduced state: the Bloch vector is the origin.
      expect(Math.hypot(b.x, b.y, b.z)).toBeLessThan(1e-15)
    }
  })

  it('the two halves of any 2-qubit pure state have equal entropy (Schmidt)', () => {
    const rng = mulberry32(424242)
    for (let k = 0; k < 100; k++) {
      const sv = simulate(randomCircuit(rng, 2, 10))
      expect(sv.entanglementEntropy(0)).toBeCloseTo(sv.entanglementEntropy(1), 12)
    }
  })

  it('entropy stays within [0, 1] bits and the Bloch radius within [0, 1]', () => {
    const rng = mulberry32(606)
    for (let k = 0; k < 100; k++) {
      const n = 2 + Math.floor(rng() * 3)
      const sv = simulate(randomCircuit(rng, n, 18))
      for (let q = 0; q < n; q++) {
        const s = sv.entanglementEntropy(q)
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1 + 1e-12)
        const b = sv.blochVector(q)
        expect(Math.hypot(b.x, b.y, b.z)).toBeLessThanOrEqual(1 + 1e-12)
      }
    }
  })

  it('a partially rotated Bell pair interpolates between 0 and 1 bit', () => {
    const entropyAt = (theta: number) =>
      simulate({
        numQubits: 2,
        ops: [{ name: 'RY', qubits: [0], theta }, { name: 'CX', qubits: [0, 1] }],
      }).entanglementEntropy(1)
    expect(entropyAt(0)).toBeCloseTo(0, 12)
    expect(entropyAt(Math.PI / 2)).toBeCloseTo(1, 12)
    expect(entropyAt(Math.PI)).toBeCloseTo(0, 12)
  })
})

// ────────────────────────────────────────────────────────────
// The bit-order convention, on every path that can flip it
// ────────────────────────────────────────────────────────────

describe('qubit 0 is the LSB, labels print MSB-first', () => {
  const three = (ops: GateOp[]) => simulate({ numQubits: 3, ops })

  it('X on qubit q sets basis index 1 << q', () => {
    for (let q = 0; q < 3; q++) {
      const probs = three([{ name: 'X', qubits: [q] }]).probabilities()
      expect(probs[1 << q]).toBeCloseTo(1, 12)
    }
  })

  it('the label of index 1 << q has its 1 at position n-1-q', () => {
    const sv = new StateVector(3)
    expect(sv.label(1)).toBe('001')
    expect(sv.label(2)).toBe('010')
    expect(sv.label(4)).toBe('100')
    expect(sv.label(5)).toBe('101')
  })

  it('shot counts key qubit q at character n-1-q', () => {
    const res = run({ numQubits: 3, ops: [{ name: 'X', qubits: [0] }] }, 64, 0, 1)
    expect(Object.keys(res.counts)).toEqual(['001'])
    const res2 = run({ numQubits: 3, ops: [{ name: 'X', qubits: [2] }] }, 64, 0, 1)
    expect(Object.keys(res2.counts)).toEqual(['100'])
  })

  it('qubitProbability and blochVector address the same qubit as X does', () => {
    const sv = three([{ name: 'X', qubits: [1] }])
    expect(sv.qubitProbability(0)).toBeCloseTo(0, 12)
    expect(sv.qubitProbability(1)).toBeCloseTo(1, 12)
    expect(sv.qubitProbability(2)).toBeCloseTo(0, 12)
    expect(sv.blochVector(1).z).toBeCloseTo(-1, 12)
    expect(sv.blochVector(0).z).toBeCloseTo(1, 12)
  })

  it('CX(control=0, target=2) maps |001> to |101>', () => {
    const probs = three([
      { name: 'X', qubits: [0] },
      { name: 'CX', qubits: [0, 2] },
    ]).probabilities()
    expect(probs[0b101]).toBeCloseTo(1, 12)
  })

  it('the asymmetric GHZ-like state pins down operand order', () => {
    // H on 0 then CX(0 -> 1) leaves qubit 2 alone: |000> + |011>, i.e.
    // indices 0 and 3, labels "000" and "011".
    const probs = three([{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }]).probabilities()
    expect(probs[0]).toBeCloseTo(0.5, 12)
    expect(probs[0b011]).toBeCloseTo(0.5, 12)
    expect(probs[0b110]).toBeCloseTo(0, 12)
  })

  it('QASM export writes q[0] for the LSB and re-import preserves it', () => {
    const circuit: Circuit = { numQubits: 3, ops: [{ name: 'X', qubits: [0] }] }
    const qasm = toQasm(circuit)
    expect(qasm).toContain('x q[0];')
    const probs = simulate(fromQasm(qasm)).probabilities()
    expect(probs[1]).toBeCloseTo(1, 12)
  })

  it('QASM keeps control and target the right way round', () => {
    // cx q[0], q[1] on |001> must give |011>, not |101> or |010>.
    const qasm = toQasm({
      numQubits: 3,
      ops: [{ name: 'X', qubits: [0] }, { name: 'CX', qubits: [0, 1] }],
    })
    expect(qasm).toContain('cx q[0], q[1];')
    expect(simulate(fromQasm(qasm)).probabilities()[0b011]).toBeCloseTo(1, 12)
  })

  it('SWAP moves the excitation between the labelled positions', () => {
    const sv = three([{ name: 'X', qubits: [0] }, { name: 'SWAP', qubits: [0, 2] }])
    expect(sv.probabilities()[0b100]).toBeCloseTo(1, 12)
    expect(sv.label(0b100)).toBe('100')
  })

  it('matches the PennyLane->project conversion in services/api (string reverse)', () => {
    // services/api/app/quantum/pennylane_runner._to_project_bitstring reverses
    // PennyLane's wire-0-first key. Reversing our key must therefore put
    // qubit 0 first. If this ever disagrees, every multi-qubit hardware result
    // is mirrored.
    const key = Object.keys(run({ numQubits: 3, ops: [{ name: 'X', qubits: [0] }] }, 8, 0, 2).counts)[0]
    expect(key).toBe('001')
    expect([...key].reverse().join('')).toBe('100') // wire 0 first == PennyLane
  })
})

// ────────────────────────────────────────────────────────────
// OpenQASM round trips — exact, not close
// ────────────────────────────────────────────────────────────

describe('QASM round trip is exact', () => {
  const EXACT_FRACTIONS: [number, string][] = [
    [Math.PI, 'pi'],
    [-Math.PI, '-pi'],
    [Math.PI / 2, 'pi/2'],
    [Math.PI / 3, 'pi/3'],
    [Math.PI / 4, 'pi/4'],
    [Math.PI / 6, 'pi/6'],
    [Math.PI / 8, 'pi/8'],
    [Math.PI / 12, 'pi/12'],
    [Math.PI / 16, 'pi/16'],
    [2 * Math.PI, '2*pi'],
    [3 * Math.PI, '3*pi'],
    [(3 * Math.PI) / 2, '3*pi/2'],
    [(5 * Math.PI) / 16, '5*pi/16'],
    [(-3 * Math.PI) / 4, '-3*pi/4'],
    [-Math.PI / 4, '-pi/4'],
  ]

  it.each(EXACT_FRACTIONS)('emits %d as the exact fraction %s', (theta, text) => {
    const qasm = toQasm({ numQubits: 1, ops: [{ name: 'RZ', qubits: [0], theta }] })
    expect(qasm).toContain(`rz(${text}) q[0];`)
    // Bit-exact, not toBeCloseTo: the point of the fraction form is that the
    // double that comes back is the same double that went out.
    expect(fromQasm(qasm).ops[0].theta).toBe(theta)
  })

  it.each([Math.PI / 5, Math.PI / 7, Math.PI / 10, 0.1234567, 1e-300, -2.5, 1 / 3])(
    'falls back to a decimal for %d and still round-trips bit-exactly',
    (theta) => {
      const qasm = toQasm({ numQubits: 1, ops: [{ name: 'RX', qubits: [0], theta }] })
      expect(qasm).not.toContain('pi')
      expect(fromQasm(qasm).ops[0].theta).toBe(theta)
    }
  )

  it('an angle of 2*pi*k round-trips and acts as a global phase only', () => {
    for (const k of [1, 2, 3, 8]) {
      const theta = 2 * Math.PI * k
      const qasm = toQasm({ numQubits: 1, ops: [{ name: 'RY', qubits: [0], theta }] })
      expect(fromQasm(qasm).ops[0].theta).toBe(theta)
      // RY(2*pi) = -I: probabilities unchanged, amplitude sign flips for odd k.
      const sv = simulate({ numQubits: 1, ops: [{ name: 'RY', qubits: [0], theta }] })
      expect(sv.probabilities()[0]).toBeCloseTo(1, 12)
      expect(sv.amplitude(0).re).toBeCloseTo(k % 2 === 0 ? 1 : -1, 12)
    }
  })

  it('snaps a near-fraction angle by at most 3.2e-12 rad, and only once', () => {
    // Documented behaviour, pinned so nobody widens the 1e-12 window without
    // noticing what it costs: an angle within the window of n*pi/d is written
    // as that fraction, which moves it by up to pi*1e-12.
    const nearly = Math.PI / 6 + 1e-13
    const qasm = toQasm({ numQubits: 1, ops: [{ name: 'RZ', qubits: [0], theta: nearly }] })
    expect(qasm).toContain('rz(pi/6)')
    const back = fromQasm(qasm).ops[0].theta!
    expect(back).not.toBe(nearly)
    expect(Math.abs(back - nearly)).toBeLessThan(3.2e-12)
    // The snap happens once: the second cycle is an identity.
    const twice = fromQasm(toQasm({ numQubits: 1, ops: [{ name: 'RZ', qubits: [0], theta: back }] }))
    expect(twice.ops[0].theta).toBe(back)
    // An angle outside the window is left alone entirely.
    const far = Math.PI / 6 + 1e-9
    expect(fromQasm(toQasm({ numQubits: 1, ops: [{ name: 'RZ', qubits: [0], theta: far }] })).ops[0].theta).toBe(far)
  })

  it('does not drift over 20 export/import cycles', () => {
    let circuit: Circuit = PRESETS.find((p) => p.id === 'teleport')!.circuit
    const first = Array.from(simulate(circuit).data)
    for (let i = 0; i < 20; i++) circuit = fromQasm(toQasm(circuit))
    // The historical bug: toFixed(6) shifted probabilities ~5e-8 per cycle.
    expect(Array.from(simulate(circuit).data)).toEqual(first)
  })

  it('reproduces every preset bit-for-bit through one round trip', () => {
    for (const p of PRESETS) {
      const before = Array.from(simulate(p.circuit).data)
      const after = Array.from(simulate(fromQasm(toQasm(p.circuit))).data)
      expect({ id: p.id, data: after }).toEqual({ id: p.id, data: before })
    }
  })

  it('reproduces 100 random circuits bit-for-bit through one round trip', () => {
    const rng = mulberry32(2024)
    for (let k = 0; k < 100; k++) {
      const n = 1 + Math.floor(rng() * 4)
      const circuit = randomCircuit(rng, n, 1 + Math.floor(rng() * 15))
      const before = Array.from(simulate(circuit).data)
      const after = Array.from(simulate(fromQasm(toQasm(circuit))).data)
      expect(after).toEqual(before)
    }
  })

  it('refuses to write a non-finite angle instead of emitting rx(NaN)', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => toQasm({ numQubits: 1, ops: [{ name: 'RX', qubits: [0], theta: bad }] })).toThrow(
        /finite/
      )
    }
  })

  it('drops an instruction it would otherwise import as a silent no-op', () => {
    // `cx q[0], q[0];` is not a legal gate. It used to import fine and then
    // simulate as the identity; now it is dropped at import and the simulator
    // rejects it if it is constructed directly.
    const c = fromQasm('qubit[2] q;\nh q[0];\ncx q[0], q[0];\n')
    expect(c.ops.map((o) => o.name)).toEqual(['H'])
    expect(() => new StateVector(2).apply({ name: 'CX', qubits: [0, 0] })).toThrow(/target/)
  })

  it('drops an instruction with the wrong number of operands', () => {
    expect(fromQasm('qubit[2] q;\ncx q[0];\n').ops).toEqual([])
    expect(fromQasm('qubit[3] q;\nccx q[0], q[1];\n').ops).toEqual([])
    expect(fromQasm('qubit[2] q;\nh q[0], q[1];\n').ops).toEqual([])
  })

  it('round-trips a circuit that is only measurements into an empty op list', () => {
    const circuit: Circuit = {
      numQubits: 2,
      ops: [{ name: 'MEASURE', qubits: [0] }, { name: 'MEASURE', qubits: [1] }],
    }
    const back = fromQasm(toQasm(circuit))
    // Documented loss: MEASURE and BARRIER do not survive a round trip. The
    // state does, which is what every consumer of this module reads.
    expect(back.ops).toEqual([])
    expect(back.numQubits).toBe(2)
  })

  it('keeps the qubit count of an empty circuit', () => {
    expect(fromQasm(toQasm(emptyCircuit(4))).numQubits).toBe(4)
    expect(fromQasm(toQasm(emptyCircuit(1))).numQubits).toBe(1)
  })

  it('never throws on hostile input', () => {
    const hostile = [
      '', '\n\n\n', 'not qasm at all', 'qubit[0] q;', 'qubit[999] q;',
      'h q[999999];', 'rx() q[0];', 'rx(pi/0) q[0];', 'rx(*) q[0];',
      'h q[0]; // trailing comment', 'HXHXHX', '{"json": true}',
    ]
    for (const src of hostile) expect(() => fromQasm(src)).not.toThrow()
  })
})

// ────────────────────────────────────────────────────────────
// Numerical and structural edge cases
// ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('rejects a zero-qubit, fractional or oversized register', () => {
    for (const n of [0, -1, 1.5, 17, NaN, Infinity]) {
      expect(() => new StateVector(n)).toThrow(/integer between 1 and 16/)
    }
    expect(() => simulate({ numQubits: 0, ops: [] })).toThrow()
  })

  it('handles a one-qubit circuit', () => {
    const sv = simulate({ numQubits: 1, ops: [{ name: 'H', qubits: [0] }] })
    expect(sv.dim).toBe(2)
    expect(sv.probabilities()).toEqual([0.5000000000000001, 0.5000000000000001])
    expect(sv.label(0)).toBe('0')
  })

  it('handles 5, 12 and 16 qubits (16 is the engine ceiling)', () => {
    // lib/plans.ts gives every plan 16; 5 and 12 were the old Free and Pro ceilings.
    for (const n of [5, 12, 16]) {
      const sv = simulate({
        numQubits: n,
        ops: Array.from({ length: n }, (_, q) => ({ name: 'H' as GateName, qubits: [q] })),
      })
      expect(sv.dim).toBe(2 ** n)
      expect(sv.probability(0)).toBeCloseTo(1 / 2 ** n, 15)
      expect(Math.abs(norm2(sv) - 1)).toBeLessThan(1e-12)
      expect(sv.label(sv.dim - 1)).toBe('1'.repeat(n))
    }
  })

  it('runs an empty circuit as |0...0>', () => {
    const sv = simulate(emptyCircuit(3))
    expect(sv.probabilities()).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(simulateSteps(emptyCircuit(3))).toHaveLength(1)
    expect(run(emptyCircuit(3), 32, 0, 1).counts).toEqual({ '000': 32 })
  })

  it('treats a circuit of nothing but measurements as the identity', () => {
    const ops: GateOp[] = [
      { name: 'MEASURE', qubits: [0] },
      { name: 'MEASURE', qubits: [0] },
      { name: 'MEASURE', qubits: [1] },
      { name: 'BARRIER', qubits: [] },
    ]
    expect(simulate({ numQubits: 2, ops }).probabilities()).toEqual([1, 0, 0, 0])
  })

  it('makes repeated measurement of the same qubit idempotent', () => {
    const rng = mulberry32(17)
    for (let k = 0; k < 25; k++) {
      const sv = simulate(randomCircuit(mulberry32(k), 3, 10))
      const first = sv.measureQubit(1, rng)
      for (let i = 0; i < 5; i++) expect(sv.measureQubit(1, rng)).toBe(first)
      expect(Math.abs(norm2(sv) - 1)).toBeLessThan(1e-12)
      // The collapsed qubit is now definite: probability 0 or 1, no smearing.
      expect(sv.qubitProbability(1)).toBeCloseTo(first, 12)
    }
  })

  it('measuring one half of a Bell pair pins the other half', () => {
    for (let seed = 0; seed < 20; seed++) {
      const sv = simulate({
        numQubits: 2,
        ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }],
      })
      const a = sv.measureQubit(0, mulberry32(seed))
      expect(sv.measureQubit(1, mulberry32(seed + 1000))).toBe(a)
    }
  })

  it('rejects a control that is also the target', () => {
    const sv = () => new StateVector(3).applySingle('H', 0)
    expect(() => sv().apply({ name: 'CX', qubits: [0, 0] })).toThrow(/target/)
    expect(() => sv().apply({ name: 'CY', qubits: [1, 1] })).toThrow(/target/)
    expect(() => sv().apply({ name: 'CZ', qubits: [2, 2] })).toThrow(/target/)
    expect(() => sv().apply({ name: 'CCX', qubits: [0, 1, 1] })).toThrow(/target/)
    expect(() => sv().apply({ name: 'CCX', qubits: [0, 0, 1] })).toThrow(/twice/)
    expect(() => sv().applyControlled('X', [1], 1)).toThrow(/target/)
  })

  it('accepts SWAP of a qubit with itself as the identity', () => {
    const sv = new StateVector(2).applySingle('H', 0)
    const before = Array.from(sv.data)
    sv.apply({ name: 'SWAP', qubits: [1, 1] })
    expect(Array.from(sv.data)).toEqual(before)
  })

  it('rejects qubit indices outside the register instead of returning NaN', () => {
    const sv = () => new StateVector(2)
    for (const q of [2, 16, -1, 1.5, NaN]) {
      expect(() => sv().applySingle('X', q)).toThrow(/out of range/)
      expect(() => sv().applySwap(0, q)).toThrow(/out of range/)
      expect(() => sv().blochVector(q)).toThrow(/out of range/)
      expect(() => sv().entanglementEntropy(q)).toThrow(/out of range/)
      expect(() => sv().measureQubit(q)).toThrow(/out of range/)
      expect(() => sv().qubitProbability(q)).toThrow(/out of range/)
      expect(() => sv().applyControlled('X', [q], 0)).toThrow(/out of range/)
      expect(() => sv().applyControlled('X', [0], q)).toThrow(/out of range/)
    }
    expect(() => simulate({ numQubits: 2, ops: [{ name: 'H', qubits: [5] }] })).toThrow(
      /out of range/
    )
  })

  it('rejects an out-of-range basis index instead of returning NaN', () => {
    const sv = new StateVector(2)
    for (const i of [4, -1, 1.5, NaN]) {
      expect(() => sv.probability(i)).toThrow(/basis index/)
      expect(() => sv.amplitude(i)).toThrow(/basis index/)
      expect(() => sv.label(i)).toThrow(/basis index/)
    }
  })

  it('rejects the wrong number of operands', () => {
    const sv = () => new StateVector(3)
    expect(() => sv().apply({ name: 'CX', qubits: [0] })).toThrow(/takes 2/)
    expect(() => sv().apply({ name: 'CCX', qubits: [0, 1] })).toThrow(/takes 3/)
    expect(() => sv().apply({ name: 'H', qubits: [0, 1] })).toThrow(/takes 1/)
    expect(() => sv().apply({ name: 'SWAP', qubits: [] })).toThrow(/takes 2/)
  })

  it('rejects NaN and Infinity angles at the point of application', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      for (const name of ['RX', 'RY', 'RZ', 'P'] as GateName[]) {
        expect(() => new StateVector(1).applySingle(name, 0, bad)).toThrow(/finite/)
        expect(() =>
          simulate({ numQubits: 1, ops: [{ name, qubits: [0], theta: bad }] })
        ).toThrow(/finite/)
      }
      // A non-angle gate ignores theta and must keep working.
      expect(() => new StateVector(1).applySingle('H', 0, bad)).not.toThrow()
    }
  })

  it('rejects non-finite amplitudes in fromAmplitudes', () => {
    expect(() => StateVector.fromAmplitudes([{ re: NaN, im: 0 }, { re: 0, im: 0 }])).toThrow(
      /finite/
    )
    expect(() => StateVector.fromAmplitudes([{ re: 0, im: Infinity }, { re: 1, im: 0 }])).toThrow(
      /finite/
    )
  })

  it('normalize() rescales an un-normalized state and leaves a good one alone', () => {
    const s = StateVector.fromAmplitudes([{ re: 3, im: 0 }, { re: 4, im: 0 }])
    expect(norm2(s)).toBe(25)
    s.normalize()
    expect(s.probabilities()[0]).toBeCloseTo(0.36, 15)
    const good = new StateVector(2)
    const before = Array.from(good.data)
    expect(Array.from(good.normalize().data)).toEqual(before)
  })
})

// ────────────────────────────────────────────────────────────
// Sampling
// ────────────────────────────────────────────────────────────

describe('shot sampling', () => {
  it('counts always sum to shots and use valid labels', () => {
    const rng = mulberry32(4242)
    for (let k = 0; k < 40; k++) {
      const n = 1 + Math.floor(rng() * 3)
      const circuit = randomCircuit(rng, n, 8)
      const res = run(circuit, 500, 0, k)
      expect(Object.values(res.counts).reduce((a, b) => a + b, 0)).toBe(500)
      for (const key of Object.keys(res.counts)) {
        expect(key).toMatch(new RegExp(`^[01]{${n}}$`))
      }
      expect(res.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    }
  })

  it('samples the true distribution to within 1.5% at 40k shots', () => {
    const circuit: Circuit = {
      numQubits: 3,
      ops: [
        { name: 'RY', qubits: [0], theta: Math.PI / 3 },
        { name: 'H', qubits: [1] },
        { name: 'CX', qubits: [1, 2] },
        { name: 'T', qubits: [2] },
      ],
    }
    const res = run(circuit, 40000, 0, 12345)
    res.probabilities.forEach((p, i) => {
      const observed = (res.counts[res.labels[i]] ?? 0) / res.shots
      expect(Math.abs(observed - p)).toBeLessThan(0.015)
    })
  })

  it('never samples a basis state of probability zero', () => {
    // Grover on 2 qubits is deterministic; anything but "11" is a sampler bug.
    const grover = PRESETS.find((p) => p.id === 'grover2')!.circuit
    expect(run(grover, 5000, 0, 9).counts).toEqual({ '11': 5000 })
  })

  it('flips every bit when noise is 1 and no bits when noise is 0', () => {
    const circuit: Circuit = { numQubits: 3, ops: [{ name: 'X', qubits: [0] }] }
    expect(run(circuit, 100, 1, 3).counts).toEqual({ '110': 100 })
    expect(run(circuit, 100, 0, 3).counts).toEqual({ '001': 100 })
  })

  it('returns an empty count map for zero shots', () => {
    expect(run(emptyCircuit(2), 0, 0, 1).counts).toEqual({})
  })

  it('is reproducible per seed and differs across seeds', () => {
    const bell = PRESETS.find((p) => p.id === 'bell')!.circuit
    expect(run(bell, 400, 0, 5).counts).toEqual(run(bell, 400, 0, 5).counts)
    // Two outcomes over 400 shots collide across seeds often enough to matter
    // — seeds 5 and 6 both give exactly {00: 206, 11: 194}, and that is the
    // binomial, not a broken PRNG. Use eight outcomes so a collision is not a
    // flake waiting to happen.
    const uniform = PRESETS.find((p) => p.id === 'superposition')!.circuit
    expect(run(uniform, 400, 0, 5).counts).not.toEqual(run(uniform, 400, 0, 6).counts)
  })
})
