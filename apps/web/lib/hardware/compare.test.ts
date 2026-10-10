/**
 * compare.test.ts — pins the properties that make a cross-run comparison
 * trustworthy, all of which would fail SILENTLY rather than loudly.
 *
 * Every test here corresponds to a wrong answer that would still render as a
 * neat number in the panel:
 *
 *  * Iterating one run's keys instead of the union would quietly discard every
 *    outcome only the other run produced, making two very different runs look
 *    close and hiding exactly the new error outcomes a user is hunting for.
 *  * Normalising by the REQUESTED shots instead of the returned shots would
 *    make the probabilities not sum to one whenever a device drops shots, and
 *    the resulting distance would be wrong in a direction nobody would check.
 *  * Dropping the standard error would let shot noise be read as a result:
 *    at 1000 shots a TVD of 0.03 between two identical distributions is
 *    completely ordinary, and somebody would credit it to the mitigation they
 *    happened to have turned on.
 */

import { describe, expect, it } from 'vitest'
import {
  SHOT_NOISE_SIGMA,
  bitstringDeltas,
  circuitCheck,
  compareExpectationValues,
  compareRuns,
  countsWarnings,
  hellingerFidelity,
  isDegenerateError,
  normaliseCounts,
  settingsDiff,
  totalVariationDistance,
  unionKeys,
  type ComparableRun,
} from './compare'
import type { HardwareJobHistoryEntry } from '@/lib/hardware/types'

function run(overrides: Partial<ComparableRun> = {}): ComparableRun {
  const base: HardwareJobHistoryEntry = {
    id: 'row-1',
    provider: 'ibm',
    jobId: 'job-1',
    backend: 'ibm_brisbane',
    shots: 1024,
    submittedAt: '2026-09-01T10:00:00.000Z',
    status: 'done',
    counts: { '00': 500, '11': 524 },
    qasm: null,
    error: null,
    qpuSeconds: 1.25,
    optimizationLevel: 3,
    transpiledDepth: 12,
    transpiledTwoQubitGates: 4,
    completedAt: '2026-09-01T10:45:00.000Z',
  }
  return { ...base, ...overrides }
}

/** Multiply every count by `factor`, leaving the proportions untouched. */
function scale(counts: Record<string, number>, factor: number): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v * factor]))
}

describe('normaliseCounts', () => {
  it('divides by the RETURNED total, not by any requested shot count', () => {
    // The failure this catches: a device returning 900 of the 1024 requested
    // shots, normalised by 1024, gives probabilities summing to 0.879 and a
    // distance that is wrong by about 12% with nothing on screen to show it.
    const { probabilities, shots } = normaliseCounts({ '00': 450, '11': 450 })
    expect(shots).toBe(900)
    expect(probabilities['00']).toBeCloseTo(0.5, 12)
    expect(Object.values(probabilities).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12)
  })

  it('returns zero shots rather than NaN for an empty or all-zero histogram', () => {
    // A cancelled job can leave {} behind; dividing by that total would make
    // every metric in the panel NaN with no explanation of which run caused it.
    expect(normaliseCounts({}).shots).toBe(0)
    expect(normaliseCounts({ '00': 0 }).shots).toBe(0)
    expect(normaliseCounts(null).shots).toBe(0)
  })
})

describe('unionKeys', () => {
  it('includes outcomes that only one run produced', () => {
    // Iterating a's keys alone would drop '10' entirely — the single most
    // likely way for a comparison to under-report a real difference.
    expect(unionKeys({ '00': 1, '01': 1 }, { '00': 1, '10': 1 })).toEqual(['00', '01', '10'])
  })

  it('sorts, so two renderings of the same comparison agree on row order', () => {
    // Object.entries puts '11' (an integer-like key) before '00', so insertion
    // order is not stable across two objects built in different orders.
    expect(unionKeys({ '11': 1, '00': 1 }, { '01': 1 })).toEqual(['00', '01', '11'])
  })

  it('orders by code unit, not by the host locale', () => {
    // The failure this catches: sorting with localeCompare and no locale, which
    // orders spaces and punctuation by the host's collation. The row order
    // would then depend on the reader's browser and ICU build — two users
    // comparing the same pair of runs would see the outcome table in different
    // orders, which is the exact instability the sort was added to remove.
    // Hex keys are the case that separates the two orderings: a collator sorts
    // '0xa' before '0xA', code units sort '0xA' first. Vendors disagree about
    // hex casing, and `countsWarnings` already knows hex keys reach this
    // module, so this is a mismatch the panel can actually meet.
    const keys = { '0xA': 1, '0xa': 1, '0x1F': 1, '0x1f': 1 }
    expect(unionKeys(keys, {})).toEqual(['0x1F', '0x1f', '0xA', '0xa'])
    // Equivalently: the engine's own default sort, which is code-unit order and
    // carries no locale with it.
    expect(unionKeys(keys, {})).toEqual(Object.keys(keys).sort())
  })
})

describe('totalVariationDistance', () => {
  it('is exactly 0 for identical histograms', () => {
    const counts = { '00': 512, '11': 512 }
    expect(totalVariationDistance(counts, { ...counts }).value).toBe(0)
  })

  it('is exactly 1 for histograms with disjoint outcomes', () => {
    // The maximum. If the union were not being taken, this would come out 0 —
    // the two histograms share no keys at all.
    expect(totalVariationDistance({ '00': 1000 }, { '11': 1000 }).value).toBe(1)
  })

  it('is unchanged when the two runs have different totals but the same shape', () => {
    // 1000 shots against 500 shots of the same distribution is a distance of
    // zero. Comparing raw counts instead of proportions would report 0.5 here.
    const distance = totalVariationDistance({ '00': 500, '11': 500 }, { '00': 250, '11': 250 })
    expect(distance.value).toBe(0)
  })

  it('counts a missing key as a measured zero', () => {
    // A run that produced '01' 100 times out of 1000 versus a run that never
    // produced it at all is a TVD of 0.1, not an error and not a skipped cell.
    const distance = totalVariationDistance({ '00': 900, '01': 100 }, { '00': 1000 })
    expect(distance.value).toBeCloseTo(0.1, 12)
  })

  it('reports a standard error that shrinks as 1 / sqrt(N)', () => {
    // Without this, a 0.03 distance at 1000 shots and a 0.03 distance at
    // 100000 shots read identically, and only one of them means anything.
    const a = { '00': 60, '11': 40 }
    const b = { '00': 50, '11': 50 }
    const small = totalVariationDistance(a, b)
    const large = totalVariationDistance(scale(a, 4), scale(b, 4))

    expect(large.value).toBeCloseTo(small.value, 12) // same shape, same distance
    expect(large.standardError).toBeCloseTo(small.standardError / 2, 12)
    expect(large.noiseFloor).toBeCloseTo(small.noiseFloor / 2, 12)
  })

  it('does not call two identical histograms distinguishable', () => {
    // The degenerate case the signed delta-method derivative gets wrong: a
    // distance of exactly 0 with a standard error of exactly 0 would satisfy
    // "0 > 2 * 0" and be announced as a real difference.
    const counts = { '00': 512, '11': 512 }
    const distance = totalVariationDistance(counts, { ...counts })
    expect(distance.standardError).toBeGreaterThan(0)
    expect(distance.beyondShotNoise).toBe(false)
  })

  it('calls a one-percent difference noise at 200 shots and signal at 2,000,000', () => {
    // Same measured distance, opposite conclusions — which is the entire point
    // of carrying an error bar around with it.
    const a = { '0': 0.55, '1': 0.45 }
    const b = { '0': 0.45, '1': 0.55 }
    const thin = totalVariationDistance(scale(a, 200), scale(b, 200))
    const thick = totalVariationDistance(scale(a, 2_000_000), scale(b, 2_000_000))

    expect(thin.value).toBeCloseTo(thick.value, 12)
    expect(thin.beyondShotNoise).toBe(false)
    expect(thick.beyondShotNoise).toBe(true)
  })
})

describe('hellingerFidelity', () => {
  it('is exactly 1 for identical histograms', () => {
    const counts = { '00': 400, '01': 100, '11': 524 }
    expect(hellingerFidelity(counts, { ...counts }).value).toBe(1)
  })

  it('is exactly 0 for histograms with disjoint outcomes', () => {
    expect(hellingerFidelity({ '00': 1000 }, { '11': 1000 }).value).toBe(0)
  })

  it('matches the closed form on a hand-checkable pair', () => {
    // p = (1, 0), q = (1/4, 3/4): BC = sqrt(1/4) = 1/2, so F = 1/4. Pinned
    // because the alternative convention (reporting BC itself, or 1 - H) is a
    // plausible edit and would silently change every number on the panel.
    expect(hellingerFidelity({ '0': 1000 }, { '0': 250, '1': 750 }).value).toBeCloseTo(0.25, 12)
  })

  it('stays finite when one run never produced an outcome the other did', () => {
    // The derivative of sqrt(p*q) blows up at p = 0; the variance term it is
    // multiplied by goes to zero at the same rate. If the cancellation is ever
    // refactored away, this comes back NaN.
    const fidelity = hellingerFidelity({ '00': 1000 }, { '00': 900, '01': 100 })
    expect(Number.isFinite(fidelity.value)).toBe(true)
    expect(Number.isFinite(fidelity.standardError)).toBe(true)
    expect(fidelity.standardError).toBeGreaterThan(0)
  })

  it('reports a standard error that shrinks as 1 / sqrt(N), and a floor that shrinks as 1 / N', () => {
    // The two rates are genuinely different and mixing them up would be a real
    // error: the fidelity's standard error is first order (1/sqrt(N)), while
    // the shortfall shot noise alone produces is second order in the deltas
    // and so falls off as 1/N. Quadrupling the shots halves the one and
    // quarters the other.
    const a = { '00': 60, '11': 40 }
    const b = { '00': 50, '11': 50 }
    const small = hellingerFidelity(a, b)
    const large = hellingerFidelity(scale(a, 4), scale(b, 4))

    expect(large.value).toBeCloseTo(small.value, 12)
    expect(large.standardError).toBeCloseTo(small.standardError / 2, 12)
    expect(large.noiseFloor).toBeCloseTo(small.noiseFloor / 4, 12)
  })

  it('does not call two identical histograms distinguishable', () => {
    const counts = { '00': 512, '11': 512 }
    expect(hellingerFidelity(counts, { ...counts }).beyondShotNoise).toBe(false)
  })

  it('reports its error bar as UNUSABLE at the endpoint rather than as zero', () => {
    // dF = 2 * BC * dBC, so the first-order error vanishes when BC is exactly
    // zero. Rendering that as '0.0000 ± 0.0000' would be this panel's strongest
    // possible claim of exactness attached to its least certain number, so the
    // degenerate case is detectable and the component prints words instead.
    const disjoint = hellingerFidelity({ '00': 1000 }, { '11': 1000 })
    expect(disjoint.standardError).toBe(0)
    expect(isDegenerateError(disjoint)).toBe(true)

    const ordinary = hellingerFidelity({ '00': 600, '11': 400 }, { '00': 500, '11': 500 })
    expect(isDegenerateError(ordinary)).toBe(false)
  })
})

describe('bitstringDeltas', () => {
  it('emits a row for an outcome only one run produced', () => {
    // This is the row a hardware engineer is actually looking for: the error
    // outcome that appeared when decoupling was turned off.
    const rows = bitstringDeltas({ '00': 900, '01': 100 }, { '00': 1000 })
    const only = rows.find((r) => r.bitstring === '01')
    expect(only).toBeDefined()
    expect(only?.countB).toBe(0)
    expect(only?.probabilityB).toBe(0)
    expect(only?.delta).toBeCloseTo(0.1, 12)
  })

  it('sorts by the size of the difference, not by bitstring', () => {
    const rows = bitstringDeltas({ '00': 500, '01': 400, '10': 100 }, { '00': 500, '01': 100, '10': 400 })
    expect(rows[0].bitstring === '01' || rows[0].bitstring === '10').toBe(true)
    expect(Math.abs(rows[0].delta)).toBeGreaterThanOrEqual(Math.abs(rows[rows.length - 1].delta))
  })

  it('reports z as null rather than Infinity when the error is zero', () => {
    // Both runs put all their weight on one outcome: the binomial variance is
    // zero, and delta/0 would render as an infinitely significant difference.
    const rows = bitstringDeltas({ '0': 1000 }, { '0': 500 })
    expect(rows[0].z).toBeNull()
    expect(rows[0].beyondShotNoise).toBe(false)
  })

  it('does NOT call two disjoint runs "consistent with shot noise"', () => {
    // The regression this catches, which shipped: for an outcome run A produced
    // on every shot and run B never produced, both binomial variances are
    // exactly zero, so the standard error is 0 and z is null. A rule of
    // `z !== null && |z| > sigma` then returned FALSE for delta = 1.0 — the
    // largest difference this table can hold rendered unbold, under a footnote
    // saying everything unbold is consistent with shot noise.
    const rows = bitstringDeltas({ '00': 1000 }, { '11': 1000 })
    expect(rows.map((r) => r.delta)).toEqual([1, -1])
    expect(rows.every((r) => r.z === null)).toBe(true)
    expect(rows.every((r) => r.beyondShotNoise)).toBe(true)
  })

  it('still calls two saturated runs that AGREE indistinguishable', () => {
    // The other half of the zero-variance case, and the reason the fallback is
    // `delta !== 0` rather than an unconditional true: both runs put all their
    // weight on '0', so there is nothing to report.
    const rows = bitstringDeltas({ '0': 1000 }, { '0': 500 })
    expect(rows[0].standardError).toBe(0)
    expect(rows[0].beyondShotNoise).toBe(false)
  })

  it('flags a difference only when it exceeds the sigma threshold', () => {
    expect(SHOT_NOISE_SIGMA).toBe(2) // lowering this re-labels every comparison
    const noise = bitstringDeltas({ '0': 505, '1': 495 }, { '0': 500, '1': 500 })
    expect(noise.every((r) => r.beyondShotNoise === false)).toBe(true)

    const signal = bitstringDeltas({ '0': 700, '1': 300 }, { '0': 300, '1': 700 })
    expect(signal.every((r) => r.beyondShotNoise === true)).toBe(true)
  })
})

describe('compareExpectationValues', () => {
  it('matches observables by label, never by position', () => {
    // Two submissions can list the same observables in a different order, and
    // matching by index would compare <Z0> against <Z0Z1> and format the wrong
    // answer perfectly.
    const rows = compareExpectationValues(
      [
        { label: 'Z0', value: 0.9, std_error: 0.01 },
        { label: 'Z0Z1', value: 0.5, std_error: 0.01 },
      ],
      [
        { label: 'Z0Z1', value: 0.2, std_error: 0.01 },
        { label: 'Z0', value: 0.8, std_error: 0.01 },
      ],
    )
    const z0 = rows.find((r) => r.label === 'Z0')
    expect(z0?.delta).toBeCloseTo(0.1, 12)
    expect(rows.find((r) => r.label === 'Z0Z1')?.delta).toBeCloseTo(0.3, 12)
  })

  it('drops an observable only one run measured', () => {
    const rows = compareExpectationValues(
      [{ label: 'Z0', value: 0.9, std_error: 0.01 }],
      [{ label: 'X0', value: 0.1, std_error: 0.01 }],
    )
    expect(rows).toEqual([])
  })

  it('says "cannot tell" rather than "not significant" when an error bar is missing', () => {
    // null and false are different claims. A provider that reports no std_error
    // must not have its results silently declared indistinguishable.
    const rows = compareExpectationValues(
      [{ label: 'Z0', value: 0.9, std_error: null }],
      [{ label: 'Z0', value: 0.1, std_error: 0.01 }],
    )
    expect(rows[0].standardError).toBeNull()
    expect(rows[0].beyondShotNoise).toBeNull()
    expect(rows[0].delta).toBeCloseTo(0.8, 12)
  })

  it('says "cannot tell" when the std_error field is ABSENT, not just null', () => {
    // The bug this catches, which shipped: the guard was `x.std_error !== null`,
    // and a field the API omitted arrives as `undefined`, which passes it. The
    // quadrature then produced NaN; `NaN > 0` is false, so the code fell into
    // its "zero error means certainty" branch and declared the difference
    // SIGNIFICANT while rendering '± NaN' beside it. A missing uncertainty
    // fails OPEN into a confident claim — the worst direction available.
    const rows = compareExpectationValues(
      [{ label: 'Z0', value: 0.9 } as never],
      [{ label: 'Z0', value: 0.1, std_error: 0.01 }],
    )
    expect(rows[0].standardError).toBeNull()
    expect(rows[0].beyondShotNoise).toBeNull()
  })

  it('treats a reported error of exactly zero as no error bar, not as certainty', () => {
    // No estimator measures an observable to zero uncertainty in finite shots,
    // so a 0 means the provider did not compute one. Reading it as certainty
    // would let such a run declare every difference significant.
    const rows = compareExpectationValues(
      [{ label: 'Z0', value: 0.9, std_error: 0 }],
      [{ label: 'Z0', value: 0.9000001, std_error: 0 }],
    )
    expect(rows[0].standardError).toBeNull()
    expect(rows[0].beyondShotNoise).toBeNull()
  })

  it('emits one row for a label a run repeats, not two rows that disagree', () => {
    // Nothing stops two observables sharing a name. Two rows claiming the same
    // label with different numbers is a table nobody can read, and in React it
    // is also two children with the same key.
    const rows = compareExpectationValues(
      [
        { label: 'Z0', value: 0.9, std_error: 0.01 },
        { label: 'Z0', value: 0.2, std_error: 0.01 },
      ],
      [{ label: 'Z0', value: 0.8, std_error: 0.01 }],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].valueA).toBe(0.9)
  })

  it('keeps a value of exactly 0 distinct from a missing value', () => {
    // <Z> = 0 is the correct answer for a perfect superposition; treating the
    // falsy 0 as "no value" would erase the most common result in the file.
    const rows = compareExpectationValues(
      [{ label: 'Z0', value: 0, std_error: 0.02 }],
      [{ label: 'Z0', value: null, std_error: 0.02 }],
    )
    expect(rows[0].valueA).toBe(0)
    expect(rows[0].delta).toBeNull()
  })
})

describe('settingsDiff', () => {
  it('puts the settings that differ first, because they are the explanation', () => {
    const diff = settingsDiff(
      run({ optimizationLevel: 1 }),
      run({ optimizationLevel: 3, backend: 'ibm_torino' }),
    )
    const differing = diff.filter((d) => d.differs).map((d) => d.label)
    expect(differing).toContain('Device')
    expect(differing).toContain('Optimisation level')
    expect(diff.slice(0, differing.length).every((d) => d.differs)).toBe(true)
  })

  it('never claims two runs agree on a setting neither of them recorded', () => {
    // The history endpoint does not return decoupling or twirling today.
    // Rendering both as "off" and therefore "same" would be asserting an
    // experimental condition the platform never observed.
    const diff = settingsDiff(run(), run())
    const dd = diff.find((d) => d.label === 'Dynamical decoupling')
    expect(dd?.recorded).toBe(false)
    expect(dd?.a).toBeNull()
    expect(dd?.differs).toBe(false)
  })

  it('compares decoupling once both runs record it', () => {
    const diff = settingsDiff(
      run({ dynamicalDecoupling: true }),
      run({ dynamicalDecoupling: false }),
    )
    const dd = diff.find((d) => d.label === 'Dynamical decoupling')
    expect(dd?.recorded).toBe(true)
    expect(dd?.differs).toBe(true)
    expect([dd?.a, dd?.b]).toEqual(['on', 'off'])
  })

  it('shows returned shots separately from requested shots', () => {
    // A device that returned 900 of 1024 is the explanation for a distance
    // that would otherwise look inexplicable, so it gets its own row.
    const diff = settingsDiff(run({ counts: { '00': 900 } }), run({ counts: { '00': 1024 } }))
    const returned = diff.find((d) => d.label === 'Shots returned')
    expect([returned?.a, returned?.b]).toEqual(['900', '1024'])
    expect(diff.find((d) => d.label === 'Shots requested')?.differs).toBe(false)
  })
})

describe('compareRuns', () => {
  it('normalises by the returned counts even when the stored shot count disagrees', () => {
    // `shots` is what we ASKED for. Here both runs asked for 4096 and returned
    // different totals of the same distribution: the distance is zero, and any
    // implementation that divided by `shots` would not say so.
    const comparison = compareRuns(
      run({ shots: 4096, counts: { '00': 500, '11': 500 } }),
      run({ shots: 4096, counts: { '00': 100, '11': 100 } }),
    )
    expect(comparison.counts?.shotsA).toBe(1000)
    expect(comparison.counts?.shotsB).toBe(200)
    expect(comparison.counts?.totalVariationDistance.value).toBe(0)
  })

  it('refuses to compute a distance when a run has no histogram, and says which', () => {
    // Better than a confident 0 or 1 for a job that simply was never polled.
    const comparison = compareRuns(run(), run({ status: 'error', counts: null, error: 'device offline' }))
    expect(comparison.counts).toBeNull()
    expect(comparison.countsNote).toContain('Run B')
  })

  it('still produces the settings diff when the counts cannot be compared', () => {
    // The settings are the part that is still knowable, and they are often why
    // the second run has no counts at all.
    const comparison = compareRuns(run(), run({ counts: null, backend: 'ionq_aria' }))
    expect(comparison.settings.find((d) => d.label === 'Device')?.differs).toBe(true)
  })

  it('carries a circuit verdict even when neither run stored its QASM', () => {
    // History rows fetched without `include_qasm=1` have `qasm: null`, which is
    // the default. The panel must still be told it cannot verify the premise
    // rather than being handed nothing and rendering as if it could.
    const comparison = compareRuns(run(), run({ backend: 'ionq_aria' }))
    expect(comparison.circuit.same).toBeNull()
    expect(comparison.circuit.note.length).toBeGreaterThan(0)
  })

  it('reports two different circuits as different, not as a device difference', () => {
    const comparison = compareRuns(
      run({ qasm: 'OPENQASM 3;\nh q[0];' }),
      run({ qasm: 'OPENQASM 3;\nx q[0];' }),
    )
    expect(comparison.circuit.same).toBe(false)
  })

  it('counts the union of the outcome sets, not one run\'s', () => {
    const comparison = compareRuns(
      run({ counts: { '00': 500, '01': 500 } }),
      run({ counts: { '00': 500, '10': 500 } }),
    )
    expect(comparison.counts?.outcomes).toBe(3)
  })
})

describe('countsWarnings', () => {
  it('warns when the two runs are keyed at different bit widths', () => {
    // Otherwise a 2-qubit run against a 3-qubit run reports a near-maximal
    // distance that looks like a physics result and is actually a mismatch.
    const warnings = countsWarnings({ '00': 500, '11': 500 }, { '000': 500, '111': 500 })
    expect(warnings.some((w) => w.includes('bitstring widths'))).toBe(true)
  })

  it('warns when one run is stored in hex and the other in binary', () => {
    const warnings = countsWarnings({ '0x0': 500, '0x3': 500 }, { '00': 500, '11': 500 })
    expect(warnings.some((w) => w.includes('hex'))).toBe(true)
  })

  it('warns when one run separates its registers with a space', () => {
    // '0 0' and '00' are different keys here, so the two histograms share no
    // outcomes and the distance reads at its maximum for a formatting reason.
    const warnings = countsWarnings({ '0 0': 500, '1 1': 500 }, { '00': 500, '11': 500 })
    expect(warnings.some((w) => w.includes('space'))).toBe(true)
  })

  it('blames the right run when ONE histogram has inconsistent key lengths', () => {
    // A vendor that keys by integer strips leading zeros, so '001' and '1' are
    // the same outcome stored as two rows. That is a defect inside one
    // histogram; saying "the two runs have different bitstring widths" would
    // send the reader to check which runs they picked instead.
    const warnings = countsWarnings({ '1': 10, '001': 20, '011': 970 }, { '000': 500, '011': 500 })
    expect(warnings.some((w) => w.includes('leading zeros'))).toBe(true)
    expect(warnings.some((w) => w.includes('not reading the same register'))).toBe(false)
  })

  it('is silent for two runs keyed the same way', () => {
    expect(countsWarnings({ '00': 500, '11': 500 }, { '00': 400, '11': 600 })).toEqual([])
  })
})

describe('circuitCheck', () => {
  it('says it CANNOT TELL when the circuit source was not loaded', () => {
    // The most dangerous state on this panel: two unrelated circuits produce a
    // large, well-formed distance, and the settings diff beside it invites the
    // reader to credit it to the optimisation level. Returning `false` here —
    // "the circuits differ" — would be just as wrong as returning `true`.
    expect(circuitCheck(null, 'OPENQASM 3;').same).toBeNull()
    expect(circuitCheck('OPENQASM 3;', null).note).toContain('SAME circuit')
  })

  it('matches the same circuit across two different optimisation levels', () => {
    // `hardware_usage.qasm` stores the circuit AS SUBMITTED, before
    // transpilation, which is the only reason this check is worth anything:
    // the commonest comparison on the panel is one circuit at two
    // optimisation levels, and those two rows are byte-identical.
    const qasm = 'OPENQASM 3;\ninclude "stdgates.inc";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];'
    expect(circuitCheck(qasm, qasm).same).toBe(true)
  })

  it('ignores blank lines and indentation but not an actual gate change', () => {
    const a = 'OPENQASM 3;\nh q[0];\ncx q[0], q[1];'
    const reformatted = '  OPENQASM 3;\n\n\th q[0];\n\ncx q[0], q[1];\n'
    expect(circuitCheck(a, reformatted).same).toBe(true)

    const different = 'OPENQASM 3;\nh q[0];\ncx q[1], q[0];'
    expect(circuitCheck(a, different).same).toBe(false)
  })
})
