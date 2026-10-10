/**
 * topology.test.ts — the schematic geometry and the transpiled-QASM reader.
 *
 * The geometry tests pin the structural invariants each family claims (an
 * all-to-all sketch that is missing a chord is a wrong physics statement, not
 * a cosmetic bug), and the parser tests feed it the exact shapes
 * `qasm3.dumps` produces for the backends the device picker offers.
 */

import { describe, expect, it } from 'vitest'
import {
  formatSequence,
  parseGateSequence,
  topologyFamilyFor,
  topologySketch,
  type TopologyFamily,
} from './topology'

describe('topologyFamilyFor', () => {
  it('maps every catalogue backend id onto the vendor family it belongs to', () => {
    // Mirrors BACKEND_VENDOR in services/api/app/quantum/transpile.py.
    const expected: Record<string, TopologyFamily> = {
      ibm_brisbane: 'heavy-hex',
      ibm_kyiv: 'heavy-hex',
      ibm_sherbrooke: 'heavy-hex',
      ionq_aria: 'all-to-all',
      ionq_forte: 'all-to-all',
      azure_ionq_aria: 'all-to-all',
      azure_quantinuum_h1: 'all-to-all',
      rigetti_ankaa: 'square-lattice',
      aer_simulator: 'linear',
    }
    for (const [id, family] of Object.entries(expected)) {
      expect(topologyFamilyFor(id), id).toBe(family)
    }
  })

  it('recognises live-source ids, not only catalogue ids', () => {
    // Live IBM devices arrive under their own names; Braket devices as ARNs.
    expect(topologyFamilyFor('ibm_fez')).toBe('heavy-hex')
    expect(topologyFamilyFor('arn:aws:braket:us-east-1::device/qpu/ionq/Aria-1')).toBe('all-to-all')
    expect(topologyFamilyFor('arn:aws:braket:us-west-1::device/qpu/rigetti/Ankaa-3')).toBe(
      'square-lattice'
    )
  })

  it('falls back to linear for anything unknown', () => {
    expect(topologyFamilyFor('somebody_elses_qpu')).toBe('linear')
  })
})

describe('topologySketch', () => {
  const families: TopologyFamily[] = ['heavy-hex', 'square-lattice', 'all-to-all', 'linear']

  it('every edge references a real node and coordinates stay inside the viewBox', () => {
    for (const family of families) {
      const sketch = topologySketch(family)
      expect(sketch.nodes.length).toBeGreaterThan(1)
      for (const [a, b] of sketch.edges) {
        expect(a).toBeGreaterThanOrEqual(0)
        expect(b).toBeGreaterThanOrEqual(0)
        expect(a).toBeLessThan(sketch.nodes.length)
        expect(b).toBeLessThan(sketch.nodes.length)
        expect(a).not.toBe(b)
      }
      for (const node of sketch.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0)
        expect(node.x).toBeLessThanOrEqual(100)
        expect(node.y).toBeGreaterThanOrEqual(0)
        expect(node.y).toBeLessThanOrEqual(60)
      }
    }
  })

  it('all-to-all really is all-to-all: n(n-1)/2 edges', () => {
    const sketch = topologySketch('all-to-all')
    const n = sketch.nodes.length
    expect(sketch.edges.length).toBe((n * (n - 1)) / 2)
  })

  it('linear is a chain: n-1 edges, no branches', () => {
    const sketch = topologySketch('linear')
    expect(sketch.edges.length).toBe(sketch.nodes.length - 1)
  })

  it('heavy-hex keeps every qubit at degree three or less', () => {
    // The defining property of the family — it is why IBM transpilation
    // inserts SWAPs — so the sketch must not accidentally contradict it.
    const sketch = topologySketch('heavy-hex')
    const degree = new Array<number>(sketch.nodes.length).fill(0)
    for (const [a, b] of sketch.edges) {
      degree[a]! += 1
      degree[b]! += 1
    }
    expect(Math.max(...degree)).toBeLessThanOrEqual(3)
    expect(Math.min(...degree)).toBeGreaterThanOrEqual(1)
  })

  it('square lattice interior nodes have degree four', () => {
    const sketch = topologySketch('square-lattice')
    const degree = new Array<number>(sketch.nodes.length).fill(0)
    for (const [a, b] of sketch.edges) {
      degree[a]! += 1
      degree[b]! += 1
    }
    expect(Math.max(...degree)).toBe(4)
  })
})

describe('parseGateSequence', () => {
  // The shape qasm3.dumps actually emits for a transpiled Bell pair on the
  // u/cx fallback basis.
  const TRANSPILED_BELL = [
    'OPENQASM 3.0;',
    'include "stdgates.inc";',
    'bit[2] c;',
    'qubit[2] q;',
    'U(pi/2, 0, pi) q[0];',
    'cx q[0], q[1];',
    'c[0] = measure q[0];',
    'c[1] = measure q[1];',
  ].join('\n')

  it('reads gates, operand indices and measurements in order', () => {
    const parsed = parseGateSequence(TRANSPILED_BELL)
    expect(parsed.truncated).toBe(false)
    expect(parsed.entries).toEqual([
      { gate: 'u', qubits: [0] },
      { gate: 'cx', qubits: [0, 1] },
      { gate: 'measure', qubits: [0] },
      { gate: 'measure', qubits: [1] },
    ])
  })

  it('skips declarations, includes, comments and barriers without guessing', () => {
    const parsed = parseGateSequence(
      ['OPENQASM 3.0;', '// a comment', 'barrier q;', 'qubit[1] q;', 'x q[0];'].join('\n')
    )
    expect(parsed.entries).toEqual([{ gate: 'x', qubits: [0] }])
  })

  it('handles parameterised gates (rz, U) by keeping the name and dropping params', () => {
    const parsed = parseGateSequence('rz(-1.5707963267948966) q[3];')
    expect(parsed.entries).toEqual([{ gate: 'rz', qubits: [3] }])
  })

  it('caps and flags long circuits', () => {
    const long = Array.from({ length: 250 }, (_, i) => `x q[${i % 2}];`).join('\n')
    const parsed = parseGateSequence(long, 200)
    expect(parsed.entries.length).toBe(200)
    expect(parsed.truncated).toBe(true)
  })

  it('an empty or header-only program parses to an empty list', () => {
    expect(parseGateSequence('OPENQASM 3.0;\ninclude "stdgates.inc";').entries).toEqual([])
  })
})

describe('formatSequence', () => {
  it('collapses consecutive identical instructions into gate×n', () => {
    const lines = formatSequence([
      { gate: 'rz', qubits: [0] },
      { gate: 'rz', qubits: [0] },
      { gate: 'sx', qubits: [0] },
      { gate: 'cx', qubits: [0, 1] },
    ])
    expect(lines).toEqual(['rz q0 ×2', 'sx q0', 'cx q0,q1'])
  })

  it('does not collapse the same gate on different qubits', () => {
    const lines = formatSequence([
      { gate: 'x', qubits: [0] },
      { gate: 'x', qubits: [1] },
    ])
    expect(lines).toEqual(['x q0', 'x q1'])
  })
})
