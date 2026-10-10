/**
 * notebook.test.ts — the exported .ipynb must be a file Jupyter/Colab actually
 * opens, and the PennyLane variant must be the SAME circuit, gate for gate.
 *
 * These are string-level assertions on generated code on purpose: the builder
 * is a code generator, and the only contract that matters is the exact text a
 * Python kernel will execute. A mapping bug here (wrong gate name, dropped
 * angle, swapped control/target) produces a notebook that runs cleanly and
 * quietly computes a different circuit — the worst possible failure for a
 * learning product.
 */

import { describe, expect, it } from 'vitest'
import { toQasm, type Circuit } from '@/lib/quantum'
import {
  buildNotebook,
  buildPennylaneNotebook,
  buildQiskitNotebook,
  notebookFilename,
  pennylaneGateLine,
} from './notebook'

const BELL: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
  ],
}

// Angles chosen so one snaps to a pi fraction in QASM (pi/2) and one is a
// plain decimal — both paths of the angle serialiser show up in the output.
const ROTATIONS: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'RX', qubits: [0], theta: Math.PI / 2 },
    { name: 'RZ', qubits: [1], theta: 0.7 },
    { name: 'RX', qubits: [1], theta: 2.5 },
  ],
}

/** Joined source text of one cell by id — how a kernel would see it. */
function cellText(json: string, id: string): string {
  const nb = JSON.parse(json)
  const cell = nb.cells.find((c: { id: string }) => c.id === id)
  expect(cell, `cell "${id}" exists`).toBeDefined()
  return (cell.source as string[]).join('')
}

describe('notebook envelope (nbformat 4.5)', () => {
  const variants = [
    ['qiskit', buildQiskitNotebook(BELL)],
    ['pennylane', buildPennylaneNotebook(BELL)],
  ] as const

  it.each(variants)('%s output parses as JSON with correct nbformat fields', (_v, json) => {
    const nb = JSON.parse(json)
    expect(nb.nbformat).toBe(4)
    expect(nb.nbformat_minor).toBe(5)
    expect(Array.isArray(nb.cells)).toBe(true)
    expect(nb.cells.length).toBeGreaterThanOrEqual(4)
  })

  it.each(variants)('%s: every cell has a valid id and well-formed source', (_v, json) => {
    const nb = JSON.parse(json)
    const ids = new Set<string>()
    for (const cell of nb.cells) {
      // nbformat 4.5 requires ids; Colab rejects notebooks without them.
      expect(cell.id).toMatch(/^[a-zA-Z0-9\-_]{1,64}$/)
      expect(ids.has(cell.id)).toBe(false)
      ids.add(cell.id)
      expect(Array.isArray(cell.source)).toBe(true)
      if (cell.cell_type === 'code') {
        expect(cell.execution_count).toBeNull()
        expect(cell.outputs).toEqual([])
      }
    }
  })

  it.each(variants)('%s: markdown provenance cell says exported from Qubit16', (_v, json) => {
    expect(cellText(json, 'provenance')).toContain('Exported from [Qubit16]')
  })

  it('buildNotebook dispatches by variant', () => {
    expect(buildNotebook(BELL, 'qiskit')).toBe(buildQiskitNotebook(BELL))
    expect(buildNotebook(BELL, 'pennylane')).toBe(buildPennylaneNotebook(BELL))
  })

  it('is deterministic — same circuit, byte-identical file', () => {
    expect(buildQiskitNotebook(BELL)).toBe(buildQiskitNotebook(BELL))
  })
})

describe('qiskit variant', () => {
  it('embeds the QASM verbatim in both the markdown and the load cell', () => {
    for (const circuit of [BELL, ROTATIONS]) {
      const qasm = toQasm(circuit)
      const json = buildQiskitNotebook(circuit)
      expect(cellText(json, 'provenance')).toContain(qasm)
      expect(cellText(json, 'load-circuit')).toContain(qasm)
      // Verbatim also means it survives JSON round-tripping intact, which the
      // cellText JSON.parse above already forced.
    }
  })

  it('loads via qasm3.loads and installs the importer extra it needs', () => {
    const json = buildQiskitNotebook(BELL)
    expect(cellText(json, 'load-circuit')).toContain('qasm3.loads(QASM)')
    expect(cellText(json, 'install')).toContain('qiskit[qasm3-import')
    expect(cellText(json, 'install')).toContain('qiskit-aer')
  })

  it('runs AerSimulator with a StatevectorSampler fallback reading register c', () => {
    const run = cellText(buildQiskitNotebook(BELL), 'run')
    expect(run).toContain('from qiskit_aer import AerSimulator')
    expect(run).toContain('except ImportError')
    expect(run).toContain('from qiskit.primitives import StatevectorSampler')
    // V2 pub-based result; "c" is the register name toQasm emits.
    expect(run).toContain('job.result()[0].data.c.get_counts()')
  })

  it('has a plot cell using plot_histogram', () => {
    expect(cellText(buildQiskitNotebook(BELL), 'plot')).toContain('plot_histogram(counts)')
  })
})

describe('pennylane variant', () => {
  it('maps every gate of the Bell circuit, in order', () => {
    const cell = cellText(buildPennylaneNotebook(BELL), 'build-circuit')
    const h = cell.indexOf('qml.Hadamard(wires=0)')
    const cx = cell.indexOf('qml.CNOT(wires=[0, 1])')
    expect(h).toBeGreaterThan(-1)
    expect(cx).toBeGreaterThan(h)
    expect(cell).toContain('num_wires = 2')
  })

  it('maps a 3-gate RX/RZ circuit with exact full-precision angles, in order', () => {
    const cell = cellText(buildPennylaneNotebook(ROTATIONS), 'build-circuit')
    const rx0 = cell.indexOf(`qml.RX(${Math.PI / 2}, wires=0)`)
    const rz1 = cell.indexOf('qml.RZ(0.7, wires=1)')
    const rx1 = cell.indexOf('qml.RX(2.5, wires=1)')
    expect(rx0).toBeGreaterThan(-1)
    expect(rz1).toBeGreaterThan(rx0)
    expect(rx1).toBeGreaterThan(rz1)
  })

  it('measures with reversed wire order so labels match Qubit16/Qiskit', () => {
    const cell = cellText(buildPennylaneNotebook(BELL), 'build-circuit')
    expect(cell).toContain('qml.counts(wires=list(range(num_wires))[::-1])')
  })

  it('still shows the QASM in the provenance cell for reference', () => {
    expect(cellText(buildPennylaneNotebook(BELL), 'provenance')).toContain(toQasm(BELL))
  })

  it('pennylaneGateLine covers the whole gate library', () => {
    expect(pennylaneGateLine({ name: 'H', qubits: [3] })).toBe('qml.Hadamard(wires=3)')
    expect(pennylaneGateLine({ name: 'X', qubits: [0] })).toBe('qml.PauliX(wires=0)')
    expect(pennylaneGateLine({ name: 'Y', qubits: [0] })).toBe('qml.PauliY(wires=0)')
    expect(pennylaneGateLine({ name: 'Z', qubits: [0] })).toBe('qml.PauliZ(wires=0)')
    expect(pennylaneGateLine({ name: 'S', qubits: [1] })).toBe('qml.S(wires=1)')
    expect(pennylaneGateLine({ name: 'SDG', qubits: [1] })).toBe('qml.adjoint(qml.S)(wires=1)')
    expect(pennylaneGateLine({ name: 'T', qubits: [1] })).toBe('qml.T(wires=1)')
    expect(pennylaneGateLine({ name: 'TDG', qubits: [1] })).toBe('qml.adjoint(qml.T)(wires=1)')
    expect(pennylaneGateLine({ name: 'P', qubits: [0], theta: 0.25 })).toBe(
      'qml.PhaseShift(0.25, wires=0)'
    )
    expect(pennylaneGateLine({ name: 'RY', qubits: [2], theta: 1.5 })).toBe(
      'qml.RY(1.5, wires=2)'
    )
    // Two-qubit gates keep [control, target] order — swapping them is the
    // silent-wrong-circuit bug this suite exists to catch.
    expect(pennylaneGateLine({ name: 'CX', qubits: [2, 0] })).toBe('qml.CNOT(wires=[2, 0])')
    expect(pennylaneGateLine({ name: 'CY', qubits: [1, 2] })).toBe('qml.CY(wires=[1, 2])')
    expect(pennylaneGateLine({ name: 'CZ', qubits: [0, 1] })).toBe('qml.CZ(wires=[0, 1])')
    expect(pennylaneGateLine({ name: 'SWAP', qubits: [0, 2] })).toBe('qml.SWAP(wires=[0, 2])')
    expect(pennylaneGateLine({ name: 'CCX', qubits: [0, 1, 2] })).toBe(
      'qml.Toffoli(wires=[0, 1, 2])'
    )
    // No gate equivalent — measurement is the qnode's return in PennyLane.
    expect(pennylaneGateLine({ name: 'MEASURE', qubits: [0] })).toBeNull()
    expect(pennylaneGateLine({ name: 'BARRIER', qubits: [0] })).toBeNull()
  })

  it('an empty circuit still generates a runnable qnode body', () => {
    const cell = cellText(
      buildPennylaneNotebook({ numQubits: 1, ops: [] }),
      'build-circuit'
    )
    expect(cell).toContain('pass  # empty circuit')
  })
})

describe('notebookFilename', () => {
  it('slugifies and appends the variant', () => {
    expect(notebookFilename('Bell State (Φ+)', 'qiskit')).toBe('bell-state.qiskit.ipynb')
    expect(notebookFilename('My Circuit!', 'pennylane')).toBe('my-circuit.pennylane.ipynb')
    expect(notebookFilename('***', 'qiskit')).toBe('circuit.qiskit.ipynb')
  })
})
