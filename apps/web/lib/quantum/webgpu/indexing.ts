/**
 * indexing.ts — the index arithmetic every statevector kernel is built on.
 *
 * A single-qubit gate on qubit t touches amplitude PAIRS (i, i | 1<<t) where
 * bit t of i is 0. A controlled gate touches the subset of those pairs whose
 * control bits are all 1. SWAP(a, b) exchanges amplitudes (i, i ^ abit ^ bbit)
 * where bit a and bit b of i differ. Every kernel — the WGSL compute shaders in
 * kernels.ts, the float64 reference in reference.ts, and CpuBackend — enumerates
 * its work items with a dense counter k and maps k to an amplitude index with
 * the functions below. The WGSL is generated from the SAME formulas (kernels.ts
 * quotes them line for line), so the tests here, which run in Node with no GPU,
 * are the tests of the shader's index maths.
 *
 * Conventions are lib/quantum.ts's: qubit 0 is the least significant bit; a
 * basis index i has qubit q set when (i >> q) & 1 === 1.
 *
 * All arithmetic is on non-negative 32-bit integers. `>>> 0` keeps JavaScript
 * from reinterpreting bit 31 as a sign, which matters for nothing this site
 * simulates (statevectors stop at 2^30 amplitudes long before that) but is
 * correct rather than merely adequate.
 */

/** Invocations per workgroup for every kernel. A power of two; 256 is the WebGPU default maximum in the X dimension on every tier. */
export const WORKGROUP_SIZE = 256

/** WebGPU's guaranteed `maxComputeWorkgroupsPerDimension`. Anything above this dispatches in 2-D. */
export const MAX_WORKGROUPS_PER_DIM = 65535

/** Statevector dimension for n qubits. */
export function dimension(numQubits: number): number {
  if (!Number.isInteger(numQubits) || numQubits < 1 || numQubits > 30) {
    throw new Error(`numQubits must be an integer between 1 and 30, got ${numQubits}`)
  }
  return 2 ** numQubits
}

/**
 * Insert one bit of value `value` at position `pos`, shifting the bits of `k`
 * at and above `pos` up by one. insertBit(0b101, 1, 0) === 0b1001.
 */
export function insertBit(k: number, pos: number, value: 0 | 1): number {
  const low = (1 << pos) - 1
  return ((((k & ~low) << 1) | (value << pos) | (k & low)) >>> 0)
}

/**
 * The lower index of pair number k for a gate on `target`: k with a 0 bit
 * inserted at the target position. The partner is `pairLower | (1 << target)`.
 * k runs over [0, dim / 2).
 */
export function pairLower(k: number, target: number): number {
  return insertBit(k, target, 0)
}

/** Bitmask with every control qubit set. Validates the control list. */
export function controlMask(controls: readonly number[], target: number, numQubits: number): number {
  let mask = 0
  const seen = new Set<number>()
  for (const q of controls) {
    assertQubit(q, numQubits, 'control qubit')
    if (q === target) throw new Error(`control qubit ${q} cannot also be the target`)
    if (seen.has(q)) throw new Error(`control qubit ${q} is listed twice`)
    seen.add(q)
    mask |= 1 << q
  }
  return mask >>> 0
}

/** True when every bit of `mask` is set in `i`. With mask 0 every index passes. */
export function passesMask(i: number, mask: number): boolean {
  return ((i & mask) >>> 0) === mask
}

/**
 * The index with bit a = 0 and bit b = 1 for swap-pair number k. Its partner
 * is `i ^ (1 << a) ^ (1 << b)`, which has a = 1 and b = 0. k runs over
 * [0, dim / 4). Requires a !== b.
 */
export function swapLower(k: number, a: number, b: number): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  // Insert at the lower position first: once it is in place, the higher
  // position still refers to the same bit slot in the widened number.
  const withLo = insertBit(k, lo, lo === b ? 1 : 0)
  return insertBit(withLo, hi, hi === b ? 1 : 0)
}

/** Count of work items for each kernel family. */
export const workItems = {
  gate: (dim: number) => dim >>> 1,
  swap: (dim: number) => dim >>> 2,
  elementwise: (dim: number) => dim,
} as const

export interface Dispatch {
  /** Workgroups along x. ≤ MAX_WORKGROUPS_PER_DIM. */
  x: number
  /** Workgroups along y. 1 unless x hit the limit. */
  y: number
  /** Total workgroups, x * y ≥ ceil(items / workgroupSize). */
  groups: number
}

/**
 * How to dispatch `items` invocations in workgroups of `workgroupSize`.
 *
 * A 26-qubit gate has 2^25 pairs = 131072 workgroups of 256, past the 65535
 * per-dimension limit, so the grid is folded into 2-D. A shader linearises
 * `(workgroup_id.y, global_invocation_id.x)` with linearIndex(); the trailing
 * invocations past `items` are masked in the shader.
 */
export function dispatchFor(
  items: number,
  workgroupSize = WORKGROUP_SIZE,
  maxPerDim = MAX_WORKGROUPS_PER_DIM,
): Dispatch {
  if (!Number.isInteger(items) || items < 0) throw new Error(`items must be a non-negative integer, got ${items}`)
  const groups = Math.max(1, Math.ceil(items / workgroupSize))
  if (groups <= maxPerDim) return { x: groups, y: 1, groups }
  const x = maxPerDim
  const y = Math.ceil(groups / x)
  if (y > maxPerDim) throw new Error(`${items} items need more workgroups than a 2-D dispatch allows`)
  return { x, y, groups }
}

/**
 * Work-item number of an invocation in a (possibly 2-D) dispatch — the same
 * formula the WGSL uses:  k = global_id.x + workgroup_id.y * (xGroups * WG).
 */
export function linearIndex(globalX: number, workgroupY: number, xGroups: number, workgroupSize = WORKGROUP_SIZE): number {
  return globalX + workgroupY * xGroups * workgroupSize
}

export function assertQubit(q: number, numQubits: number, role = 'qubit'): void {
  if (!Number.isInteger(q) || q < 0 || q >= numQubits) {
    throw new Error(`${role} index ${q} is out of range for a ${numQubits}-qubit state`)
  }
}
