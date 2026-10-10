/**
 * /runs/{publicId} — the public, citable record of one hardware run.
 *
 * ── What this page promises ─────────────────────────────────────────────────
 *
 * That the thing at this URL does not change, and that anyone can read it
 * without an account. Both are what make it worth putting in a paper, and both
 * are enforced below the page: `supabase/schema-runs.sql` rejects every UPDATE
 * except `withdrawn_at`, and this page reads the `published_runs_public` view
 * with the ANON key — not the service role — so an unauthenticated reader
 * resolving the link is the normal path rather than a special case.
 *
 * ── The honesty this page has to carry ──────────────────────────────────────
 *
 * Two things are easy to render in a way that quietly overclaims, and both are
 * handled explicitly rather than by omission:
 *
 *  1. CALIBRATION. Nothing in the pipeline captures the device's calibration
 *     against a job yet, so every snapshot built today carries null. A page
 *     that simply left the section out would read as "nothing to report". It
 *     renders `NO_CALIBRATION_NOTICE` instead, which says what is missing and
 *     what that costs the reader — this is a repeatable record, not yet a
 *     reproducible one.
 *  2. `source` INSIDE a calibration, when one is present. 'static' means the
 *     vendor's published TYPICAL values — a catalogue entry, not a measurement
 *     of this device on this day. It is shown verbatim.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import {
  NO_CALIBRATION_NOTICE,
  runBibtex,
  runPermalinkUrl,
  toPublishedRunSnapshot,
  type PublishedRunSnapshot,
} from '@/lib/hardware/permalink'
import { CopyCitation } from '@/components/hardware/CopyCitation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Where the canonical link points. Falls back to the production origin. */
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://qubit16.ai'

/**
 * Load one published run, or null.
 *
 * Reads the VIEW, not the table. The view is what excludes withdrawn rows and
 * the private columns (`owner_id`, `source_id`), so reading it with the anon
 * key is safe by construction rather than by remembering to filter here.
 *
 * @param publicId The id from the URL.
 * @returns The snapshot, or null when there is nothing to show.
 */
async function loadRun(publicId: string): Promise<PublishedRunSnapshot | null> {
  if (!isSupabaseConfigured) return null
  const supabase = getSupabase()
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('published_runs_public')
      .select('*')
      .eq('public_id', publicId)
      .limit(1)
    if (error) return null
    const row = Array.isArray(data) ? data[0] : null
    return row ? toPublishedRunSnapshot(row) : null
  } catch {
    return null
  }
}

export async function generateMetadata(props: {
  params: Promise<{ publicId: string }>
}): Promise<Metadata> {
  const { publicId } = await props.params
  const run = await loadRun(publicId)
  if (!run) return { title: 'Run not found' }
  const title = run.title ?? `${run.backend} · ${run.shots.toLocaleString('en-US')} shots`
  return {
    title: `${title} — qubit16 run record`,
    description:
      `A quantum hardware run on ${run.backend}: the circuit, the measured counts and the ` +
      'compilation settings, published as a permanent record.',
    alternates: { canonical: runPermalinkUrl(SITE_ORIGIN, publicId) },
  }
}

export default async function PublishedRunPage(props: {
  params: Promise<{ publicId: string }>
}) {
  const { publicId } = await props.params
  const run = await loadRun(publicId)
  if (!run) notFound()

  const url = runPermalinkUrl(SITE_ORIGIN, publicId)
  const total = run.counts ? Object.values(run.counts).reduce((a, b) => a + b, 0) : 0
  // Sorted by bitstring, not by count: a reader comparing two records needs
  // the same row in the same place, and `Object.entries` puts integer-like
  // keys ('11') ahead of non-integer ones ('00') for no useful reason.
  const outcomes = run.counts
    ? Object.entries(run.counts).sort((a, b) => a[0].localeCompare(b[0]))
    : []

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header>
        <p className="section-label">Run record</p>
        <h1 className="section-title mt-2 text-2xl md:text-3xl">
          {run.title ?? `${run.backend} · ${run.shots.toLocaleString('en-US')} shots`}
        </h1>
        {run.attribution ? (
          <p className="mt-2 text-[13px] text-ink-secondary">{run.attribution}</p>
        ) : null}
        <p className="mt-3 font-mono text-[12px] text-ink-muted">{url}</p>
      </header>

      {run.notes ? (
        <p className="mt-6 max-w-prose whitespace-pre-wrap text-[14px] leading-relaxed text-ink-secondary">
          {run.notes}
        </p>
      ) : null}

      <section className="mt-8" aria-labelledby="run-facts">
        <h2 id="run-facts" className="text-sm font-bold text-ink">
          What ran
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
          <Fact label="Device" value={run.backend} />
          <Fact label="Provider" value={run.provider ?? '—'} />
          <Fact label="Shots" value={run.shots.toLocaleString('en-US')} />
          <Fact label="Status" value={run.status} />
          <Fact
            label="Optimisation"
            value={
              run.compilation.optimizationLevel === null
                ? 'not recorded'
                : String(run.compilation.optimizationLevel)
            }
          />
          <Fact
            label="Two-qubit gates"
            value={
              run.compilation.transpiledTwoQubitGates === null
                ? 'not recorded'
                : String(run.compilation.transpiledTwoQubitGates)
            }
          />
          <Fact
            label="QPU time"
            value={run.qpuSeconds === null ? 'not recorded' : `${run.qpuSeconds.toFixed(3)} s`}
          />
          <Fact label="Submitted" value={new Date(run.submittedAt).toUTCString()} />
          <Fact
            label="Completed"
            value={run.completedAt ? new Date(run.completedAt).toUTCString() : 'not recorded'}
          />
        </dl>
      </section>

      {/*
        Rendered whether or not there is a calibration. See the header: an
        omitted section reads as "nothing to report", and what this actually
        means is "this record is repeatable but not yet reproducible".
      */}
      <section className="mt-8" aria-labelledby="run-calibration">
        <h2 id="run-calibration" className="text-sm font-bold text-ink">
          Device calibration
        </h2>
        {run.calibration ? (
          <>
            <p className="mt-2 text-[13px] text-ink-secondary">
              Source: <span className="font-mono text-ink">{run.calibration.source}</span>
              {run.calibration.source === 'static'
                ? ' — the vendor’s published typical values, not a measurement of this device on this day.'
                : null}
              {run.calibrationCapturedAt
                ? ` Captured ${new Date(run.calibrationCapturedAt).toUTCString()}.`
                : null}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
              <Fact label="1Q error" value={fmt(run.calibration.median_1q_error)} />
              <Fact label="2Q error" value={fmt(run.calibration.median_2q_error)} />
              <Fact label="T1" value={fmt(run.calibration.median_t1_us, ' µs')} />
              <Fact label="T2" value={fmt(run.calibration.median_t2_us, ' µs')} />
            </dl>
          </>
        ) : (
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-q-amber-text">
            {NO_CALIBRATION_NOTICE}
          </p>
        )}
      </section>

      {outcomes.length > 0 ? (
        <section className="mt-8" aria-labelledby="run-counts">
          <h2 id="run-counts" className="text-sm font-bold text-ink">
            Measured counts
          </h2>
          <p className="mt-1 text-[12px] text-ink-muted">
            {total.toLocaleString('en-US')} shots returned
            {total !== run.shots ? ` of ${run.shots.toLocaleString('en-US')} requested` : ''}.
          </p>
          <div className="scroll-x mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className="border-b border-hairline py-1 text-left font-semibold">Bitstring</th>
                  <th className="border-b border-hairline py-1 text-right font-semibold">Count</th>
                  <th className="border-b border-hairline py-1 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map(([bits, count]) => (
                  <tr key={bits}>
                    <td className="py-1 font-mono">{bits}</td>
                    <td className="py-1 text-right tabular-nums">{count.toLocaleString('en-US')}</td>
                    <td className="py-1 text-right tabular-nums text-ink-secondary">
                      {total ? `${((count / total) * 100).toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {run.error ? (
        <section className="mt-8" aria-labelledby="run-error">
          <h2 id="run-error" className="text-sm font-bold text-ink">
            What the device reported
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-q-rose-text">
            {run.error}
          </p>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="run-circuit">
        <h2 id="run-circuit" className="text-sm font-bold text-ink">
          The circuit
        </h2>
        <p className="mt-1 text-[12px] text-ink-muted">
          OpenQASM exactly as submitted.
        </p>
        <pre className="code-block mt-3 max-h-96 overflow-auto text-[12px]">{run.qasm}</pre>
      </section>

      <section className="mt-8" aria-labelledby="run-cite">
        <h2 id="run-cite" className="text-sm font-bold text-ink">
          Cite this run
        </h2>
        <CopyCitation bibtex={runBibtex(run, url)} url={url} />
      </section>

      <footer className="mt-12 border-t border-hairline pt-5 text-[12px] leading-relaxed text-ink-muted">
        Published from{' '}
        <Link href="/hardware" className="text-primary underline">
          qubit16
        </Link>
        . The record is immutable — it can be withdrawn by its owner, but not edited.
      </footer>
    </div>
  )
}

/**
 * One label/value pair.
 *
 * @param props The label and the already-formatted value.
 * @returns The pair.
 */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="font-mono text-ink">{value}</dd>
    </div>
  )
}

/**
 * Format a nullable number, distinguishing absent from zero.
 *
 * @param value The figure.
 * @param suffix Unit to append.
 * @returns The formatted figure, or "not recorded".
 */
function fmt(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return 'not recorded'
  return `${value}${suffix}`
}
