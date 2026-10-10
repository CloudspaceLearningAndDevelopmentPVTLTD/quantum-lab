'use client'

/**
 * RunCompare — put two hardware runs of the same circuit side by side.
 *
 * ── Why this panel exists ───────────────────────────────────────────────────
 *
 * Running a circuit twice and asking what changed is the most common thing a
 * hardware engineer does: a different device, a different optimisation level,
 * decoupling on versus off. Everything needed to answer that is already stored
 * in `hardware_usage` and served by `GET /api/hardware/jobs`, but until this
 * panel the only way to get at it was to download the CSV and do the
 * arithmetic somewhere else — which means most people never did it, and the
 * ones who did compared raw counts and drew the wrong conclusion.
 *
 * The maths lives in `lib/hardware/compare.ts` and is unit-tested there; this
 * file only formats it.
 *
 * ── The two honesty constraints this component carries ──────────────────────
 *
 *  1. NO DISTANCE IS SHOWN WITHOUT ITS UNCERTAINTY. Every distance here is an
 *     estimate from a finite sample, so each is rendered as "value ± standard
 *     error" next to the shot-noise floor, and a difference that does not
 *     clear that floor is labelled as noise in words — not left as a bare
 *     number for the reader to over-interpret. Somebody deciding whether
 *     dynamical decoupling helped will believe whatever this panel implies.
 *
 *  1b. AND NO ERROR BAR IS INVENTED. The delta-method error collapses to
 *     exactly zero at the endpoints — two runs with no outcome in common, for
 *     instance. Printing '± 0.0000' there would read as a claim of exactness
 *     when it is the opposite: the estimator has run out. Those render as "no
 *     usable error bar" instead.
 *
 *  1c. AND THE PANEL SAYS WHEN IT CANNOT CHECK THE CIRCUITS MATCH. Comparing
 *     two unrelated circuits produces a large, well-formed distance with a
 *     settings diff beside it inviting the reader to blame the optimisation
 *     level. The history is therefore loaded WITH the submitted QASM so
 *     `compareRuns` can check, and the verdict is rendered above the metrics.
 *
 *  2. AN UNRECORDED SETTING IS NOT A SETTING OF 'OFF'. The history endpoint
 *     does not return decoupling or twirling yet — `hardware_usage` has no
 *     column for them — so those rows render as "not recorded" and are never
 *     drawn as agreement between the two runs. The rejected alternative was
 *     defaulting them to 'off', which would have made the settings diff look
 *     complete while asserting an experimental condition nobody observed.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { listJobs } from '@/lib/hardware/client'
import {
  COMPARE_DISCLAIMER,
  SHOT_NOISE_SIGMA,
  compareRuns,
  isDegenerateError,
  normaliseCounts,
  type ComparableRun,
  type DistanceEstimate,
} from '@/lib/hardware/compare'
import type { HardwareJobHistoryEntry } from '@/lib/hardware/types'
import { SignInLink } from '@/components/auth/SignInLink'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; jobs: ComparableRun[] }
  | { kind: 'signed-out' }
  | { kind: 'failed'; message: string }

/** How many rows to pull. Two runs are chosen from these; the route caps at 200. */
const PAGE_SIZE = 50

/**
 * How many outcome rows to draw before collapsing the rest.
 *
 * A wide register has 2^n outcomes and the interesting ones are always the
 * largest deltas, which `bitstringDeltas` sorts to the front. The remainder is
 * counted rather than dropped silently — a table that quietly ends at ten rows
 * would let somebody conclude they had seen every difference.
 */
const VISIBLE_DELTAS = 12

export interface RunCompareProps {
  /**
   * Runs to choose between. When omitted the panel loads the account's history
   * itself, which is how `/hardware` uses it; passing them in is for a page
   * that has already fetched the list and does not want a second request.
   */
  jobs?: HardwareJobHistoryEntry[]
}

/** Format a probability as a percentage with one decimal. */
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Format a distance and its error the way every metric here is rendered.
 *
 * A collapsed error is spelled out rather than printed as '± 0.0000'. The
 * rejected alternative was to show the zero: it is what the maths returned, but
 * on screen it reads as "measured exactly", which is the strongest claim this
 * panel could make and the least true one — the first-order error estimate has
 * simply run out at the endpoint. See `isDegenerateError`.
 */
function withError(estimate: DistanceEstimate): string {
  if (isDegenerateError(estimate)) return `${estimate.value.toFixed(4)} (no usable error bar)`
  return `${estimate.value.toFixed(4)} ± ${estimate.standardError.toFixed(4)}`
}

/** A short label for a run in the dropdowns: device, when, and its shot total. */
function runLabel(job: ComparableRun): string {
  const returned = normaliseCounts(job.counts).shots
  const when = new Date(job.submittedAt).toLocaleString('en-US')
  const shots = returned > 0 ? `${returned.toLocaleString('en-US')} shots` : 'no counts'
  const level = job.optimizationLevel !== null ? ` · opt ${job.optimizationLevel}` : ''
  return `${job.backend} · ${when} · ${shots}${level}`
}

export function RunCompare({ jobs: provided }: RunCompareProps) {
  // When the caller supplies the rows, `state` is only ever 'ready' and the
  // rows are read straight off the prop below. Copying them into state instead
  // would re-run on every render in which the parent rebuilt the array — a
  // setState-in-effect loop that is invisible until the parent is refactored.
  const [state, setState] = useState<State>(
    provided ? { kind: 'ready', jobs: [] } : { kind: 'loading' },
  )
  const [idA, setIdA] = useState<string | null>(null)
  const [idB, setIdB] = useState<string | null>(null)
  const [showAllDeltas, setShowAllDeltas] = useState(false)
  const selectA = useId()
  const selectB = useId()

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    // WITH the circuit source. The rejected alternative was the leaner fetch
    // `JobHistory` uses: it halves the body, and it also makes the same-circuit
    // check permanently unanswerable, which would leave the panel confidently
    // measuring the distance between two unrelated circuits. The QASM column is
    // large but this is 50 rows on an explicit user action, not a poll.
    const result = await listJobs(PAGE_SIZE, true)
    if (result.ok) {
      setState({ kind: 'ready', jobs: result.data.jobs })
      return
    }
    // 401 is the signed-out state, not a failure — and it is the normal state
    // for most visitors to this page.
    if (result.status === 401) {
      setState({ kind: 'signed-out' })
      return
    }
    setState({
      kind: 'failed',
      message: result.offline
        ? 'Your job history could not be loaded. The runs themselves are unaffected — they live on the provider.'
        : result.error,
    })
  }, [])

  useEffect(() => {
    if (provided) return
    void load()
  }, [provided, load])

  const jobs: ComparableRun[] = provided ?? (state.kind === 'ready' ? state.jobs : [])

  // Default to the two most recent runs that actually have counts, because a
  // comparison of two runs with no histograms has nothing in it but settings.
  //
  // B falls back to the first run that is not A, rather than to `jobs[1]`: with
  // a history of [no-counts, with-counts] the naive version picked jobs[1] for
  // BOTH sides and the panel opened on "choose two different runs" while
  // showing two selects that already looked different from each other.
  const defaults = useMemo(() => {
    const withCounts = jobs.filter((job) => normaliseCounts(job.counts).shots > 0)
    const a = withCounts[0]?.id ?? jobs[0]?.id ?? null
    const b =
      withCounts.find((job) => job.id !== a)?.id ?? jobs.find((job) => job.id !== a)?.id ?? null
    return { a, b }
  }, [jobs])

  const runA = jobs.find((job) => job.id === (idA ?? defaults.a)) ?? null
  const runB = jobs.find((job) => job.id === (idB ?? defaults.b)) ?? null

  const comparison = useMemo(
    () => (runA && runB && runA.id !== runB.id ? compareRuns(runA, runB) : null),
    [runA, runB],
  )

  if (state.kind === 'loading') {
    return (
      <section aria-labelledby="hw-compare-heading">
        <h2 id="hw-compare-heading" className="text-sm font-bold text-ink">
          Compare two runs
        </h2>
        <p className="mt-3 text-[13px] text-ink-secondary" aria-busy="true">
          Loading your runs…
        </p>
      </section>
    )
  }

  if (state.kind === 'signed-out') {
    return (
      <section aria-labelledby="hw-compare-heading">
        <h2 id="hw-compare-heading" className="text-sm font-bold text-ink">
          Compare two runs
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          <SignInLink /> to compare two hardware runs — the same circuit on two devices, or at two
          optimisation levels, with the distance between their results and how much of it is
          shot noise.
        </p>
      </section>
    )
  }

  if (state.kind === 'failed') {
    return (
      <section aria-labelledby="hw-compare-heading">
        <h2 id="hw-compare-heading" className="text-sm font-bold text-ink">
          Compare two runs
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-q-amber-text">{state.message}</p>
      </section>
    )
  }

  if (jobs.length < 2) {
    return (
      <section aria-labelledby="hw-compare-heading">
        <h2 id="hw-compare-heading" className="text-sm font-bold text-ink">
          Compare two runs
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          Two runs are needed to compare anything. Submit the same circuit again — on another
          device, or at a different optimisation level — and the difference between the two
          results will be measured here.
        </p>
      </section>
    )
  }

  const selectClass =
    'focus-ring w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink-secondary'

  return (
    <section aria-labelledby="hw-compare-heading">
      <h2 id="hw-compare-heading" className="text-sm font-bold text-ink">
        Compare two runs
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
        Pick two runs of the same circuit. The settings that differ are listed first, because
        they are the explanation for the numbers that differ.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={selectA} className="text-[12px] font-semibold text-ink">
            Run A
          </label>
          <select
            id={selectA}
            className={`${selectClass} mt-1`}
            value={runA?.id ?? ''}
            onChange={(e) => setIdA(e.target.value)}
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {runLabel(job)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={selectB} className="text-[12px] font-semibold text-ink">
            Run B
          </label>
          <select
            id={selectB}
            className={`${selectClass} mt-1`}
            value={runB?.id ?? ''}
            onChange={(e) => setIdB(e.target.value)}
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {runLabel(job)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {comparison === null ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          Choose two different runs.
        </p>
      ) : null}

      {comparison ? (
        <>
          {/* Above the metrics, not below them: if these are two different
              circuits then every number underneath is measuring that and not
              the device, and the reader has to know before they read them. */}
          {comparison.circuit.same !== true ? (
            <p
              className={`mt-3 text-[12px] leading-relaxed ${
                comparison.circuit.same === false ? 'text-q-amber-text' : 'text-ink-secondary'
              }`}
            >
              {comparison.circuit.note}
            </p>
          ) : null}

          {comparison.counts ? (
            <div className="card mt-3 p-4">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-[12px] font-semibold text-ink">
                    Total variation distance
                  </dt>
                  <dd className="mt-0.5 font-mono text-[13px] tabular-nums text-q-violet-text">
                    {withError(comparison.counts.totalVariationDistance)}
                  </dd>
                  <dd className="text-[11px] leading-relaxed text-ink-secondary">
                    0 identical, 1 disjoint. Shot-noise floor at these totals:{' '}
                    {comparison.counts.totalVariationDistance.noiseFloor.toFixed(4)}.
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] font-semibold text-ink">Hellinger fidelity</dt>
                  <dd className="mt-0.5 font-mono text-[13px] tabular-nums text-q-violet-text">
                    {withError(comparison.counts.hellingerFidelity)}
                  </dd>
                  <dd className="text-[11px] leading-relaxed text-ink-secondary">
                    1 identical, 0 disjoint. Shot noise alone would cost about{' '}
                    {comparison.counts.hellingerFidelity.noiseFloor.toFixed(4)}.
                  </dd>
                </div>
              </dl>

              <p
                className={`mt-3 text-[12px] leading-relaxed ${
                  comparison.counts.totalVariationDistance.beyondShotNoise
                    ? 'text-q-teal-text'
                    : 'text-q-amber-text'
                }`}
              >
                {comparison.counts.totalVariationDistance.beyondShotNoise
                  ? `These two results differ by more than ${SHOT_NOISE_SIGMA}σ beyond what shot noise alone would produce at ${comparison.counts.shotsA.toLocaleString('en-US')} and ${comparison.counts.shotsB.toLocaleString('en-US')} shots. ${
                      // Only send the reader to the settings when the circuits
                      // are known to match. Otherwise the difference may be the
                      // circuits, and pointing at the optimisation level would
                      // be handing them a cause we have not established.
                      comparison.circuit.same === true
                        ? 'The differing settings below are the place to look.'
                        : 'What caused it cannot be narrowed down until the two runs are known to be the same circuit.'
                    }`
                  : `This difference is within shot noise at ${comparison.counts.shotsA.toLocaleString('en-US')} and ${comparison.counts.shotsB.toLocaleString('en-US')} shots. It is not evidence that the settings below changed anything — more shots would be needed to tell.`}
              </p>

              <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
                {COMPARE_DISCLAIMER}
              </p>

              {comparison.counts.warnings.map((warning) => (
                <p key={warning} className="mt-2 text-[11px] leading-relaxed text-q-amber-text">
                  {warning}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-q-amber-text">
              {comparison.countsNote}
            </p>
          )}

          <h3 className="mt-4 text-[13px] font-bold text-ink">Settings</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-ink-secondary">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-semibold">
                    Setting
                  </th>
                  <th scope="col" className="py-1 pr-3 font-semibold">
                    Run A
                  </th>
                  <th scope="col" className="py-1 font-semibold">
                    Run B
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.settings.map((setting) => (
                  <tr
                    key={setting.label}
                    className={setting.differs ? 'bg-surface-2' : undefined}
                  >
                    <th scope="row" className="py-1 pr-3 font-normal text-ink-secondary">
                      {setting.label}
                    </th>
                    <td
                      className={`py-1 pr-3 font-mono ${
                        setting.differs ? 'font-semibold text-q-violet-text' : 'text-ink'
                      }`}
                    >
                      {/* Not 'off', not '—': a setting nobody wrote down is its
                          own state, and saying so is the whole point. */}
                      {setting.a ?? <span className="font-sans text-ink-secondary">not recorded</span>}
                    </td>
                    <td
                      className={`py-1 font-mono ${
                        setting.differs ? 'font-semibold text-q-violet-text' : 'text-ink'
                      }`}
                    >
                      {setting.b ?? <span className="font-sans text-ink-secondary">not recorded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {comparison.counts ? (
            <>
              <h3 className="mt-4 text-[13px] font-bold text-ink">
                Per-outcome differences
                <span className="ml-2 font-normal text-ink-secondary">
                  {comparison.counts.outcomes} outcome
                  {comparison.counts.outcomes === 1 ? '' : 's'} across both runs
                </span>
              </h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[12px] tabular-nums">
                  <thead className="text-ink-secondary">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Outcome
                      </th>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Run A
                      </th>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Run B
                      </th>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Δ
                      </th>
                      <th scope="col" className="py-1 font-semibold">
                        z
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllDeltas
                      ? comparison.counts.deltas
                      : comparison.counts.deltas.slice(0, VISIBLE_DELTAS)
                    ).map((delta) => (
                      <tr key={delta.bitstring}>
                        <th scope="row" className="py-1 pr-3 font-mono font-normal text-ink">
                          {delta.bitstring}
                        </th>
                        <td className="py-1 pr-3 text-ink-secondary">
                          {pct(delta.probabilityA)}{' '}
                          <span className="text-[11px]">({delta.countA})</span>
                        </td>
                        <td className="py-1 pr-3 text-ink-secondary">
                          {pct(delta.probabilityB)}{' '}
                          <span className="text-[11px]">({delta.countB})</span>
                        </td>
                        <td
                          className={`py-1 pr-3 ${
                            delta.beyondShotNoise ? 'font-semibold text-q-violet-text' : 'text-ink-secondary'
                          }`}
                        >
                          {delta.delta >= 0 ? '+' : '−'}
                          {pct(Math.abs(delta.delta))}
                        </td>
                        <td className="py-1 text-ink-secondary">
                          {/* No z when BOTH runs saturate this outcome — each
                              saw it on every shot or on none — because the
                              binomial variance is then exactly zero and the
                              ratio would render as infinite significance. The Δ
                              beside it is still judged: p = q = 1 is agreement,
                              p = 1 against q = 0 is the largest disagreement
                              the table can hold, and neither is "noise". */}
                          {delta.z === null ? 'n/a' : delta.z.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
                Δ is run A&rsquo;s share minus run B&rsquo;s, each over its own returned shots. A
                bold Δ is more than {SHOT_NOISE_SIGMA} standard errors from zero — or, on a row
                with no z, a difference between two outcomes each run saw on every shot or on
                none. An unbold Δ is consistent with shot noise at these totals, which is not the
                same as being zero. No correction is applied for the number of rows, so with many
                outcomes a few will cross the threshold by chance.
              </p>
              {comparison.counts.deltas.length > VISIBLE_DELTAS ? (
                <button
                  type="button"
                  onClick={() => setShowAllDeltas((shown) => !shown)}
                  className="btn-ghost focus-ring mt-2 text-[12px]"
                >
                  {showAllDeltas
                    ? `Show only the ${VISIBLE_DELTAS} largest`
                    : `Show all ${comparison.counts.deltas.length} outcomes`}
                </button>
              ) : null}
            </>
          ) : null}

          {comparison.expectations.length > 0 ? (
            <>
              <h3 className="mt-4 text-[13px] font-bold text-ink">Expectation values</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[12px] tabular-nums">
                  <thead className="text-ink-secondary">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Observable
                      </th>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Run A
                      </th>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Run B
                      </th>
                      <th scope="col" className="py-1 font-semibold">
                        Δ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.expectations.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className="py-1 pr-3 font-mono font-normal text-ink">
                          {row.label}
                        </th>
                        <td className="py-1 pr-3 text-ink-secondary">
                          {row.valueA === null ? 'n/a' : row.valueA.toFixed(4)}
                        </td>
                        <td className="py-1 pr-3 text-ink-secondary">
                          {row.valueB === null ? 'n/a' : row.valueB.toFixed(4)}
                        </td>
                        <td
                          className={`py-1 ${
                            row.beyondShotNoise ? 'font-semibold text-q-violet-text' : 'text-ink-secondary'
                          }`}
                        >
                          {row.delta === null ? 'n/a' : row.delta.toFixed(4)}
                          {row.standardError !== null
                            ? ` ± ${row.standardError.toFixed(4)}`
                            : ' (no error bar reported)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
                Observables are matched by label, so only the ones both runs measured appear. A
                Δ shown without an error bar cannot be called significant or insignificant —
                the provider reported no uncertainty for it.
              </p>
            </>
          ) : null}

          {comparison.expectationsNote ? (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
              {comparison.expectationsNote}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
