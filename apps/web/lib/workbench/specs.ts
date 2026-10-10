/**
 * lib/workbench/specs.ts — the spec presets the /workbench/generate page
 * offers, as data. Each one is a complete CircuitSpec a developer can run
 * as-is or edit. They double as the fixtures the tests verify hand-computed
 * circuits against, so a preset that is wrong fails a test before it ships.
 */

import type { CircuitSpec } from './verify'

export interface SpecPreset {
  id: string
  label: string
  spec: CircuitSpec
}

export const SPEC_PRESETS: readonly SpecPreset[] = [
  {
    id: 'bell',
    label: 'Bell pair',
    spec: {
      name: 'Bell pair Φ+',
      description: 'Two qubits that always agree: half the shots read 00, half read 11, never 01 or 10.',
      numQubits: 2,
      target: { kind: 'distribution', probabilities: { '00': 0.5, '11': 0.5 }, tolerance: 0.02 },
      constraints: { maxGates: 4 },
    },
  },
  {
    id: 'ghz',
    label: 'GHZ (3 qubits)',
    spec: {
      name: 'GHZ state',
      description: 'Three-way agreement: 000 or 111, nothing else.',
      numQubits: 3,
      target: { kind: 'distribution', probabilities: { '000': 0.5, '111': 0.5 }, tolerance: 0.02 },
      constraints: { maxGates: 5, allowedGates: ['H', 'CX'] },
    },
  },
  {
    id: 'uniform',
    label: 'Uniform (3 qubits)',
    spec: {
      name: 'Uniform superposition',
      description: 'Every one of the eight basis states equally likely.',
      numQubits: 3,
      target: {
        kind: 'distribution',
        probabilities: Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [i.toString(2).padStart(3, '0'), 0.125]),
        ),
        tolerance: 0.01,
      },
      constraints: { maxDepth: 1 },
    },
  },
  {
    id: 'swap-from-cx',
    label: 'SWAP from CX',
    spec: {
      name: 'SWAP using only CX',
      description: 'Implement the two-qubit SWAP unitary without using the SWAP gate.',
      numQubits: 2,
      target: {
        kind: 'unitary',
        matrix: [
          [1, 0, 0, 0],
          [0, 0, 1, 0],
          [0, 1, 0, 0],
          [0, 0, 0, 1],
        ],
      },
      constraints: { allowedGates: ['CX'], maxGates: 3 },
    },
  },
  {
    id: 'plus-minus',
    label: '|+⟩ ⊗ |−⟩ state',
    spec: {
      name: 'Product state |−⟩|+⟩',
      description:
        'q[0] in |+⟩ and q[1] in |−⟩. The histogram alone would accept |+⟩|+⟩; this spec checks the relative phase too.',
      numQubits: 2,
      // Index bit k = q[k]: |q1 q0⟩. |−⟩ on q1 puts a minus sign on indices with bit 1 set (2 and 3).
      target: { kind: 'statevector', amplitudes: [0.5, 0.5, -0.5, -0.5] },
      constraints: { maxGates: 4 },
    },
  },
  {
    id: 'custom',
    label: 'Custom distribution',
    spec: {
      name: 'Skewed two-qubit distribution',
      description: 'A distribution no single Hadamard gives. Rotations will be needed.',
      numQubits: 2,
      target: {
        kind: 'distribution',
        probabilities: { '00': 0.25, '01': 0.25, '10': 0.5 },
        tolerance: 0.03,
      },
    },
  },
]

export function presetById(id: string): SpecPreset | undefined {
  return SPEC_PRESETS.find((p) => p.id === id)
}
