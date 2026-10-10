/**
 * blochGates.ts — the single-qubit gates as rotations of the Bloch vector.
 *
 * Pure, dependency-free, and the thing components/ui/HeroQubit.tsx animates.
 * A gate U acts on the Bloch vector as a rotation: angle θ about a unit axis
 * k. The table below is the textbook one — H is a half turn about (x+z)/√2,
 * X/Y/Z are half turns about their own axes, S is a quarter turn about z —
 * and blochGates.test.ts pins the results a physicist would check first.
 */

export type Vec3 = [number, number, number]

export interface BlochGate {
  id: 'H' | 'X' | 'Y' | 'Z' | 'S'
  axis: Vec3
  angle: number
}

const SQRT1_2 = Math.SQRT1_2

export const BLOCH_GATES: Record<BlochGate['id'], BlochGate> = {
  H: { id: 'H', axis: [SQRT1_2, 0, SQRT1_2], angle: Math.PI },
  X: { id: 'X', axis: [1, 0, 0], angle: Math.PI },
  Y: { id: 'Y', axis: [0, 1, 0], angle: Math.PI },
  Z: { id: 'Z', axis: [0, 0, 1], angle: Math.PI },
  S: { id: 'S', axis: [0, 0, 1], angle: Math.PI / 2 },
}

/** Rodrigues' rotation of v by `angle` about the unit axis k. */
export function rotate(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]
  const cross: Vec3 = [
    k[1] * v[2] - k[2] * v[1],
    k[2] * v[0] - k[0] * v[2],
    k[0] * v[1] - k[1] * v[0],
  ]
  return [
    v[0] * c + cross[0] * s + k[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + k[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + k[2] * dot * (1 - c),
  ]
}

export function applyGate(v: Vec3, gate: BlochGate): Vec3 {
  return rotate(v, gate.axis, gate.angle)
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** Probability of measuring 1 for a Bloch vector: (1 − z) / 2. */
export function probabilityOfOne(v: Vec3): number {
  return Math.min(1, Math.max(0, (1 - v[2]) / 2))
}

/** |0⟩ is the north pole. */
export const KET_ZERO: Vec3 = [0, 0, 1]
export const KET_ONE: Vec3 = [0, 0, -1]
