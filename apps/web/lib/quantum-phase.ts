/**
 * quantum-phase.ts — per-qubit phase-disk numbers from a statevector.
 *
 * The phase-disk strip (IBM Composer's widget) shows three numbers per qubit,
 * all read off the qubit's reduced density matrix ρ. For qubit q with bit mask
 * b = 1 << q, pair up basis states i (bit clear) and j = i | b (bit set):
 *
 *   ρ00 = Σ |a_i|²          probability the qubit reads 0
 *   ρ11 = Σ |a_j|²          probability the qubit reads 1  → p1
 *   ρ01 = Σ a_i · conj(a_j) coherence between |0⟩ and |1⟩
 *
 * (the sums trace out every other qubit — they run over all pairs.)
 *
 * phase = arg(ρ10) = −arg(ρ01). This is the relative phase carried by the
 * |1⟩ component: for (|0⟩ + e^{iφ}|1⟩)/√2, ρ10 = e^{iφ}/2, so phase = φ.
 * Using ρ01 instead would negate it — T|+⟩ would read −π/4, not π/4.
 *
 * purity = Tr(ρ²) = ρ00² + ρ11² + 2|ρ01|². 1 for a qubit in a pure
 * (unentangled) state, ½ for a maximally mixed one — each qubit of a Bell
 * pair. It is the disk's "how much of this qubit is really here" ring.
 *
 * Edge case: when |ρ01| = 0 (basis states, or a fully mixed qubit) the phase
 * is undefined; atan2(0, 0) returns 0 and we keep that — the needle rests at
 * zero rather than jumping around on float noise.
 *
 * Pure math, no DOM: quantum-phase.test.ts pins the three canonical states.
 * components/circuit/PhaseDiskStrip.tsx is the rendering side.
 */

import { type StateVector } from './quantum'

export interface QubitPhaseInfo {
  /** Probability this qubit reads 1. In [0, 1]. */
  p1: number
  /** Relative phase of the |1⟩ component, arg(ρ10), in (−π, π]. */
  phase: number
  /** Tr(ρ²) of the reduced state. 1 = pure/separable, 0.5 = maximally mixed. */
  purity: number
}

/** Reduced-state {p1, phase, purity} for a single qubit of `sv`. */
export function qubitPhaseInfo(sv: StateVector, q: number): QubitPhaseInfo {
  if (!Number.isInteger(q) || q < 0 || q >= sv.numQubits) {
    // Same contract as StateVector's own guards: a bad index must not read
    // past the Float64Array and come back as NaN dressed up as physics.
    throw new Error(`qubit index ${q} is out of range for a ${sv.numQubits}-qubit state`)
  }
  const bit = 1 << q
  let r00 = 0
  let r11 = 0
  let r01re = 0
  let r01im = 0
  for (let i = 0; i < sv.dim; i++) {
    if (i & bit) continue
    const j = i | bit
    const are = sv.data[2 * i], aim = sv.data[2 * i + 1]
    const bre = sv.data[2 * j], bim = sv.data[2 * j + 1]
    r00 += are * are + aim * aim
    r11 += bre * bre + bim * bim
    // a · conj(b)
    r01re += are * bre + aim * bim
    r01im += aim * bre - are * bim
  }
  return {
    p1: r11,
    // ρ10 = conj(ρ01), so arg(ρ10) = atan2(−Im ρ01, Re ρ01). The `+ 0`
    // normalises atan2(-0, 0) = -0 to 0 so "no phase" is one value, not two.
    phase: Math.atan2(-r01im, r01re) + 0,
    purity: r00 * r00 + r11 * r11 + 2 * (r01re * r01re + r01im * r01im),
  }
}

/** Phase-disk numbers for every qubit, index 0 first (LSB-first, as everywhere). */
export function allQubitPhaseInfo(sv: StateVector): QubitPhaseInfo[] {
  return Array.from({ length: sv.numQubits }, (_, q) => qubitPhaseInfo(sv, q))
}
