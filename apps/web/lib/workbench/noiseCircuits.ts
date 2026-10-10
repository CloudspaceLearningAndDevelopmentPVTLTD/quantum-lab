/**
 * lib/workbench/noiseCircuits.ts — the circuits /workbench/noise lets you pick.
 *
 * Each preset is a family indexed by `depth` so the page can draw "fidelity vs
 * depth" for the SAME circuit the ZNE panel is measuring. `depth` is the number
 * of repeated blocks, not the layer count; `circuitDepth` from the noise module
 * gives the scheduled layers if you want those.
 *
 * Observables are chosen so the ideal value is non-trivial and known: a Bell
 * pair's ⟨ZZ⟩ is 1, an odd number of X gates gives ⟨Z⟩ = −1, any GHZ pair
 * parity is 1 (the triple parity averages to 0, so it is not offered), and the
 * RY ladder's ⟨Z₂⟩ at depth 1 is cos³θ. The tests check those against the
 * statevector engine.
 */

import type { Circuit, GateOp } from '@/lib/quantum'
import type { Observable } from '@/lib/quantum/noise'

export type PresetId = 'bell' | 'ghz' | 'xchain' | 'ladder' | 'grover2' | 'idle'

export interface CircuitPreset {
  id: PresetId
  label: string
  /** What the reader is looking at, one sentence. */
  blurb: string
  numQubits: number
  /** Whether `depth` changes the circuit. */
  hasDepth: boolean
  minDepth: number
  maxDepth: number
  defaultDepth: number
  observables: { id: string; label: string; obs: Observable }[]
  build: (depth: number) => Circuit
}

const bellOps = (): GateOp[] => [
  { name: 'H', qubits: [0] },
  { name: 'CX', qubits: [0, 1] },
]

/** The RY ladder: RY(θ) on every qubit then a CX chain, repeated `depth` times. */
function ladder(numQubits: number, depth: number, theta: number): GateOp[] {
  const ops: GateOp[] = []
  for (let d = 0; d < depth; d++) {
    for (let q = 0; q < numQubits; q++) ops.push({ name: 'RY', qubits: [q], theta })
    for (let q = 0; q + 1 < numQubits; q++) ops.push({ name: 'CX', qubits: [q, q + 1] })
  }
  return ops
}

/** Two-qubit Grover with |11⟩ marked: one iteration is exact. */
function grover2(): GateOp[] {
  return [
    { name: 'H', qubits: [0] },
    { name: 'H', qubits: [1] },
    // Oracle: phase-flip |11⟩.
    { name: 'CZ', qubits: [0, 1] },
    // Diffusion.
    { name: 'H', qubits: [0] },
    { name: 'H', qubits: [1] },
    { name: 'X', qubits: [0] },
    { name: 'X', qubits: [1] },
    { name: 'CZ', qubits: [0, 1] },
    { name: 'X', qubits: [0] },
    { name: 'X', qubits: [1] },
    { name: 'H', qubits: [0] },
    { name: 'H', qubits: [1] },
  ]
}

export const PRESETS: readonly CircuitPreset[] = [
  {
    id: 'bell',
    label: 'Bell pair',
    blurb: 'H then CX. Depth repeats the pair: an even count is the identity, an odd count is a Bell pair.',
    numQubits: 2,
    hasDepth: true,
    minDepth: 1,
    maxDepth: 9,
    defaultDepth: 1,
    observables: [
      { id: 'zz', label: '⟨Z₀Z₁⟩ parity', obs: { type: 'pauliZ', qubits: [0, 1] } },
      { id: 'p11', label: 'P(|11⟩)', obs: { type: 'projector', index: 3 } },
    ],
    build: (depth) => {
      const ops: GateOp[] = []
      for (let d = 0; d < depth; d++) ops.push(...(d % 2 === 0 ? bellOps() : bellOps().reverse()))
      return { numQubits: 2, ops }
    },
  },
  {
    id: 'ghz',
    label: 'GHZ on 3 qubits',
    blurb: 'H, CX, CX. Depth repeats the block the same way as the Bell pair.',
    numQubits: 3,
    hasDepth: true,
    minDepth: 1,
    maxDepth: 7,
    defaultDepth: 1,
    observables: [
      { id: 'z01', label: '⟨Z₀Z₁⟩', obs: { type: 'pauliZ', qubits: [0, 1] } },
      { id: 'z12', label: '⟨Z₁Z₂⟩', obs: { type: 'pauliZ', qubits: [1, 2] } },
      { id: 'p000', label: 'P(|000⟩)', obs: { type: 'projector', index: 0 } },
    ],
    build: (depth) => {
      const block: GateOp[] = [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'CX', qubits: [1, 2] },
      ]
      const ops: GateOp[] = []
      for (let d = 0; d < depth; d++) ops.push(...(d % 2 === 0 ? block : block.slice().reverse()))
      return { numQubits: 3, ops }
    },
  },
  {
    id: 'xchain',
    label: 'X chain',
    blurb: 'depth X gates in a row on one qubit. Only single-qubit depolarising touches it.',
    numQubits: 1,
    hasDepth: true,
    minDepth: 1,
    maxDepth: 25,
    defaultDepth: 5,
    observables: [{ id: 'z', label: '⟨Z₀⟩', obs: { type: 'pauliZ', qubits: [0] } }],
    build: (depth) => ({
      numQubits: 1,
      ops: Array.from({ length: depth }, (): GateOp => ({ name: 'X', qubits: [0] })),
    }),
  },
  {
    id: 'ladder',
    label: 'RY ladder, 3 qubits',
    blurb: 'RY(π/7) on every qubit then a CX chain, repeated depth times. The kind of block a variational circuit is made of.',
    numQubits: 3,
    hasDepth: true,
    minDepth: 1,
    maxDepth: 8,
    defaultDepth: 3,
    observables: [
      { id: 'z2', label: '⟨Z₂⟩', obs: { type: 'pauliZ', qubits: [2] } },
      { id: 'zzz', label: '⟨Z₀Z₁Z₂⟩', obs: { type: 'pauliZ', qubits: [0, 1, 2] } },
      { id: 'p000', label: 'P(|000⟩)', obs: { type: 'projector', index: 0 } },
    ],
    build: (depth) => ({ numQubits: 3, ops: ladder(3, depth, Math.PI / 7) }),
  },
  {
    id: 'grover2',
    label: 'Grover, 2 qubits',
    blurb: 'One Grover iteration marking |11⟩ — ideally it is found with certainty.',
    numQubits: 2,
    hasDepth: false,
    minDepth: 1,
    maxDepth: 1,
    defaultDepth: 1,
    observables: [
      { id: 'p11', label: 'P(|11⟩)', obs: { type: 'projector', index: 3 } },
      { id: 'zz', label: '⟨Z₀Z₁⟩', obs: { type: 'pauliZ', qubits: [0, 1] } },
    ],
    build: () => ({ numQubits: 2, ops: grover2() }),
  },
  {
    id: 'idle',
    label: 'Idle |1⟩ (T1 probe)',
    blurb: 'X, then depth idle steps. Nothing but T1 and T2 act; ⟨Z₀⟩ should follow 1 − 2e^(−t/T1), from −1 towards +1.',
    numQubits: 1,
    hasDepth: true,
    minDepth: 0,
    maxDepth: 30,
    defaultDepth: 8,
    observables: [
      { id: 'p1', label: 'P(|1⟩)', obs: { type: 'projector', index: 1 } },
      { id: 'z', label: '⟨Z₀⟩', obs: { type: 'pauliZ', qubits: [0] } },
    ],
    build: (depth) => ({
      numQubits: 1,
      ops: [
        { name: 'X', qubits: [0] },
        ...Array.from({ length: depth }, (): GateOp => ({ name: 'BARRIER', qubits: [] })),
      ],
    }),
  },
]

export const PRESET_BY_ID: Record<PresetId, CircuitPreset> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p])
) as Record<PresetId, CircuitPreset>

/** Unitary gate count (MEASURE and BARRIER excluded). */
export function gateCount(circuit: Circuit): number {
  return circuit.ops.filter((o) => o.name !== 'BARRIER' && o.name !== 'MEASURE').length
}
