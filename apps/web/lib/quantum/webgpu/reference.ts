/**
 * reference.ts — the statevector kernels in plain TypeScript.
 *
 * One function per WGSL kernel in kernels.ts, written against the same index
 * maths (indexing.ts) and the same work-item enumeration: the reference walks
 * k over [0, items) exactly as the GPU's invocations do, and maps k to an
 * amplitude index with the same calls. That is what makes a Node test of this
 * file a test of the shader's addressing. The only thing it cannot test is
 * float32 rounding, which the workbench page measures at runtime instead.
 *
 * These functions are also what CpuBackend (lib/quantum/backend.ts) runs when
 * a circuit is wider than the 16-qubit StateVector ceiling, so they are typed
 * over any Float32Array or Float64Array of interleaved [re, im] pairs.
 */

import type { Matrix2x2 } from '@/lib/quantum'
import {
  assertQubit,
  controlMask,
  pairLower,
  passesMask,
  swapLower,
  workItems,
} from './indexing'

export type AmplitudeArray = Float32Array | Float64Array

/** Statevector dimension implied by an interleaved amplitude array. */
export function dimOf(data: AmplitudeArray): number {
  return data.length >>> 1
}

/**
 * Apply a 2×2 matrix to every pair on `target`, restricted to pairs whose
 * control bits are all set. `mask` 0 means unconditioned.
 *
 * Mirrors kernels.ts `gateKernel`: for k in [0, dim/2), i = pairLower(k), skip
 * unless i passes the mask, j = i | tbit, (a, b) ← M · (a, b).
 */
export function applyGateRef(
  data: AmplitudeArray,
  numQubits: number,
  matrix: Matrix2x2,
  target: number,
  mask = 0,
): void {
  assertQubit(target, numQubits, 'target qubit')
  const dim = dimOf(data)
  const [m00, m01, m10, m11] = matrix
  const tbit = 1 << target
  const items = workItems.gate(dim)
  for (let k = 0; k < items; k++) {
    const i = pairLower(k, target)
    if (!passesMask(i, mask)) continue
    const j = i | tbit
    const ar = data[2 * i], ai = data[2 * i + 1]
    const br = data[2 * j], bi = data[2 * j + 1]
    // (m00·a + m01·b), (m10·a + m11·b) with complex products written out —
    // the same six multiplies per output the WGSL cmul() performs.
    data[2 * i]     = m00.re * ar - m00.im * ai + m01.re * br - m01.im * bi
    data[2 * i + 1] = m00.re * ai + m00.im * ar + m01.re * bi + m01.im * br
    data[2 * j]     = m10.re * ar - m10.im * ai + m11.re * br - m11.im * bi
    data[2 * j + 1] = m10.re * ai + m10.im * ar + m11.re * bi + m11.im * br
  }
}

/** applyGateRef with the control list validated and turned into a mask. */
export function applyControlledRef(
  data: AmplitudeArray,
  numQubits: number,
  matrix: Matrix2x2,
  controls: readonly number[],
  target: number,
): void {
  assertQubit(target, numQubits, 'target qubit')
  applyGateRef(data, numQubits, matrix, target, controlMask(controls, target, numQubits))
}

/**
 * Exchange qubits a and b. Mirrors kernels.ts `swapKernel`: for k in
 * [0, dim/4), i = swapLower(k, a, b), j = i ^ abit ^ bbit, swap.
 */
export function applySwapRef(data: AmplitudeArray, numQubits: number, a: number, b: number): void {
  assertQubit(a, numQubits)
  assertQubit(b, numQubits)
  if (a === b) return
  const dim = dimOf(data)
  const flip = (1 << a) | (1 << b)
  const items = workItems.swap(dim)
  for (let k = 0; k < items; k++) {
    const i = swapLower(k, a, b)
    const j = (i ^ flip) >>> 0
    const r = data[2 * i], im = data[2 * i + 1]
    data[2 * i] = data[2 * j]; data[2 * i + 1] = data[2 * j + 1]
    data[2 * j] = r; data[2 * j + 1] = im
  }
}

/** |a_i|² for every i. Mirrors `probabilityKernel`. */
export function probabilitiesRef(data: AmplitudeArray, out?: Float64Array): Float64Array {
  const dim = dimOf(data)
  const p = out ?? new Float64Array(dim)
  for (let i = 0; i < dim; i++) {
    const re = data[2 * i], im = data[2 * i + 1]
    p[i] = re * re + im * im
  }
  return p
}

/** Marginal probability that `target` reads 1. Mirrors `marginalKernel` + the host-side sum of its partials. */
export function marginalRef(data: AmplitudeArray, numQubits: number, target: number): number {
  assertQubit(target, numQubits)
  const dim = dimOf(data)
  let p = 0
  for (let i = 0; i < dim; i++) {
    if ((i >> target) & 1) {
      const re = data[2 * i], im = data[2 * i + 1]
      p += re * re + im * im
    }
  }
  return p
}

/**
 * Project `target` onto `outcome` and renormalise by 1/√p. Mirrors
 * `collapseKernel`. Throws on an impossible outcome, as StateVector does.
 */
export function collapseRef(
  data: AmplitudeArray,
  numQubits: number,
  target: number,
  outcome: 0 | 1,
  p1 = marginalRef(data, numQubits, target),
): void {
  const p = outcome === 1 ? p1 : 1 - p1
  if (!(p > 1e-12)) {
    throw new Error(`qubit ${target} cannot collapse to ${outcome}: that outcome has probability ${p.toExponential(2)}`)
  }
  const dim = dimOf(data)
  const scale = 1 / Math.sqrt(p)
  for (let i = 0; i < dim; i++) {
    const isOne = ((i >> target) & 1) === 1
    if ((outcome === 1) !== isOne) {
      data[2 * i] = 0; data[2 * i + 1] = 0
    } else {
      data[2 * i] *= scale; data[2 * i + 1] *= scale
    }
  }
}

export interface BasisState {
  index: number
  probability: number
}

/**
 * The k most probable basis states, highest first; ties broken by lower index.
 * Exact, by a full scan — the GPU version (blockMaxKernel) narrows to blocks
 * first and is proved exact in WebGpuBackend's comment.
 */
export function topStatesRef(data: AmplitudeArray, k: number): BasisState[] {
  const dim = dimOf(data)
  const want = Math.max(0, Math.min(k, dim))
  const top: BasisState[] = []
  if (want === 0) return top
  for (let i = 0; i < dim; i++) {
    const re = data[2 * i], im = data[2 * i + 1]
    const probability = re * re + im * im
    if (top.length === want && probability <= top[want - 1].probability) continue
    // Insertion keeps `top` sorted; k is tiny so this beats sorting dim entries.
    let pos = top.length
    while (pos > 0 && top[pos - 1].probability < probability) pos--
    top.splice(pos, 0, { index: i, probability })
    if (top.length > want) top.pop()
  }
  return top
}

/** Largest |Δre|, |Δim| between two amplitude arrays of the same dimension. */
export function maxAmplitudeDeviation(a: AmplitudeArray, b: AmplitudeArray): number {
  if (a.length !== b.length) throw new Error(`amplitude arrays differ in length: ${a.length} vs ${b.length}`)
  let max = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > max) max = d
  }
  return max
}
