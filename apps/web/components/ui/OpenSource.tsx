import { DOCS_URL, REPO_URL } from '@/lib/legal'

/**
 * "Open source, on purpose" — the why, plus the two places to look.
 *
 * Shown on /about, /pricing and /contact. The motivation is the product's
 * reason for existing: knowledge about quantum computing should be reachable
 * by anyone, not gated behind a licence or a lab. Opening the code is how that
 * promise is kept checkable: every claim on the site can be read in the source
 * and in the engineering documentation.
 */
export default function OpenSource({ className = '' }: { className?: string }) {
  return (
    <section className={`card p-6 ${className}`} aria-labelledby="open-source-heading">
      <p className="section-label">Open source, on purpose</p>
      <h2 id="open-source-heading" className="mt-1 text-lg font-bold text-ink">
        Knowledge should be reachable by everyone
      </h2>
      <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-secondary">
        That is the whole motivation behind Qubit16, and it is why the code is open. Quantum
        computing should not be something you need a lab, a licence or a lecturer to get into.
        The simulator, the lessons, the visualizations and the services behind them are all
        public, under the MIT licence, so anyone can learn from them, run them, improve them
        or check them.
      </p>
      <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-secondary">
        Do not take our word for how something works: check the code wherever you need to. The
        engineering documentation explains how it is built, from the physics engine and how it
        is verified against Qiskit to the security model and the deployment pipeline, and the
        source is the final authority.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a href={DOCS_URL} className="btn-primary focus-ring" rel="noopener">
          Read the engineering docs
        </a>
        <a href={REPO_URL} className="btn-ghost focus-ring" rel="noopener">
          Browse the source on GitHub
        </a>
      </div>
    </section>
  )
}
