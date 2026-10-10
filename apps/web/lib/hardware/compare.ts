/**
 * compare.ts — pure comparison maths for two hardware runs of the same circuit.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The thing a hardware engineer actually does all day is run the same circuit
 * twice and ask what changed: a different device, a different optimisation
 * level, mitigation on versus off. We store everything needed to answer that —
 * counts, shots, optimisation level, transpiled depth and two-qubit count —
 * and until this module the only way to get at it was to download the CSV and
 * do the arithmetic somewhere else.
 *
 * Kept pure and free of React so the maths is unit-testable on its own; the
 * component only formats what these functions return.
 *
 * ── The three traps this module exists to avoid ─────────────────────────────
 *
 *  1. TWO RUNS CAN HAVE DIFFERENT OUTCOME SETS. A device that never produced
 *     '0101' has no key for it, and a naive loop over `Object.keys(a)` would
 *     silently ignore every outcome only run B saw — making two very different
 *     distributions look close. Every function here iterates the UNION of the
 *     keys and treats a missing key as an observed zero.
 *
 *  2. THE SHOT TOTALS ARE NOT THE REQUESTED SHOTS. A device can return fewer
 *     shots than were asked for (dropped shots, a partially completed job, a
 *     vendor that rounds to its own batch size). Normalising by `entry.shots`
 *     — the number we asked for — would therefore produce probabilities that
 *     do not sum to one and a distance that is wrong in a direction nobody
 *     would notice. Every distribution here is normalised by ITS OWN observed
 *     total, and the requested-versus-returned discrepancy is surfaced rather
 *     than hidden.
 *
 *  3. SHOT NOISE IS REAL AND IS NOT SMALL. Two runs of the *same* circuit on
 *     the *same* device drawn from the *same* distribution will not give
 *     distance zero; they will give something of order 1/sqrt(N). Reporting
 *     "TVD = 0.031" with no uncertainty invites somebody to conclude that
 *     dynamical decoupling helped when all they measured was the sampler. So
 *     every distance here comes back with a standard error AND with a noise
 *     floor — the distance two samples of one identical distribution would be
 *     expected to show — and `beyondShotNoise` is false unless the measured
 *     distance clears that floor by `SHOT_NOISE_SIGMA` standard errors.
 *
 * ── What these numbers are NOT ──────────────────────────────────────────────
 *
 * Every uncertainty in this file is a DELTA-METHOD ESTIMATE from a single pair
 * of samples, not an exact sampling distribution:
 *
 *   * The per-cell variances use the independent-binomial approximation
 *     p(1-p)/N and ignore the multinomial's negative between-cell covariance.
 *     That makes the standard errors mildly CONSERVATIVE (too large) when the
 *     deltas share a sign, which is the safe direction for a claim of
 *     significance but is not exact.
 *   * The total variation distance is a sum of absolute values, which is not
 *     differentiable at zero, so its delta-method error is least trustworthy
 *     exactly where the two runs agree. That is why the noise floor is
 *     computed separately, from the half-normal expectation of |p - q|, rather
 *     than being read off the standard error.
 *   * Nothing here is a hypothesis test. If you need a p-value, these are the
 *     inputs to one, not a substitute for one.
 *   * The binomial variance p(1-p)/N is DEGENERATE at p = 0 and p = 1: it
 *     reports exactly zero uncertainty for an outcome one run produced on every
 *     shot or on none. That is an artefact of the Wald estimator, not a
 *     measurement of certainty, and every consumer here is written to avoid
 *     turning it into either a claim of significance or a claim of noise. Where
 *     the error bar collapses to zero, say so rather than printing '± 0.0000'.
 *
 * Any UI rendering these must keep that attached — see `COMPARE_DISCLAIMER`.
 *
 * ── These functions do not know what circuit was run ────────────────────────
 *
 * The whole panel is premised on the two runs being the SAME circuit, and
 * nothing in the counts can establish that: two unrelated circuits produce a
 * large, perfectly well-formed distance, and the settings diff beside it then
 * invites the reader to blame the optimisation level. `compareRuns` therefore
 * checks the stored submitted QASM when BOTH rows carry it — `GET
 * /api/hardware/jobs` only returns that column on `include_qasm=1` — and says
 * plainly that it cannot tell when they do not. The check compares source text
 * with blank lines and per-line indentation normalised away; it is not a
 * semantic equivalence check, so two spellings of one circuit will read as
 * different, which is the safe direction.
 *
 * ── Bitstring keys are compared verbatim ────────────────────────────────────
 *
 * '00' and '0 0' and '0x0' are three different keys as far as this module is
 * concerned. Normalising them would mean guessing the register layout, and a
 * wrong guess would merge two genuinely different outcomes — a much worse
 * failure than showing the user that the two histograms are keyed differently.
 * `countsWarnings` detects the four cases that actually occur (one run's own
 * keys varying in width, because its leading zeros were stripped; the two runs
 * at different widths; hex versus binary; and register separators) and says so.
 */

import type { ExpectationValue, HardwareJobHistoryEntry } from '@/lib/hardware/types'

/**
 * Fields that belong to a run but that `GET /api/hardware/jobs` does not
 * currently return, because `public.hardware_usage` has no column for them.
 *
 * They are optional so a plain `HardwareJobHistoryEntry` is a valid
 * `ComparableRun` with no casting, and every consumer here treats a missing
 * value as "not recorded" — which is NOT the same claim as `false`. Rendering
 * an unrecorded mitigation setting as "off" would be inventing an experimental
 * condition, and this codebase does not do that.
 */
export interface RunExtras {
  /** Whether idle-time decoupling was applied. Absent = not recorded. */
  dynamicalDecoupling?: boolean | null
  /** Whether readout twirling was applied. Absent = not recorded. */
  measurementTwirling?: boolean | null
  /** Estimator results, when the run was an estimator job. */
  expectationValues?: ExpectationValue[] | null
}

/** A history row, plus the submission settings the history does not yet carry. */
export type ComparableRun = HardwareJobHistoryEntry & RunExtras

/**
 * How many standard errors a distance must clear the shot-noise floor by
 * before this module will call the two runs distinguishable.
 *
 * Exported so the test pins it: quietly lowering it would turn shot noise into
 * "mitigation improved the result" across every comparison on the site.
 */
export const SHOT_NOISE_SIGMA = 2

/** One sentence of humility that must travel with every rendered distance. */
export const COMPARE_DISCLAIMER =
  'Distances are estimated from finite samples. The ± is a delta-method standard error and ' +
  'the noise floor is the distance two samples of one identical distribution would be ' +
  'expected to show, so a difference smaller than that measures the sampler, not the device.'

/** A histogram normalised by its own observed total. */
export interface Distribution {
  /** Outcome to probability. Sums to 1 when `shots > 0`, and is empty when not. */
  probabilities: Record<string, number>
  /** The total counts actually returned — NOT the shots requested. */
  shots: number
}

/** A distance, with the two numbers needed to know whether it means anything. */
export interface DistanceEstimate {
  /** The measured value. */
  value: number
  /**
   * Delta-method standard error on `value`. Conservative; see the header.
   *
   * ZERO IS NOT A CLAIM OF EXACTNESS. The derivative this is built from
   * vanishes at the endpoints — every outcome all-or-nothing in both runs for
   * the total variation distance, a Bhattacharyya coefficient of exactly 0 for
   * the fidelity — so a zero here means "the first-order error estimate has
   * collapsed", not "this number is certain". Renderers must not print it as
   * '± 0.0000'; `isDegenerateError` is the check.
   */
  standardError: number
  /**
   * What shot noise alone would produce at these totals: for a distance, the
   * distance two samples of one identical distribution would be expected to
   * show; for a similarity, the amount it would be expected to fall short of 1
   * by. Nothing below this floor is evidence of anything.
   */
  noiseFloor: number
  /** True when the measurement clears `noiseFloor` by `SHOT_NOISE_SIGMA` errors. */
  beyondShotNoise: boolean
}

/**
 * Whether the first-order error estimate on a distance has collapsed to zero.
 *
 * Exported so the UI can refuse to render '± 0.0000', which reads as a claim of
 * exactness and is the single most misleading thing this module could put on a
 * screen. A collapsed error does not invalidate `value` — `value` is still the
 * distance between the two observed histograms — it only means the uncertainty
 * beside it is unavailable at this point of the estimator.
 *
 * @param estimate - Any distance produced by this module.
 * @returns True when the standard error is zero (or not finite), so no error
 *   bar should be drawn.
 */
export function isDegenerateError(estimate: DistanceEstimate): boolean {
  return !(estimate.standardError > 0)
}

/** One outcome's contribution to the difference between two runs. */
export interface BitstringDelta {
  bitstring: string
  /** Raw counts. Zero means "this run never produced this outcome". */
  countA: number
  countB: number
  /** Each count over its OWN run's returned total. */
  probabilityA: number
  probabilityB: number
  /** probabilityA minus probabilityB. */
  delta: number
  /**
   * Standard error on `delta`, from the two binomial variances. Zero when both
   * runs saturate this outcome (each saw it on every shot or on none), which is
   * a degenerate estimate and not a measurement of certainty.
   */
  standardError: number
  /** delta / standardError, or null when the error is zero. */
  z: number | null
  /**
   * True when the two runs differ on this outcome by more than shot noise.
   *
   * Normally |z| > `SHOT_NOISE_SIGMA`. When the error collapses to zero — both
   * runs saturated — it falls back to `delta !== 0`, because the saturated case
   * splits into two answers and neither of them is "within noise": p = q = 1
   * means the runs AGREE exactly, while p = 1 against q = 0 is the largest
   * disagreement this table can hold.
   */
  beyondShotNoise: boolean
}

/** Everything that can be said about two histograms of the same circuit. */
export interface CountsComparison {
  totalVariationDistance: DistanceEstimate
  /**
   * Hellinger fidelity, the square of the Bhattacharyya coefficient, matching
   * Qiskit's `hellinger_fidelity`. 1 for identical distributions, 0 for
   * disjoint support.
   */
  hellingerFidelity: DistanceEstimate
  /** Observed totals, which may be below the requested shots. */
  shotsA: number
  shotsB: number
  /** Size of the union of the two outcome sets. */
  outcomes: number
  /** Every outcome in the union, largest absolute delta first. */
  deltas: BitstringDelta[]
  /** Keying problems that make the numbers above less trustworthy. */
  warnings: string[]
}

/** Two runs' value for one observable. */
export interface ExpectationDelta {
  label: string
  valueA: number | null
  valueB: number | null
  /** valueA minus valueB, or null when either value is missing. */
  delta: number | null
  /**
   * The two runs' reported errors added in quadrature, or null when either run
   * did not report a positive, finite one. Null here is why `beyondShotNoise`
   * can be null too: without an error bar there is no way to say whether a
   * difference matters. A reported error of exactly zero counts as missing —
   * see `compareExpectationValues`.
   */
  standardError: number | null
  /** True/false when it can be decided, null when there is no error bar. */
  beyondShotNoise: boolean | null
}

/** One row of the settings diff: what each run used, and whether it differed. */
export interface SettingDiff {
  /** Human label, e.g. 'Optimisation level'. */
  label: string
  /** Formatted value for run A; null when the platform never recorded it. */
  a: string | null
  b: string | null
  /** True only when both are recorded AND they are not equal. */
  differs: boolean
  /**
   * False when either side is unrecorded. A setting we did not store is not
   * evidence that the two runs used the same value, and the UI must not draw
   * it as agreement.
   */
  recorded: boolean
}

/**
 * Whether the two runs were submitted with the same circuit source.
 *
 * `same` is deliberately tri-state. Everything else on this panel is premised
 * on the two runs being the same circuit, so "we checked and they match", "we
 * checked and they do not" and "we were not given the circuits" are three
 * different situations and only the first of them licenses reading a distance
 * as a property of the device.
 */
export interface CircuitCheck {
  /** True identical, false different, null when at least one QASM is missing. */
  same: boolean | null
  /** Always a sentence: "cannot tell" needs saying just as much as "differ". */
  note: string
}

/** The complete comparison of two runs. */
export interface RunComparison {
  a: ComparableRun
  b: ComparableRun
  /** Whether these are even two runs of one circuit. Never null; see above. */
  circuit: CircuitCheck
  /** Every comparable setting, differing ones first. */
  settings: SettingDiff[]
  /** Null when at least one run has no usable histogram. */
  counts: CountsComparison | null
  /** Why `counts` is null. Null when `counts` is present. */
  countsNote: string | null
  /** Observables present in both runs. Empty for sampler jobs. */
  expectations: ExpectationDelta[]
  /** Why `expectations` is empty, when that needs saying. */
  expectationsNote: string | null
}

/**
 * Normalise a histogram by its own observed total.
 *
 * Negative and non-finite counts are treated as zero rather than being
 * propagated: they cannot occur physically, and a single NaN would otherwise
 * turn every distance in the comparison into NaN with no explanation.
 *
 * @param counts - A vendor histogram, or null for a run with no results.
 * @returns The probabilities and the observed total. Both empty/zero when
 *   `counts` is null, empty, or sums to zero.
 */
export function normaliseCounts(counts: Record<string, number> | null | undefined): Distribution {
  const probabilities: Record<string, number> = {}
  if (!counts) return { probabilities, shots: 0 }

  let shots = 0
  for (const value of Object.values(counts)) {
    if (Number.isFinite(value) && value > 0) shots += value
  }
  // Guard the division rather than returning Infinity: an all-zero histogram is
  // a real thing a cancelled or empty job can leave behind.
  if (shots === 0) return { probabilities, shots: 0 }

  for (const [bitstring, value] of Object.entries(counts)) {
    probabilities[bitstring] = Number.isFinite(value) && value > 0 ? value / shots : 0
  }
  return { probabilities, shots }
}

/**
 * The sorted union of two histograms' outcome sets.
 *
 * Sorted rather than left in insertion order because `Object.entries` puts
 * integer-like keys ('11') first in ascending numeric order and everything else
 * ('00') in insertion order, so two renderings of the same comparison would
 * otherwise disagree about row order.
 *
 * Sorted by UTF-16 code unit and NOT with `localeCompare`: called without a
 * locale, `localeCompare` uses the host's default collation, which orders
 * punctuation and spaces by rules that differ between browsers and ICU
 * versions. Two users looking at the same comparison would then see the rows in
 * different orders — exactly the instability the sort was added to remove — and
 * the key space here ('0', '1', 'x', ' ') has no linguistic order to respect.
 *
 * @param a - First histogram.
 * @param b - Second histogram.
 * @returns Every key appearing in either, ascending by code unit, no duplicates.
 */
export function unionKeys(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined,
): string[] {
  const keys = new Set<string>([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  return [...keys].sort(compareBitstrings)
}

/**
 * Total variation distance between two histograms: half the sum of |p - q|
 * over the union of their outcomes.
 *
 * 0 for identical distributions, 1 for disjoint support — so it answers "how
 * far apart are these two runs" on a scale whose endpoints mean something.
 *
 * The standard error uses |d(TVD)/d(delta_i)| = 1/2 for every cell, which is
 * the magnitude of the derivative wherever it exists. Taking the signed
 * derivative instead would give exactly zero for two identical histograms,
 * which is the one answer that is certainly wrong: two identical samples are
 * not evidence of zero uncertainty, they are one draw of a noisy quantity.
 *
 * The noise floor is the half-normal expectation E|p - q| = sigma * sqrt(2/pi)
 * summed over cells using the POOLED proportion — that is, what this statistic
 * would read if both runs were sampling the same distribution at these totals.
 *
 * @param a - Run A's histogram.
 * @param b - Run B's histogram.
 * @returns The distance, its standard error, the shot-noise floor, and whether
 *   the distance clears that floor by `SHOT_NOISE_SIGMA` errors. All zero and
 *   `beyondShotNoise` false when either run has no counts at all.
 */
export function totalVariationDistance(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined,
): DistanceEstimate {
  const da = normaliseCounts(a)
  const db = normaliseCounts(b)
  if (da.shots === 0 || db.shots === 0) {
    return { value: 0, standardError: 0, noiseFloor: 0, beyondShotNoise: false }
  }

  let sumAbs = 0
  let variance = 0
  let floor = 0
  for (const key of unionKeys(a, b)) {
    const p = da.probabilities[key] ?? 0
    const q = db.probabilities[key] ?? 0
    sumAbs += Math.abs(p - q)
    variance += (p * (1 - p)) / da.shots + (q * (1 - q)) / db.shots

    // Pooled proportion: the null hypothesis is that both runs sample ONE
    // distribution, so the floor has to be computed under that hypothesis
    // rather than from the two separate estimates.
    const pooled = (p * da.shots + q * db.shots) / (da.shots + db.shots)
    floor += Math.sqrt(pooled * (1 - pooled) * (1 / da.shots + 1 / db.shots))
  }

  const value = clamp01(0.5 * sumAbs)
  const standardError = 0.5 * Math.sqrt(variance)
  // E|X| = sigma * sqrt(2/pi) for X ~ N(0, sigma^2); the 1/2 is the 1/2 in the
  // definition of the total variation distance.
  const noiseFloor = 0.5 * Math.sqrt(2 / Math.PI) * floor
  return {
    value,
    standardError,
    noiseFloor,
    beyondShotNoise: value - noiseFloor > SHOT_NOISE_SIGMA * standardError,
  }
}

/**
 * Hellinger fidelity between two histograms: the square of the Bhattacharyya
 * coefficient, sum of sqrt(p * q), over the union of their outcomes.
 *
 * Same definition as Qiskit's `hellinger_fidelity`, so a number shown here can
 * be checked against a notebook: with BC = sum sqrt(p*q), the squared
 * Hellinger distance is 1 - BC and the fidelity is (1 - H^2)^2 = BC^2. It is 1
 * for identical distributions and 0 for disjoint support.
 *
 * Reported ALONGSIDE the total variation distance rather than instead of it,
 * because the two disagree in a useful way: fidelity is far more forgiving of
 * a long tail of rare outcomes, so a pair of runs with high fidelity and a
 * large TVD is telling you the bulk agrees and the tail does not.
 *
 * The delta-method variance of BC has the convenient property that the
 * sqrt(q/p) derivative's singularity at p = 0 cancels against the p(1-p)
 * variance, so there is no division by zero even when one run never saw an
 * outcome the other did.
 *
 * `noiseFloor` here is the shortfall from 1 that shot noise alone would
 * produce, and `beyondShotNoise` is true when the OBSERVED shortfall exceeds
 * it by `SHOT_NOISE_SIGMA` standard errors. Note that this floor is a
 * SECOND-ORDER quantity and so falls off as 1/N, while the standard error
 * beside it is first order and falls off as 1/sqrt(N) — the two are not
 * interchangeable and quadrupling the shots does not move them equally.
 *
 * @param a - Run A's histogram.
 * @param b - Run B's histogram.
 * @returns The fidelity, its standard error, the expected shot-noise shortfall
 *   and whether the observed shortfall clears it. Fidelity 0 with
 *   `beyondShotNoise` false when either run has no counts.
 */
export function hellingerFidelity(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined,
): DistanceEstimate {
  const da = normaliseCounts(a)
  const db = normaliseCounts(b)
  if (da.shots === 0 || db.shots === 0) {
    return { value: 0, standardError: 0, noiseFloor: 0, beyondShotNoise: false }
  }

  let bc = 0
  let varianceBc = 0
  let floorBc = 0
  for (const key of unionKeys(a, b)) {
    const p = da.probabilities[key] ?? 0
    const q = db.probabilities[key] ?? 0
    bc += Math.sqrt(p * q)
    // d(BC)/dp = sqrt(q/p)/2, and (sqrt(q/p)/2)^2 * p(1-p)/N = q(1-p)/(4N),
    // which stays finite at p = 0 — the singularity cancels.
    varianceBc += (0.25 * q * (1 - p)) / da.shots + (0.25 * p * (1 - q)) / db.shots

    // Under the null (both runs sampling the pooled distribution), the expected
    // deficit of BC below 1 is Var(p - q) / (8 * pbar) per cell — the
    // second-order term of sqrt(p*q) expanded about p = q = pbar. A cell with
    // no weight in either run contributes nothing.
    const pooled = (p * da.shots + q * db.shots) / (da.shots + db.shots)
    if (pooled > 0) {
      const varDelta = pooled * (1 - pooled) * (1 / da.shots + 1 / db.shots)
      floorBc += varDelta / (8 * pooled)
    }
  }

  const coefficient = clamp01(bc)
  const value = clamp01(coefficient * coefficient)
  // F = BC^2, so dF = 2 * BC * dBC.
  const standardError = 2 * coefficient * Math.sqrt(varianceBc)
  // A shortfall of `floorBc` in BC is, to first order, twice that in F.
  const noiseFloor = Math.min(1, 2 * floorBc)
  const shortfall = 1 - value
  return {
    value,
    standardError,
    noiseFloor,
    beyondShotNoise: shortfall - noiseFloor > SHOT_NOISE_SIGMA * standardError,
  }
}

/**
 * Per-outcome differences over the union of the two outcome sets.
 *
 * An outcome only one run produced appears with count 0 and probability 0 for
 * the other, which is the honest reading: that run measured it zero times.
 *
 * @param a - Run A's histogram.
 * @param b - Run B's histogram.
 * @returns One row per outcome in the union, sorted by |delta| descending then
 *   by bitstring so the order is stable between renders.
 */
export function bitstringDeltas(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined,
): BitstringDelta[] {
  const da = normaliseCounts(a)
  const db = normaliseCounts(b)

  const rows = unionKeys(a, b).map((bitstring): BitstringDelta => {
    const p = da.probabilities[bitstring] ?? 0
    const q = db.probabilities[bitstring] ?? 0
    const delta = p - q
    const variance =
      (da.shots > 0 ? (p * (1 - p)) / da.shots : 0) +
      (db.shots > 0 ? (q * (1 - q)) / db.shots : 0)
    const standardError = Math.sqrt(variance)
    // A zero error happens whenever BOTH runs saturate this outcome: each of p
    // and q is exactly 0 or exactly 1, so each binomial variance term is zero.
    // A z of plus or minus Infinity there would be a claim of certainty, so it
    // is reported as "no z available".
    const z = standardError > 0 ? delta / standardError : null
    return {
      bitstring,
      countA: rawCount(a, bitstring),
      countB: rawCount(b, bitstring),
      probabilityA: p,
      probabilityB: q,
      delta,
      standardError,
      z,
      // The saturated branch is the whole reason this is not just `|z| > 2`.
      // Disjoint runs — A produced this outcome on every shot, B never — give
      // delta = 1 with a standard error of exactly 0, so `z !== null && ...`
      // alone returned FALSE and the largest difference the table can contain
      // was rendered as "consistent with shot noise". Nothing about two
      // saturated samples is consistent with them coming from one distribution.
      beyondShotNoise: z !== null ? Math.abs(z) > SHOT_NOISE_SIGMA : delta !== 0,
    }
  })

  return rows.sort(
    (x, y) => Math.abs(y.delta) - Math.abs(x.delta) || compareBitstrings(x.bitstring, y.bitstring),
  )
}

/**
 * Match two runs' expectation values by observable label.
 *
 * Matched by LABEL and not by position: the labels are the only stable handle
 * on an observable — IBM stores the operators but not our names for them, and
 * two submissions can list the same observables in a different order. Matching
 * by index would then compare <Z0> against <Z0Z1> and produce a perfectly
 * formatted wrong answer.
 *
 * A label repeated within one run yields ONE row, built from the first
 * occurrence on each side. Nothing stops a caller naming two observables the
 * same, and emitting two rows with one label would give a table two rows that
 * claim to be the same observable and disagree — and, in React, two children
 * with the same key.
 *
 * @param a - Run A's expectation values, if it was an estimator job.
 * @param b - Run B's expectation values.
 * @returns One row per distinct label present in BOTH runs, in run A's order.
 *   Empty when either run has none, or when the label sets do not intersect.
 *   `valueA`/`valueB` are null for anything that is not a finite number, so a
 *   NaN from a provider cannot propagate into the rendered delta.
 */
export function compareExpectationValues(
  a: ExpectationValue[] | null | undefined,
  b: ExpectationValue[] | null | undefined,
): ExpectationDelta[] {
  if (!a || !b) return []
  const byLabel = new Map<string, ExpectationValue>()
  for (const value of b) if (!byLabel.has(value.label)) byLabel.set(value.label, value)

  const rows: ExpectationDelta[] = []
  const emitted = new Set<string>()
  for (const left of a) {
    const right = byLabel.get(left.label)
    if (!right || emitted.has(left.label)) continue
    emitted.add(left.label)

    // `== null` and not `!== null`: a field the API omitted arrives as
    // `undefined`, and `undefined !== null` is true. The earlier `!== null`
    // spelling let an absent std_error through into `undefined ** 2`, produced
    // a NaN standard error, and then — because `NaN > 0` is false — fell into
    // the `delta !== 0` branch and declared the difference SIGNIFICANT while
    // rendering '± NaN' beside it. A missing uncertainty must never become a
    // claim; it must become "cannot tell".
    const valueA = finiteOrNull(left.value)
    const valueB = finiteOrNull(right.value)
    const delta = valueA !== null && valueB !== null ? valueA - valueB : null

    // A reported error of exactly zero is treated as no error bar rather than
    // as infinite confidence. No estimator measures an observable to zero
    // uncertainty in finite shots, so a 0 here means the provider did not
    // compute one, and reading it as certainty would let any such run declare
    // every difference significant.
    const errorA = positiveOrNull(left.std_error)
    const errorB = positiveOrNull(right.std_error)
    const standardError =
      errorA !== null && errorB !== null ? Math.sqrt(errorA ** 2 + errorB ** 2) : null

    rows.push({
      label: left.label,
      valueA,
      valueB,
      delta,
      standardError,
      // Null rather than false when there is no error bar: "we cannot tell"
      // and "we checked and it is noise" are different statements, and the
      // second one is not ours to make here.
      beyondShotNoise:
        delta === null || standardError === null
          ? null
          : Math.abs(delta) > SHOT_NOISE_SIGMA * standardError,
    })
  }
  return rows
}

/**
 * The settings that could explain a difference between two runs.
 *
 * Differing rows come FIRST, because the differing settings are the
 * explanation for the differing numbers and burying them under the ones that
 * matched would defeat the point of the panel.
 *
 * Decoupling and twirling are read from `RunExtras`. `GET /api/hardware/jobs`
 * does not return them today — `public.hardware_usage` has no column for them
 * — so for history rows they come back as unrecorded (null) rather than as
 * 'off'. Claiming a run had mitigation disabled because we failed to write it
 * down would be inventing an experimental condition.
 *
 * @param a - Run A.
 * @param b - Run B.
 * @returns One row per comparable setting, differing rows first.
 */
export function settingsDiff(a: ComparableRun, b: ComparableRun): SettingDiff[] {
  const returnedA = normaliseCounts(a.counts).shots
  const returnedB = normaliseCounts(b.counts).shots

  const rows: SettingDiff[] = [
    settingRow('Device', a.backend, b.backend),
    settingRow('Provider', a.provider, b.provider),
    settingRow('Shots requested', a.shots, b.shots),
    settingRow('Shots returned', returnedA || null, returnedB || null),
    settingRow('Optimisation level', a.optimizationLevel, b.optimizationLevel),
    settingRow('Dynamical decoupling', flag(a.dynamicalDecoupling), flag(b.dynamicalDecoupling)),
    settingRow('Readout twirling', flag(a.measurementTwirling), flag(b.measurementTwirling)),
    settingRow('Transpiled depth', a.transpiledDepth, b.transpiledDepth),
    settingRow('Two-qubit gates', a.transpiledTwoQubitGates, b.transpiledTwoQubitGates),
    settingRow('Status', a.status, b.status),
  ]

  // A stable partition, not a sort: within each group the declaration order
  // above is deliberate (the device, then the knobs, then what they produced).
  return [...rows.filter((r) => r.differs), ...rows.filter((r) => !r.differs)]
}

/**
 * Compare two runs end to end.
 *
 * Does NOT verify that the two runs are the same circuit unless both rows carry
 * their submitted QASM — `GET /api/hardware/jobs` returns that column only on
 * `include_qasm=1`. The returned `circuit` says which of the three cases holds,
 * and a caller that drops it on the floor will show a large distance between
 * two unrelated circuits with a settings diff beside it inviting the reader to
 * blame the optimisation level.
 *
 * @param a - Run A, by convention the baseline that B is measured against.
 * @param b - Run B.
 * @returns The circuit check, the settings diff, the count metrics (or a note
 *   saying why there are none), and the matched expectation values (or a note
 *   saying why not).
 */
export function compareRuns(a: ComparableRun, b: ComparableRun): RunComparison {
  const da = normaliseCounts(a.counts)
  const db = normaliseCounts(b.counts)

  let counts: CountsComparison | null = null
  let countsNote: string | null = null
  if (da.shots === 0 || db.shots === 0) {
    const missing =
      da.shots === 0 && db.shots === 0
        ? 'Neither run has a'
        : da.shots === 0
          ? 'Run A has no'
          : 'Run B has no'
    countsNote =
      `${missing} measurement histogram, so no distance can be computed. ` +
      'A job that was never polled after it finished has no stored counts, and neither does one that failed at the device.'
  } else {
    counts = {
      totalVariationDistance: totalVariationDistance(a.counts, b.counts),
      hellingerFidelity: hellingerFidelity(a.counts, b.counts),
      shotsA: da.shots,
      shotsB: db.shots,
      outcomes: unionKeys(a.counts, b.counts).length,
      deltas: bitstringDeltas(a.counts, b.counts),
      warnings: countsWarnings(a.counts, b.counts),
    }
  }

  const expectations = compareExpectationValues(a.expectationValues, b.expectationValues)
  let expectationsNote: string | null = null
  const anyExpectations = (a.expectationValues?.length ?? 0) > 0 || (b.expectationValues?.length ?? 0) > 0
  if (expectations.length === 0 && anyExpectations) {
    expectationsNote =
      'Only one of these runs has expectation values, or the two share no observable labels, so they cannot be compared.'
  }

  return {
    a,
    b,
    circuit: circuitCheck(a.qasm, b.qasm),
    settings: settingsDiff(a, b),
    counts,
    countsNote,
    expectations,
    expectationsNote,
  }
}

/**
 * Decide whether two runs were submitted with the same circuit source.
 *
 * `hardware_usage.qasm` stores the circuit AS SUBMITTED, before transpilation,
 * which is what makes this check meaningful at all: two runs of one circuit at
 * different optimisation levels — the single most common comparison this panel
 * exists for — store byte-identical source.
 *
 * Blank lines and leading/trailing whitespace per line are normalised away
 * first, because those differ between a circuit typed into the editor and the
 * same circuit round-tripped through a client. Nothing else is normalised: this
 * is a TEXT comparison, not semantic equivalence, so two spellings of one
 * circuit (different qubit ordering, an inlined gate) read as different. That
 * is the safe direction — it warns where it need not, rather than blessing a
 * comparison of two unrelated circuits.
 *
 * @param a - Run A's stored QASM, or null when the history was fetched without
 *   `include_qasm=1`.
 * @param b - Run B's stored QASM.
 * @returns Tri-state verdict and a sentence fit to render as-is.
 */
export function circuitCheck(
  a: string | null | undefined,
  b: string | null | undefined,
): CircuitCheck {
  if (!a || !b) {
    return {
      same: null,
      note:
        'The circuit source was not loaded for at least one of these runs, so nothing here can ' +
        'confirm the two ran the SAME circuit. Every number below assumes they did; comparing ' +
        'two different circuits produces a large distance that says nothing about the devices.',
    }
  }
  if (normaliseQasm(a) === normaliseQasm(b)) {
    return { same: true, note: 'Both runs were submitted with the same circuit source.' }
  }
  return {
    same: false,
    note:
      'These two runs were submitted with DIFFERENT circuit source, so the distance below is ' +
      'mostly the difference between two circuits and not between two devices or two settings. ' +
      'Note that the comparison is textual: the same circuit written two ways also lands here.',
  }
}

/**
 * Keying problems that make a comparison less trustworthy than it looks.
 *
 * These are warnings and not errors on purpose: the numbers are still computed
 * and shown, because a user comparing a 3-qubit run against a 5-qubit one
 * usually wants to be told what they did, not handed an empty panel.
 *
 * @param a - Run A's histogram.
 * @param b - Run B's histogram.
 * @returns Zero or more sentences, each naming a concrete mismatch.
 */
export function countsWarnings(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined,
): string[] {
  const warnings: string[] = []
  const keysA = Object.keys(a ?? {})
  const keysB = Object.keys(b ?? {})
  if (keysA.length === 0 || keysB.length === 0) return warnings

  // Two distinct failures, and conflating them sends the reader after the wrong
  // one. A run whose OWN keys vary in width has had its leading zeros stripped
  // somewhere (a vendor keying by integer is the usual culprit), so '001' and
  // '1' are the same outcome counted twice — a defect inside one histogram. Two
  // runs each internally consistent but at different widths is a different
  // register, which is a defect in the choice of runs.
  const widthsA = new Set(keysA.map((k) => k.length))
  const widthsB = new Set(keysB.map((k) => k.length))
  if (widthsA.size > 1 || widthsB.size > 1) {
    warnings.push(
      'At least one of these runs has outcomes of differing lengths, which usually means its ' +
        'leading zeros were stripped before storage. Keys are compared verbatim, so the same ' +
        'outcome can appear as two rows and every number here is affected.',
    )
  } else if ([...widthsA][0] !== [...widthsB][0]) {
    warnings.push(
      'The two runs have different bitstring widths, so they are not reading the same register. ' +
        'Most outcomes will look unique to one run and the distance will read close to its maximum.',
    )
  }

  const hexA = keysA.some((k) => k.startsWith('0x'))
  const hexB = keysB.some((k) => k.startsWith('0x'))
  if (hexA !== hexB) {
    warnings.push(
      'One run stored its outcomes in hex and the other in binary. Keys are compared verbatim, ' +
        'so these two histograms will appear to share no outcomes at all.',
    )
  }

  const spacedA = keysA.some((k) => k.includes(' '))
  const spacedB = keysB.some((k) => k.includes(' '))
  if (spacedA !== spacedB) {
    warnings.push(
      'One run separates its classical registers with a space and the other does not. ' +
        'Keys are compared verbatim, so the two will not line up.',
    )
  }

  return warnings
}

/**
 * Order two outcome keys by UTF-16 code unit.
 *
 * Deliberately not `localeCompare`: see `unionKeys` for why a host-dependent
 * collation is the wrong tool for a key space of '0', '1', 'x' and ' '.
 */
function compareBitstrings(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0
}

/** Strip blank lines and per-line indentation, so formatting is not a diff. */
function normaliseQasm(source: string): string {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** A real number, or null for null, undefined, NaN and the infinities. */
function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A strictly positive real number, or null. Used for error bars only. */
function positiveOrNull(value: number | null | undefined): number | null {
  const finite = finiteOrNull(value)
  return finite !== null && finite > 0 ? finite : null
}

/** Clamp a probability-like quantity into [0, 1] against floating-point drift. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** The raw stored count for one outcome; 0 when this run never saw it. */
function rawCount(counts: Record<string, number> | null | undefined, key: string): number {
  const value = counts?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Render a tri-state flag, keeping 'not recorded' distinct from 'off'. */
function flag(value: boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value ? 'on' : 'off'
}

/** Build one settings row, treating an unrecorded side as "cannot compare". */
function settingRow(
  label: string,
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): SettingDiff {
  const left = a === null || a === undefined ? null : String(a)
  const right = b === null || b === undefined ? null : String(b)
  const recorded = left !== null && right !== null
  return { label, a: left, b: right, differs: recorded && left !== right, recorded }
}
