/**
 * /benchmark — published agent pass rates on the challenge set.
 *
 * The credibility play: instead of saying "AI agents work well with Quantum
 * Lab", publish what a named model actually scored against the real grader,
 * with the methodology one click away. The page renders
 * `results/agent-bench.json` IF an operator has produced one with
 * `scripts/agent-bench.mjs` — and when none exists it says so plainly and
 * explains how to make one. There is NO sample data on this page, fabricated
 * or otherwise: an empty state that ships empty is the whole point, because a
 * benchmark page you cannot trust to be real is worse than no page.
 *
 * Server component on purpose: the file read happens on the server, and
 * `force-dynamic` keeps it a request-time read so dropping a fresh results
 * file onto the box shows up without a rebuild. `BenchmarkView` is exported
 * separately so the empty state and the table render are unit-testable
 * without a filesystem (lib/bench/benchmark-page.test.ts).
 */

import type { Metadata } from 'next'

import { loadBenchResults, type BenchRunView } from '@/lib/bench/results'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Agent Benchmark',
  description:
    'Real, graded pass rates for AI agents on the Qubit16 challenge set — produced by an open harness against the same grader the app uses.',
  path: '/benchmark',
})

export const dynamic = 'force-dynamic'

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

function RunCard({ run }: { run: BenchRunView }) {
  const kinds = Object.entries(run.aggregate.byKind)
  return (
    <article className="rounded-card border border-line bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-base font-bold text-ink">{run.model}</h2>
        <span className="text-xs text-ink-muted">
          {run.date.slice(0, 10)}
          {run.promptVersion !== null ? ` · prompt v${run.promptVersion}` : ''}
          {run.attemptsPerChallenge !== null ? ` · ≤${run.attemptsPerChallenge} attempts` : ''}
        </span>
      </div>

      <p className="mt-3 text-sm text-ink-secondary">
        <span className="text-2xl font-bold text-ink">{pct(run.aggregate.passRate)}</span>{' '}
        overall ({run.aggregate.passed} of {run.aggregate.total} challenges
        {run.catalogueCount !== null && run.generatedCount !== null
          ? `: ${run.catalogueCount} catalogue + ${run.generatedCount} generated`
          : ''}
        ), {pct(run.aggregate.firstTryPassRate)} on the first attempt.
      </p>

      {kinds.length > 0 ? (
        // Wide content scrolls inside its own container; the page never does.
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="py-2 pr-4 font-semibold">Challenge kind</th>
                <th className="py-2 pr-4 font-semibold">Passed</th>
                <th className="py-2 font-semibold">Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map(([kind, stat]) => (
                <tr key={kind} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-4 font-mono text-xs text-ink">{kind}</td>
                  <td className="py-2 pr-4 text-ink-secondary">
                    {stat.passed}/{stat.total}
                  </td>
                  <td className="py-2 font-semibold text-ink">{pct(stat.passRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  )
}

/** Presentational half, exported for tests. `runs === null` = no results file. */
export function BenchmarkView({ runs }: { runs: BenchRunView[] | null }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header>
        <span className="section-label">Benchmark</span>
        <h1 className="section-title mt-2">Agents vs. the challenge set</h1>
        <p className="section-desc mt-3 max-w-2xl">
          Qubit16 exposes its challenges and grader over MCP, so AI agents can attempt them
          the same way learners do. This page publishes what named models actually score — every
          number below came out of the same deterministic grader the app uses, produced by an
          open harness anyone can re-run. Methodology, the exact prompt, and what a pass means:{' '}
          <code className="font-mono text-xs">docs/BENCHMARK.md</code>.
        </p>
      </header>

      {runs === null ? (
        <section className="mt-10 rounded-card border border-line bg-surface p-6">
          <h2 className="text-base font-bold text-ink">No benchmark results yet</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            This deployment has no <code className="font-mono text-xs">results/agent-bench.json</code>,
            so there is nothing to show — and nothing invented to show instead. Pass rates on this
            page are only worth publishing because they are real: a model either produced a circuit
            the grader passed, or it did not.
          </p>
          <p className="mt-3 text-sm text-ink-secondary">To produce a run, from the repo root:</p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-ink">
            {'ANTHROPIC_API_KEY=sk-ant-... node scripts/agent-bench.mjs --model <model-id>'}
          </pre>
          <p className="mt-3 text-sm text-ink-secondary">
            The harness presents every catalogue challenge (plus seeded generated ones) to the
            model with a fixed prompt, allows at most two attempts, grades each answer with the
            real grader, and writes the results file this page renders.
          </p>
        </section>
      ) : (
        <section className="mt-10 space-y-6">
          {runs.map((run) => (
            <RunCard key={`${run.model}-${run.date}`} run={run} />
          ))}
          <p className="text-xs text-ink-muted">
            Runs are listed newest first. Results at different prompt versions are not directly
            comparable; see <code className="font-mono">docs/BENCHMARK.md</code> for how to submit
            a run.
          </p>
        </section>
      )}
    </div>
  )
}

export default function BenchmarkPage() {
  return <BenchmarkView runs={loadBenchResults()} />
}
