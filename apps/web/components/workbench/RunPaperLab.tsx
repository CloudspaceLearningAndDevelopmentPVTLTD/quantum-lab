'use client'

/**
 * RunPaperLab — pick a landmark paper, run its own protocol on this site's
 * simulator, and see the reproduction next to what the paper reported.
 *
 * Every run is synchronous and cheap (at most a few thousand simulated BB84/
 * E91 events, or a handful of small-circuit executions), so there is no
 * async/progress state to manage — picking a paper runs it immediately.
 * The physics itself lives in lib/workbench/papers.ts; this file is layout.
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Stat } from '@/components/ui/Controls'
import { PAPERS, type Paper, type PaperRunResult } from '@/lib/workbench/papers'
import { CONTACT_EMAIL } from '@/lib/legal'

const SUGGEST_PAPER_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  'Paper suggestion for Run This Paper',
)}&body=${encodeURIComponent(
  'Paper title and year:\nAuthors:\nLink (arXiv / journal / DOI):\n\nWhy this one — what result should the reproduction show?\n',
)}`

function runOf(paper: Paper): PaperRunResult {
  return paper.run(20260905)
}

export default function RunPaperLab() {
  const [selectedId, setSelectedId] = useState(PAPERS[0].id)
  const selected = useMemo(() => PAPERS.find((p) => p.id === selectedId) ?? PAPERS[0], [selectedId])
  const result = useMemo(() => runOf(selected), [selected])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div role="tablist" aria-label="Paper" className="flex flex-col gap-2">
        {PAPERS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === selectedId}
            onClick={() => setSelectedId(p.id)}
            className={`focus-ring rounded-lg border px-3 py-2.5 text-left transition-colors ${
              p.id === selectedId
                ? 'border-q-violet/50 bg-q-violet/10'
                : 'border-line bg-surface-2 hover:bg-surface-3'
            }`}
          >
            <div className="text-[13px] font-semibold leading-snug">{p.title}</div>
            <div className="mt-0.5 text-xs text-ink-muted">
              {p.authors.split(',')[0]}
              {p.authors.includes(',') ? ' et al.' : ''} · {p.year}
            </div>
          </button>
        ))}
      </div>

      <div className="min-w-0">
        <div className="rounded-xl border border-line bg-surface-2 p-4 sm:p-5">
          <h2 className="text-lg font-bold leading-snug">{selected.title}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{selected.authors}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {selected.venue}
            {selected.arxivId ? (
              <>
                {' · '}
                <a
                  href={`https://arxiv.org/abs/${selected.arxivId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-ink-secondary"
                >
                  arXiv:{selected.arxivId}
                </a>
              </>
            ) : null}
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">The claim</div>
              <p className="mt-1 text-[14px] text-ink-secondary">{selected.claim}</p>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">What the paper reported</div>
              <p className="mt-1 text-[14px] text-ink-secondary">{selected.historicalResult}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              Reproduced on this site’s {selected.qubits}-qubit simulator
            </div>
            <span
              className={`pill text-[11px] ${
                result.consistent
                  ? 'border border-q-teal/30 bg-q-teal/15 text-q-teal-text'
                  : 'border border-q-rose/30 bg-q-rose/15 text-q-rose-text'
              }`}
            >
              {result.consistent ? 'Matches the paper' : 'Did not match — see numbers'}
            </span>
          </div>
          <p className="mt-2 text-[15px] font-semibold">{result.summary}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {result.details.map((d) => (
              <Stat key={d.label} label={d.label} value={d.value} accent="violet" />
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              Want to run something of your own?
            </div>
            <p className="mt-1.5 text-[13px] text-ink-secondary">
              This list is curated, not a general paper executor — see why below. To run a circuit you design
              yourself, right now, no waiting on a review, use Verified Circuit Generation instead: describe a
              target and get a circuit checked against it.
            </p>
            <Link href="/workbench/generate" className="btn-ghost focus-ring mt-3 self-start text-[13px]">
              Verified Circuit Generation →
            </Link>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              Know a paper that belongs here?
            </div>
            <p className="mt-1.5 text-[13px] text-ink-secondary">
              Suggestions go to a person, not an auto-runner — every entry here is added by hand, backed by an
              existing tested circuit or protocol, and checked against the primary source before it ships.
            </p>
            <a href={SUGGEST_PAPER_HREF} className="btn-ghost focus-ring mt-3 self-start text-[13px]">
              Suggest a paper →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export function RunPaperExplainers() {
  return (
    <div className="space-y-3 text-[14px] text-ink-secondary">
      <p>
        Each of these papers changed what people thought was possible with quantum information. The circuit or
        protocol on this page is not a re-enactment or an animation — it is the paper’s own construction, executed on
        the statevector simulator that runs the rest of this site, with the same code paths already covered by tests
        elsewhere in the codebase: BB84 and E91 in <code>lib/viz/qkd.ts</code>; teleportation, superdense coding, GHZ
        and Grover as presets in <code>lib/quantum.ts</code>; the oracle circuit behind Deutsch–Jozsa in{' '}
        <code>lib/viz/deutschJozsa.ts</code>; the exact CHSH correlation behind the Bell test in{' '}
        <code>lib/viz/chsh.ts</code>; phase estimation in <code>lib/viz/phaseEstimation.ts</code>; Shor’s
        period-finding subroutine in <code>components/viz/shor/period.ts</code>; the real surface-code lattice and
        decoder in <code>components/viz/surface/code.ts</code>; and two-qubit state reconstruction in{' '}
        <code>lib/quantum/tomography.ts</code>.
      </p>
      <p>
        This is a curated set, not a general arXiv-URL executor: turning an arbitrary paper into a runnable circuit
        without risking a wrong citation or a wrong simulation is a much larger project than a handful of landmark
        results. Every citation above was checked against a primary source (the journal’s own page, or the original
        arXiv preprint where one exists — arXiv itself only opened in 1991, so several of these predate it). Growing
        this list happens the same way each entry already here was built — by hand, never by auto-running a
        suggestion — so a request to add one goes to a person first.
      </p>
    </div>
  )
}
