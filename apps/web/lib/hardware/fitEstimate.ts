/**
 * fitEstimate.ts — a ROUGH, client-side "will this circuit survive?" heuristic.
 *
 * The formula is one line and is shown to the user, verbatim, in the tooltip:
 *
 *     success ≈ exp(−depth × median 2Q error)
 *
 * That is an error-budget sketch, not physics: it treats every layer of the
 * circuit as if it burned one median two-qubit gate's worth of fidelity, and
 * ignores routing overhead, readout error, crosstalk, T1/T2 during idles, and
 * the fact that transpilation will make the depth larger before the device ever
 * sees it. It exists to *rank* devices for the circuit in hand ("this machine's
 * 2Q error is 10x that one's") — never to predict a number anyone should
 * quote. Every rendering of it must keep the words "rough estimate" attached;
 * the honesty constraints are documented in docs/HARDWARE.md §7.
 *
 * Kept pure and dependency-free so the maths is unit-testable and the picker
 * only handles presentation.
 */

/**
 * Mirror of the API's CalibrationSummary (routers/hardware.py). Field names
 * stay snake_case on purpose — see lib/hardware/types.ts for why renaming
 * wire fields is the bug the compiler cannot catch.
 */
export interface CalibrationSummary {
  /** 'live' | 'static' (vendor-published typical values) | 'unavailable'. */
  source: string
  qubits: number | null
  median_1q_error: number | null
  median_2q_error: number | null
  median_t1_us: number | null
  median_t2_us: number | null
  queue_depth: number | null
  note: string
}

/** A computed fit, or an honest refusal to compute one. */
export type FitEstimate =
  | {
      kind: 'estimate'
      /** exp(−depth × median 2Q error), clamped to [0, 1]. */
      success: number
      label: FitLabel
      /** 'live' or 'static' — inherited from the calibration it was built on. */
      source: string
    }
  | { kind: 'unknown'; why: string }

export type FitLabel = 'good' | 'marginal' | 'poor'

/**
 * Label boundaries on the estimated success probability. Exported so the test
 * pins them: a silent threshold change re-labels every device in the picker.
 */
export const FIT_THRESHOLDS = { good: 0.75, marginal: 0.35 } as const

/** The formula, verbatim, for tooltips — the UI must show it, not paraphrase it. */
export const FIT_FORMULA = 'success ≈ exp(−depth × median 2Q error)'

/** One sentence of humility that must travel with every rendered estimate. */
export const FIT_DISCLAIMER =
  'A rough ranking heuristic only — it ignores routing, readout error and decoherence, ' +
  'and transpilation will deepen the circuit before the device runs it.'

/**
 * Map an estimated success probability onto its label.
 *
 * @param success - A probability in [0, 1].
 * @returns 'good' at or above 0.75, 'marginal' at or above 0.35, else 'poor'.
 */
export function fitLabel(success: number): FitLabel {
  if (success >= FIT_THRESHOLDS.good) return 'good'
  if (success >= FIT_THRESHOLDS.marginal) return 'marginal'
  return 'poor'
}

/**
 * Estimate how well a circuit of the given depth fits a device.
 *
 * @param depth - Logical circuit depth (layers), as drawn — pre-transpile.
 * @param calibration - The device's calibration summary, when the API sent one.
 * @returns An estimate when a median 2Q error exists, else an honest 'unknown'.
 */
export function estimateFit(
  depth: number,
  calibration: CalibrationSummary | null | undefined,
): FitEstimate {
  if (!Number.isFinite(depth) || depth < 0) {
    return { kind: 'unknown', why: 'The circuit depth is not known.' }
  }
  if (!calibration || calibration.source === 'unavailable') {
    return { kind: 'unknown', why: 'No calibration data for this device.' }
  }
  const error = calibration.median_2q_error
  if (typeof error !== 'number' || !Number.isFinite(error) || error < 0) {
    return { kind: 'unknown', why: 'This device reports no 2-qubit error rate.' }
  }
  // exp(−d·p) is monotonically decreasing in both depth and error, lives in
  // (0, 1], and degrades smoothly instead of going negative the way the naive
  // 1 − d·p budget does on deep circuits.
  const success = Math.min(1, Math.exp(-depth * error))
  return { kind: 'estimate', success, label: fitLabel(success), source: calibration.source }
}

/**
 * Depth and 2Q-gate count of a builder circuit, by ASAP layering.
 *
 * Deliberately duplicates neither the server's Qiskit analysis (an HTTP call
 * per device would be absurd for a hover summary) nor its answer: this is the
 * depth of the circuit AS DRAWN. Barriers are ignored and measurements are
 * excluded from depth, matching how the estimate is framed ("gate layers").
 *
 * @param circuit - Anything shaped like lib/quantum's Circuit.
 * @returns The layer count and the number of gates touching 2+ qubits.
 */
export function circuitStats(circuit: {
  numQubits: number
  ops: ReadonlyArray<{ name: string; qubits: number[] }>
}): { depth: number; twoQubitGates: number } {
  const frontier: number[] = new Array(Math.max(0, circuit.numQubits)).fill(0)
  let twoQubitGates = 0
  for (const op of circuit.ops) {
    if (op.name === 'BARRIER' || op.name === 'MEASURE') continue
    if (op.qubits.length >= 2) twoQubitGates += 1
    const layer = 1 + Math.max(0, ...op.qubits.map((q) => frontier[q] ?? 0))
    for (const q of op.qubits) frontier[q] = layer
  }
  return { depth: frontier.length ? Math.max(...frontier) : 0, twoQubitGates }
}
