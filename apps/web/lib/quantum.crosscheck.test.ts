/**
 * quantum.crosscheck.test.ts — pins the JS simulator against Qiskit.
 *
 * lib/quantum.ts and services/api (Qiskit + Aer) both claim to simulate the
 * same circuit, and the product shows their answers side by side: the browser
 * draws the state, the API runs it on a backend. If they disagree, one of them
 * is lying to the learner and nothing in the app notices.
 *
 * This file owns the JS half. It writes the exported QASM and the JS
 * statevector for a fixed circuit set into
 * `services/api/tests/data/js_statevectors.json`, and asserts on every run
 * that the checked-in fixture still matches what this module computes today.
 * `services/api/tests/test_js_crosscheck.py` reads the same file and compares
 * against Qiskit's Statevector.
 *
 * Regenerate after an intentional change:
 *   cd apps/web && QUANTUM_FIXTURE_WRITE=1 npx vitest run lib/quantum.crosscheck.test.ts
 * A diff you did not intend is the simulator changing physics under you.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  hasClassicalControl,
  simulate,
  toQasm,
  PRESETS,
  type Circuit,
  type GateName,
} from './quantum'

const FIXTURE = resolve(__dirname, '../../../services/api/tests/data/js_statevectors.json')

interface FixtureCase {
  id: string
  numQubits: number
  qasm: string
  /** [re, im] per basis state, index 0 first, qubit 0 = LSB. */
  amplitudes: [number, number][]
  labels: string[]
}

/**
 * The circuit set. Chosen to cover what actually differs between two
 * implementations: operand order on controlled gates, the sign convention of
 * RY and RZ, the global phase of RZ (Qiskit's rz is not Qiskit's u1), the
 * three-qubit gate, and a rotation angle that is not a nice fraction.
 */
/**
 * Presets with mid-circuit measurement and classical feed-forward are NOT
 * cross-checked here, and cannot be.
 *
 * The comparison this file exists for is statevector against statevector, and a
 * circuit that measures does not have one — its result is a mixture over the
 * measurement outcomes. `simulate()` returns a single seeded trajectory for
 * display, and Qiskit's `Statevector` has no way to reproduce that particular
 * branch. Pinning it would pin our RNG, not our physics. The classical-control
 * path has its own exact-analytic suite in quantum.classical.test.ts, which
 * checks the branch probabilities and the corrected output state directly.
 */
const CROSSCHECKABLE_PRESETS = PRESETS.filter((p) => !hasClassicalControl(p.circuit))

const CASES: { id: string; circuit: Circuit }[] = [
  ...CROSSCHECKABLE_PRESETS.map((p) => ({ id: `preset:${p.id}`, circuit: p.circuit })),
  {
    id: 'asymmetric-cx',
    circuit: {
      numQubits: 3,
      ops: [
        { name: 'X', qubits: [0] },
        { name: 'CX', qubits: [0, 2] },
        { name: 'H', qubits: [1] },
        { name: 'CZ', qubits: [1, 2] },
      ],
    },
  },
  {
    id: 'rotations',
    circuit: {
      numQubits: 2,
      ops: [
        { name: 'RX', qubits: [0], theta: Math.PI / 3 },
        { name: 'RY', qubits: [1], theta: -Math.PI / 4 },
        { name: 'RZ', qubits: [0], theta: (2 * Math.PI) / 3 },
        { name: 'P', qubits: [1], theta: Math.PI / 8 },
        { name: 'CX', qubits: [0, 1] },
      ],
    },
  },
  {
    id: 'ugly-angle',
    circuit: {
      numQubits: 2,
      ops: [
        { name: 'RY', qubits: [0], theta: 0.7391 },
        { name: 'CX', qubits: [0, 1] },
        { name: 'RZ', qubits: [1], theta: -1.234567890123 },
      ],
    },
  },
  {
    id: 'phase-gates',
    circuit: {
      numQubits: 2,
      ops: [
        { name: 'H', qubits: [0] }, { name: 'S', qubits: [0] }, { name: 'T', qubits: [0] },
        { name: 'H', qubits: [1] }, { name: 'SDG', qubits: [1] }, { name: 'TDG', qubits: [1] },
        { name: 'CY', qubits: [0, 1] },
      ],
    },
  },
  {
    id: 'toffoli-and-swap',
    circuit: {
      numQubits: 4,
      ops: [
        { name: 'X', qubits: [0] }, { name: 'X', qubits: [1] },
        { name: 'CCX', qubits: [0, 1, 3] },
        { name: 'SWAP', qubits: [2, 3] },
        { name: 'H', qubits: [2] },
      ],
    },
  },
  {
    id: 'five-qubit-free-tier',
    circuit: {
      numQubits: 5,
      ops: [
        ...Array.from({ length: 5 }, (_, q) => ({ name: 'H' as GateName, qubits: [q] })),
        { name: 'CZ', qubits: [0, 4] },
        { name: 'T', qubits: [2] },
        { name: 'CX', qubits: [3, 1] },
      ],
    },
  },
]

function build(): FixtureCase[] {
  return CASES.map(({ id, circuit }) => {
    const sv = simulate(circuit)
    return {
      id,
      numQubits: circuit.numQubits,
      qasm: toQasm(circuit),
      amplitudes: sv.amplitudes().map((a) => [a.re, a.im] as [number, number]),
      labels: sv.probabilities().map((_, i) => sv.label(i)),
    }
  })
}

describe('cross-check fixture for services/api', () => {
  const current = build()

  if (process.env.QUANTUM_FIXTURE_WRITE) {
    it('writes the fixture', () => {
      mkdirSync(dirname(FIXTURE), { recursive: true })
      writeFileSync(FIXTURE, `${JSON.stringify({ cases: current }, null, 2)}\n`)
      expect(current.length).toBeGreaterThan(0)
    })
  }

  it('matches the fixture the Python cross-check reads', () => {
    const onDisk = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: FixtureCase[] }
    // Everything but the amplitudes must match exactly. The amplitudes get
    // 1e-12, not bit equality: Math.sin/Math.cos are not required to be
    // correctly rounded, and V8 releases have moved their last bit (a Node
    // upgrade turned 0.53974616314341 into 0.5397461631434098 and failed this
    // test with no physics change). A real change — a sign, an operand order,
    // a phase convention — moves an amplitude by orders of magnitude more, and
    // the Qiskit comparison in services/api/tests/test_js_crosscheck.py holds
    // its own 1e-9 bound against the same fixture.
    const strip = (cases: FixtureCase[]) => cases.map((cse) => ({ ...cse, amplitudes: [] }))
    expect(strip(onDisk.cases)).toEqual(strip(current))
    for (const [i, cse] of current.entries()) {
      const stored = onDisk.cases[i].amplitudes
      expect(stored.length, cse.id).toBe(cse.amplitudes.length)
      cse.amplitudes.forEach(([re, im], k) => {
        expect(Math.abs(re - stored[k][0]), `${cse.id}[${k}].re`).toBeLessThan(1e-12)
        expect(Math.abs(im - stored[k][1]), `${cse.id}[${k}].im`).toBeLessThan(1e-12)
      })
    }
  })

  it('covers every unitary preset plus the hand-picked convention traps', () => {
    for (const p of CROSSCHECKABLE_PRESETS) {
      expect(current.map((cse) => cse.id)).toContain(`preset:${p.id}`)
    }
    expect(current.length).toBe(CROSSCHECKABLE_PRESETS.length + 6)
  })

  it('excludes exactly the presets that measure', () => {
    const excluded = PRESETS.filter((p) => !CROSSCHECKABLE_PRESETS.includes(p))
    for (const p of excluded) {
      expect(hasClassicalControl(p.circuit)).toBe(true)
      expect(current.map((cse) => cse.id)).not.toContain(`preset:${p.id}`)
    }
  })

  it('every fixture state is normalised', () => {
    for (const cse of current) {
      const total = cse.amplitudes.reduce((a, [re, im]) => a + re * re + im * im, 0)
      expect(total).toBeCloseTo(1, 12)
      expect(cse.amplitudes).toHaveLength(2 ** cse.numQubits)
    }
  })
})
