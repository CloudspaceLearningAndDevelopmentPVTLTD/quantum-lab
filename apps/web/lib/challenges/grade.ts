/**
 * grade.ts — the verdict.
 *
 * ─────────────────────────────────────────────────────────────
 * THE CLASSIC GRADING BUG, AND WHY THIS FILE AVOIDS IT
 * ─────────────────────────────────────────────────────────────
 * Two statevectors that differ only by a GLOBAL PHASE are the same physical
 * state. |ψ⟩ and e^{iφ}|ψ⟩ are indistinguishable by any measurement whatsoever,
 * so a grader that compares raw amplitudes will fail perfectly correct answers:
 * `X` and `Y` both take |0⟩ to the |1⟩ pole, but Y leaves an i out front, and
 * `Z·H` versus `H·X` differ by a sign on the whole vector.
 *
 * So: this grader NEVER compares raw amplitudes. It compares probabilities,
 * which are phase-blind by construction. The one case that needs phase
 * information — the oracle kind, where an entire challenge is about a sign that
 * probabilities cannot see — compares each amplitude's phase RELATIVE to the
 * first non-zero amplitude. A relative phase is invariant under a global phase,
 * so that check is still immune to the bug.
 *
 * Everything here is deterministic and local. No network, no API key, no model.
 */

import { formatKet, simulate, type Circuit } from '@/lib/quantum'
import type { Challenge, Grade, GradeCheck } from './types'

/** Default per-basis-state tolerance when a challenge does not set one. */
const DEFAULT_TOLERANCE = 0.02

/** A relative amplitude is treated as real if its imaginary part is under this. */
const PHASE_EPSILON = 1e-6

/** Amplitudes below this magnitude are "zero" for phase purposes. */
const AMPLITUDE_EPSILON = 1e-9

/** BARRIER and MEASURE are annotations, not operations — they do not cost a gate. */
export function gateCount(circuit: Circuit): number {
  return circuit.ops.filter((op) => op.name !== 'BARRIER' && op.name !== 'MEASURE').length
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

interface Deviation {
  index: number
  /** actual − target. Negative means the learner is short on that state. */
  signed: number
  magnitude: number
}

/** The single worst basis state, which is the one worth talking about. */
function worstDeviation(actual: number[], target: number[]): Deviation {
  let worst: Deviation = { index: 0, signed: 0, magnitude: 0 }
  for (let i = 0; i < target.length; i++) {
    const signed = (actual[i] ?? 0) - target[i]
    const magnitude = Math.abs(signed)
    if (magnitude > worst.magnitude) worst = { index: i, signed, magnitude }
  }
  return worst
}

export function grade(challenge: Challenge, circuit: Circuit): Grade {
  const checks: GradeCheck[] = []
  const gates = gateCount(circuit)
  const par = challenge.maxGates

  // ── Check 1: register width ──
  const widthOk = circuit.numQubits === challenge.numQubits
  checks.push({
    label: 'Register size',
    passed: widthOk,
    detail: widthOk
      ? `${circuit.numQubits} qubit${circuit.numQubits === 1 ? '' : 's'}, as the challenge asks.`
      : `This challenge is on ${challenge.numQubits} qubits; your circuit has ${circuit.numQubits}.`,
  })

  if (!widthOk) {
    return {
      passed: false,
      score: 0,
      checks,
      summary: `The circuit is the wrong width — rebuild it on ${challenge.numQubits} qubits.`,
      gateCount: gates,
      parCount: par,
    }
  }

  const target = challenge.targetProbabilities
  if (!target) {
    // Not reachable with the shipped catalogue; kept so a future challenge that
    // forgets its target fails loudly instead of silently passing everything.
    checks.push({
      label: 'Challenge definition',
      passed: false,
      detail: 'This challenge has no target distribution, so it cannot be graded.',
    })
    return {
      passed: false,
      score: 0,
      checks,
      summary: 'This challenge is missing its target and cannot be graded.',
      gateCount: gates,
      parCount: par,
    }
  }

  // ── Simulate ──
  let probabilities: number[]
  let amplitudes: { re: number; im: number }[]
  try {
    const state = simulate(circuit)
    probabilities = state.probabilities()
    amplitudes = state.amplitudes()
  } catch {
    checks.push({
      label: 'Simulation',
      passed: false,
      detail: 'The circuit could not be simulated — check that every gate sits on a valid wire.',
    })
    return {
      passed: false,
      score: 0,
      checks,
      summary: 'The circuit could not be simulated.',
      gateCount: gates,
      parCount: par,
    }
  }

  const tolerance = challenge.tolerance ?? DEFAULT_TOLERANCE
  const worst = worstDeviation(probabilities, target)
  const distributionOk = worst.magnitude <= tolerance
  const worstKet = formatKet(worst.index, challenge.numQubits)

  // Probabilities, not amplitudes — see the global-phase note at the top.
  checks.push({
    label: 'Output distribution',
    passed: distributionOk,
    detail: distributionOk
      ? `Every basis state is on target. Largest gap: ${pct(worst.magnitude)} on ${worstKet}.`
      : worst.signed < 0
        ? `You are ${pct(worst.magnitude)} short on ${worstKet} — it should be ${pct(
            target[worst.index]
          )} and it is ${pct(probabilities[worst.index] ?? 0)}.`
        : `You have ${pct(worst.magnitude)} too much on ${worstKet} — it should be ${pct(
            target[worst.index]
          )} and it is ${pct(probabilities[worst.index] ?? 0)}.`,
  })

  // ── Oracle: the phase check ──
  //
  // An oracle changes NO probability at all — that is exactly the lesson, and
  // exactly why the distribution check above cannot grade it. So compare each
  // amplitude's sign RELATIVE to the first non-zero amplitude. Relative phase
  // survives a global phase change; raw amplitudes do not.
  let phaseOk = true
  if (challenge.kind === 'oracle' && challenge.targetSigns) {
    const signs = challenge.targetSigns
    const anchor = amplitudes.findIndex((a) => Math.hypot(a.re, a.im) > AMPLITUDE_EPSILON)

    if (anchor < 0) {
      phaseOk = false
      checks.push({
        label: 'Relative phases',
        passed: false,
        detail: 'The state is empty — nothing to check the phases of.',
      })
    } else {
      const a0 = amplitudes[anchor]
      const denom = a0.re * a0.re + a0.im * a0.im
      let badIndex = -1
      let badReason = ''

      for (let i = 0; i < amplitudes.length; i++) {
        if (target[i] <= 0) continue
        const a = amplitudes[i]
        // ratio = a_i / a_anchor, computed as a_i * conj(a_anchor) / |a_anchor|²
        const ratioRe = (a.re * a0.re + a.im * a0.im) / denom
        const ratioIm = (a.im * a0.re - a.re * a0.im) / denom
        // Required sign of a_i relative to the anchor.
        const wanted = (signs[i] ?? 1) * (signs[anchor] ?? 1)

        if (Math.abs(ratioIm) > PHASE_EPSILON) {
          badIndex = i
          badReason = `it carries a complex phase, and this oracle only wants a real ${
            wanted < 0 ? 'minus' : 'plus'
          } sign`
          break
        }
        if (Math.sign(ratioRe) !== Math.sign(wanted)) {
          badIndex = i
          badReason =
            wanted < 0
              ? 'its sign should be flipped relative to the others, and it is not'
              : 'its sign is flipped and it should not be'
          break
        }
      }

      phaseOk = badIndex < 0
      checks.push({
        label: 'Relative phases',
        passed: phaseOk,
        detail: phaseOk
          ? `The marked state carries the sign flip and the others do not. Note that the histogram is identical either way — probabilities are blind to this.`
          : `${formatKet(badIndex, challenge.numQubits)} has the wrong phase: ${badReason}.`,
      })
    }
  }

  // ── Gate golf: the budget ──
  //
  // Advisory, not disqualifying: hitting the target with too many gates still
  // solves the puzzle, it just does not earn full marks.
  const targetsMet = distributionOk && phaseOk
  let withinPar = true
  if (challenge.kind === 'gate-golf' && par !== undefined) {
    withinPar = gates <= par
    const over = gates - par
    checks.push({
      label: 'Gate budget',
      passed: withinPar,
      detail: withinPar
        ? `${gates} gate${gates === 1 ? '' : 's'} — par is ${par}. Full marks.`
        : `${gates} gates against a par of ${par}: ${over} over. Still a solve, but not a full score.`,
    })
  }

  // ── Score ──
  let score: number
  if (targetsMet) {
    if (challenge.kind === 'gate-golf' && par !== undefined && !withinPar) {
      // Partial credit, degrading gently with each gate over par.
      score = Math.max(0.5, 0.85 - 0.05 * (gates - par - 1))
    } else {
      score = 1
    }
  } else {
    // Partial credit for getting close, capped below a pass so it is never
    // mistaken for one.
    score = clamp01(0.45 * (1 - Math.min(1, worst.magnitude / 0.5)))
    if (distributionOk && !phaseOk) score = 0.45 // distribution right, phase wrong
  }

  const summary = targetsMet
    ? challenge.kind === 'gate-golf' && par !== undefined
      ? withinPar
        ? `Solved at par — ${gates} gate${gates === 1 ? '' : 's'}.`
        : `Solved in ${gates} gates, ${gates - par} over the par of ${par}.`
      : `Solved in ${gates} gate${gates === 1 ? '' : 's'}.`
    : distributionOk && !phaseOk
      ? 'The distribution is right but the phases are not — this one is graded on amplitudes.'
      : `Not there yet: ${worstKet} is off by ${pct(worst.magnitude)}.`

  return {
    passed: targetsMet,
    score: Math.round(score * 1000) / 1000,
    checks,
    summary,
    gateCount: gates,
    parCount: par,
  }
}
