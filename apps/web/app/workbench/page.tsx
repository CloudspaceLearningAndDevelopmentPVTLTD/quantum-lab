import Link from 'next/link'

import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchIndexSchemas } from '@/components/seo/schema'
import { WORKBENCH, type WorkbenchAccent, type WorkbenchKind } from '@/lib/workbench'

/**
 * The /workbench index. Everything on it is derived from lib/workbench.ts —
 * the tools are grouped by what they do (generate → train → optimise → run →
 * measure, the order the catalogue is kept in) and each card carries the
 * published result the tool lets you reproduce, which is the reason a
 * developer would pick it over reading the paper.
 */
const KIND_COPY: Record<WorkbenchKind, { label: string; blurb: string }> = {
  generate: {
    label: 'Generate',
    blurb: 'Ask for a circuit and get one that passed a checker, with the failures on the record.',
  },
  train: {
    label: 'Train',
    blurb: 'Train a model in your browser against a hard, exact baseline and watch the gap close.',
  },
  optimise: {
    label: 'Optimise',
    blurb: 'Fit a circuit to a real device topology with fewer two-qubit gates than the heuristic.',
  },
  run: {
    label: 'Run',
    blurb: 'Point an agent at a target and read back the experiment it ran, as a record you can audit.',
  },
  measure: {
    label: 'Measure',
    blurb: 'Put a number on a claim — a mitigated expectation value, a quantum-vs-classical score with its cost.',
  },
}

const KIND_ORDER: readonly WorkbenchKind[] = ['generate', 'train', 'optimise', 'run', 'measure']

const ACCENTS: Record<WorkbenchAccent, { rgb: string; text: string }> = {
  violet: { rgb: 'var(--q-violet-rgb)', text: 'text-q-violet-text' },
  teal: { rgb: 'var(--q-teal-rgb)', text: 'text-q-teal-text' },
  amber: { rgb: 'var(--q-amber-rgb)', text: 'text-q-amber-text' },
  rose: { rgb: 'var(--q-rose-rgb)', text: 'text-q-rose-text' },
  sky: { rgb: 'var(--q-sky-rgb)', text: 'text-q-sky-text' },
}

export default function WorkbenchPage() {
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    tools: WORKBENCH.filter((tool) => tool.kind === kind),
  })).filter((group) => group.tools.length > 0)

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <JsonLd data={workbenchIndexSchemas()} />
      <header className="max-w-2xl">
        <p className="section-label">Workbench</p>
        <h1 className="section-title mt-2 text-3xl md:text-4xl">
          {WORKBENCH.length} AI tools for quantum developers
        </h1>
        <p className="section-desc mt-3">
          The visualizations teach. These produce results: a circuit verified against a
          spec, a decoder you trained, a routing that beat the heuristic, an experiment an
          agent ran and wrote up. Same engines as the course, pointed at your problem.
        </p>
        <p className="section-desc mt-3">
          Most run entirely in your browser — on the exact statevector simulator, or on a
          stabilizer tableau where the circuit is Clifford and the qubits number in the
          thousands. Each one reproduces a published result at demo scale, and says plainly
          where demo scale stops. The generation and experiment tools are also exposed to agents through
          the MCP server at <code className="font-mono">/api/mcp/mcp</code>, documented in{' '}
          <code className="font-mono">docs/MCP.md</code>.
        </p>
      </header>

      {groups.map((group) => {
        const copy = KIND_COPY[group.kind]
        return (
          <section key={group.kind} className="mt-12" aria-labelledby={`workbench-${group.kind}`}>
            <p className="section-label">{copy.label}</p>
            <h2 id={`workbench-${group.kind}`} className="mt-1 text-xl font-bold text-ink">
              {copy.blurb}
            </h2>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.tools.map((tool) => {
                const { rgb, text } = ACCENTS[tool.accent]
                return (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="card card-accent-hover focus-ring flex flex-col p-5 transition-transform duration-200 hover:-translate-y-0.5"
                    style={{ '--card-accent-rgb': rgb } as React.CSSProperties}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-xl text-xl"
                        style={{ backgroundColor: `rgb(${rgb} / 0.15)` }}
                        aria-hidden="true"
                      >
                        {tool.icon}
                      </div>
                      <h3 className="text-base font-bold text-ink">{tool.title}</h3>
                    </div>

                    <p className="mt-3 text-sm text-ink-secondary">{tool.result}</p>

                    <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
                      <span className={`font-semibold ${text}`}>Reproduces</span> {tool.field}
                    </p>
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
