'use client'

import Link from 'next/link'
import RunPaperLab, { RunPaperExplainers } from '@/components/workbench/RunPaperLab'

/**
 * /workbench/run-paper — landmark quantum papers, executed on this site's
 * own simulator instead of just described.
 *
 * The lab is a client component (paper selection is local UI state); the
 * page is the shell around it, matching every other /workbench/* route.
 */
export default function RunPaperPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <div className="mb-8">
        <span className="pill border border-q-sky/30 bg-q-sky/15 text-q-sky-text">Run</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Run This Paper</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">
          Pick a landmark result — teleportation, superdense coding, Grover’s search, the GHZ paradox, BB84, E91 — and
          run the paper’s own protocol on the simulator, live, next to what the paper itself reported.
        </p>
      </div>

      <RunPaperLab />

      <div className="mt-10 max-w-3xl">
        <RunPaperExplainers />
      </div>
    </div>
  )
}
