'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Segmented, ButtonRow, Slider, Stat, Toggle } from '@/components/ui/Controls'
import { Explainer } from '@/components/ui/VizFrame'
import { EvolveLab, CutGraph, operatorPalette } from '@/components/workbench/EvolveLab'
import {
  EVOLVE_LIMITS,
  GRAMMAR,
  PROBLEMS,
  describeProgram,
  evolve,
  getProblem,
  representativeCut,
  type Candidate,
  type EvolutionRun,
  type Generation,
  type ProviderAdapter,
} from '@/lib/workbench/evolve'
import { fetchProviderStatus, remoteProvider, type ProviderStatus } from '@/lib/workbench/evolveClient'

/**
 * /workbench/evolve — Algorithm Evolution.
 *
 * The page owns the configuration and the selection; every number on it
 * comes from lib/workbench/evolve.ts, which runs the evolutionary loop in
 * this tab. Model proposals arrive through lib/workbench/evolveClient.ts →
 * /api/workbench/evolve; with no model configured the built-in mutation
 * operator runs alone and the page says so.
 */

/**
 * A macrotask between generations, so the browser paints the curve and
 * handles the Stop click. setTimeout rather than requestAnimationFrame on
 * purpose: rAF stops in a background tab, and a run the reader tabbed away
 * from should finish, not stall.
 */
const yieldToHost = () => new Promise<void>((resolve) => setTimeout(resolve, 16))

const ACCENT_TEXT: Record<string, string> = {
  inkMuted: 'text-ink-muted',
  sky: 'text-q-sky-text',
  violet: 'text-q-violet-text',
  teal: 'text-q-teal-text',
  rose: 'text-q-rose-text',
  amber: 'text-q-amber-text',
}

function findCandidate(run: EvolutionRun | null, id: string | null): Candidate | null {
  if (!run || !id) return null
  for (const g of run.generations) for (const c of g.population) if (c.id === id) return c
  return null
}

export default function EvolvePage() {
  const [problemId, setProblemId] = useState<string>(PROBLEMS[0]?.id ?? '')
  const [population, setPopulation] = useState(8)
  const [generations, setGenerations] = useState(6)
  const [elites, setElites] = useState(2)
  const [seed, setSeed] = useState(42)
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [run, setRun] = useState<EvolutionRun | null>(null)
  const [running, setRunning] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openGenerations, setOpenGenerations] = useState<Record<number, boolean>>({})
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const stopRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const seedInputId = useId()

  const problem = useMemo(() => getProblem(problemId) ?? PROBLEMS[0], [problemId])

  useEffect(() => {
    const ac = new AbortController()
    fetchProviderStatus(ac.signal).then((s) => {
      setStatus(s)
      setEnabled(Object.fromEntries(s.providers.map((p) => [p.id, true])))
    })
    return () => ac.abort()
  }, [])

  useEffect(() => {
    setElites((e) => Math.min(e, population - 1))
  }, [population])

  useEffect(() => {
    if (!running || startedAt === null) return
    const t = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250)
    return () => clearInterval(t)
  }, [running, startedAt])

  const activeProviders = useMemo(
    () => (status?.providers ?? []).filter((p) => enabled[p.id]),
    [status, enabled],
  )

  const start = useCallback(async () => {
    if (running) return
    stopRef.current = false
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setRun(null)
    setSelectedId(null)
    setOpenGenerations({})
    setStartedAt(Date.now())
    setElapsed(0)
    const providers: ProviderAdapter[] = activeProviders.map((p) => remoteProvider(p, ac.signal))
    try {
      const result = await evolve(
        { problemId: problem.id, populationSize: population, generations, eliteCount: elites, seed },
        providers,
        {
          yieldToHost,
          shouldStop: () => stopRef.current,
          onGeneration: (_g: Generation, r: EvolutionRun) => {
            // A fresh object each time so React re-renders; the arrays inside are the loop's.
            setRun({ ...r, generations: r.generations.slice() })
            setSelectedId(r.best.id)
            setOpenGenerations({ [_g.index]: true })
          },
        },
      )
      setRun({ ...result, generations: result.generations.slice() })
      setSelectedId(result.best.id)
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [running, activeProviders, problem.id, population, generations, elites, seed])

  const stop = useCallback(() => {
    stopRef.current = true
    abortRef.current?.abort()
  }, [])

  const selected = findCandidate(run, selectedId)
  const palette = useMemo(() => operatorPalette(run), [run])
  const lastGen = run ? run.generations[run.generations.length - 1] : null
  const rejectedTotal = run ? run.generations.reduce((s, g) => s + g.rejected.length, 0) : 0
  const providerErrors = run ? run.generations.flatMap((g) => g.providerErrors) : []
  const cutAssignment = useMemo(
    () => (problem.graph && selected ? representativeCut(problem.graph, selected.program) : null),
    [problem, selected],
  )

  const problemOptions = PROBLEMS.map((p) => ({ value: p.id, label: p.title.replace('MaxCut · ', '').replace('Challenge · ', '') }))
  const budgetLabel = `${population} × ${generations + 1} = up to ${population * (generations + 1)} evaluations`

  const controls = (
    <>
      <Segmented label="Problem" value={problem.id} options={problemOptions} onChange={setProblemId} />

      <Slider
        label="Population"
        value={population}
        min={EVOLVE_LIMITS.populationMin}
        max={EVOLVE_LIMITS.populationMax}
        step={1}
        onChange={(v) => setPopulation(Math.round(v))}
        format={(v) => `${Math.round(v)} candidates`}
      />
      <Slider
        label="Generations"
        value={generations}
        min={EVOLVE_LIMITS.generationsMin}
        max={EVOLVE_LIMITS.generationsMax}
        step={1}
        onChange={(v) => setGenerations(Math.round(v))}
        format={(v) => `${Math.round(v)}`}
        hint={budgetLabel}
      />
      <Slider
        label="Elites kept each generation"
        value={elites}
        min={1}
        max={Math.min(EVOLVE_LIMITS.eliteMax, population - 1)}
        step={1}
        onChange={(v) => setElites(Math.round(v))}
        format={(v) => `${Math.round(v)}`}
      />

      <label htmlFor={seedInputId} className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">Seed</span>
        <input
          id={seedInputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={999999}
          step={1}
          value={seed}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) setSeed(Math.max(0, Math.min(999999, Math.floor(v))))
          }}
          className="focus-ring w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink"
        />
        <span className="mt-1 block text-[11px] text-ink-muted">
          Drives the built-in mutation operator. Same seed, same providers, same lineage — model replies are the only non-determinism.
        </span>
      </label>

      <div role="group" aria-label="Proposers" className="rounded-lg border border-line bg-surface-2 p-3">
        <span className="mb-1 block text-[13px] font-semibold text-ink-secondary">Proposers</span>
        <p className="text-[11px] text-ink-muted">
          {status === null
            ? 'Checking which models this deployment can call…'
            : status.providers.length === 0
              ? status.reason === 'tier_off'
                ? 'Model proposals need a signed-in account. The built-in mutation operator still runs.'
                : 'No model provider is configured for your tier. The built-in mutation operator still runs.'
              : 'Each ticked model is asked for up to three programs per generation.'}
        </p>
        {(status?.providers ?? []).map((p) => (
          <Toggle
            key={p.id}
            label={p.label}
            checked={Boolean(enabled[p.id])}
            onChange={(v) => setEnabled((e) => ({ ...e, [p.id]: v }))}
          />
        ))}
        <p className="mt-1 text-[11px] text-ink-secondary">
          Built-in mutation <span className="text-ink-muted">— always on; fills whatever the models do not.</span>
        </p>
      </div>

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={start} disabled={running}>
          {running ? 'Running…' : run ? 'Run again' : 'Run'}
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={stop} disabled={!running}>
          Stop
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2" aria-live="polite">
        <Stat
          label="Generation"
          value={run ? `${lastGen?.index ?? 0} / ${run.config.generations}` : `0 / ${generations}`}
          accent="amber"
        />
        <Stat label="Best fitness" value={run ? run.best.fitness.toFixed(4) : '—'} accent="teal" />
        <Stat label="Rejected" value={run ? String(rejectedTotal) : '—'} accent="rose" />
        <Stat label="Elapsed" value={`${elapsed.toFixed(1)} s`} accent="sky" />
      </div>
    </>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <div className="mb-8">
        <span className="pill border border-q-amber/30 bg-q-amber/15 text-q-amber-text">generate</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Algorithm Evolution</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">
          Several proposers write heuristics for one small optimisation problem in a closed DSL; the
          simulator scores every one, the fittest survive, and the proposers are asked again with the
          survivors in front of them. Quantinuum&rsquo;s Hive loop, cut down to a budget you can watch.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="card overflow-hidden" role="region" aria-labelledby="evolve-canvas-label" tabIndex={-1}>
          <h2 id="evolve-canvas-label" className="sr-only">
            Fitness curve and lineage
          </h2>
          <div className="p-2">
            <EvolveLab run={run} selectedId={selectedId} onSelect={setSelectedId} />
            <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
              Fitness 1.0 is {problem.optimumLabel}. Faded nodes survived unchanged from the previous column; a
              teal ring means the challenge grader passed it. Colours by proposer:{' '}
              {Array.from(palette.entries()).map(([op, key], i) => (
                <span key={op}>
                  {i > 0 ? ', ' : ''}
                  <span className={ACCENT_TEXT[key] ?? 'text-ink-secondary'}>{op}</span>
                </span>
              ))}
              .
            </p>
          </div>
        </section>

        <aside className="card p-4 sm:p-5" aria-labelledby="evolve-controls-label">
          <h2 id="evolve-controls-label" className="section-label mb-4">
            Controls
          </h2>
          <div className="flex flex-col gap-5">{controls}</div>
        </aside>
      </div>

      {/* ── Inspector + lineage list ── */}
      <div className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card p-5" aria-labelledby="evolve-inspect-label">
          <h2 id="evolve-inspect-label" className="section-label mb-3">
            Candidate
          </h2>
          {selected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-mono text-ink">{selected.id}</span>
                <span className={`font-semibold ${ACCENT_TEXT[palette.get(selected.operator) ?? 'violet']}`}>
                  {selected.operator}
                </span>
                <span className="text-ink-muted">generation {selected.generation}</span>
                {selected.parentIds.length > 0 ? (
                  <span className="text-ink-muted">
                    from{' '}
                    {selected.parentIds.map((pid, i) => (
                      <span key={pid}>
                        {i > 0 ? ', ' : ''}
                        <button
                          type="button"
                          className="focus-ring rounded font-mono text-ink-secondary underline decoration-dotted hover:text-ink"
                          onClick={() => setSelectedId(pid)}
                        >
                          {pid}
                        </button>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-ink-muted">hand-written seed</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Fitness" value={selected.fitness.toFixed(4)} accent="teal" />
                <Stat
                  label={selected.program.kind === 'qaoa' ? 'Layers' : selected.program.kind === 'circuit' ? 'Gates' : 'Steps'}
                  value={String(selected.size)}
                  accent="violet"
                />
              </div>
              <p className="text-sm text-ink-secondary">{describeProgram(selected.program)}</p>
              <p className="text-[13px] text-ink-secondary">
                <span className="font-semibold text-ink">Score detail:</span> {selected.detail}
              </p>
              <pre className="code-block" aria-label={`Program text of ${selected.id}`}>
                {selected.text}
              </pre>
              {problem.graph ? (
                <CutGraph
                  graph={problem.graph}
                  assignment={cutAssignment}
                  caption={
                    cutAssignment === null
                      ? `The ${problem.graph.n}-node graph with ${problem.graph.edges.length} edges.`
                      : `The ${problem.graph.n}-node graph with nodes coloured by the selected candidate's split: ` +
                        `${cutAssignment.toString(2).padStart(problem.graph.n, '0').split('').reverse().join('')} read node 0 first; solid edges are cut.`
                  }
                />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              {running ? 'The first generation is being scored…' : 'Run the search, then pick any node in the tree or any row in the list.'}
            </p>
          )}
        </section>

        <section className="card p-5" aria-labelledby="evolve-lineage-label">
          <h2 id="evolve-lineage-label" className="section-label mb-3">
            Generations
          </h2>
          {run ? (
            <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
              {run.generations
                .slice()
                .reverse()
                .map((g) => (
                  <details
                    key={g.index}
                    open={Boolean(openGenerations[g.index])}
                    onToggle={(e) => {
                      const isOpen = (e.currentTarget as HTMLDetailsElement).open
                      setOpenGenerations((o) => (Boolean(o[g.index]) === isOpen ? o : { ...o, [g.index]: isOpen }))
                    }}
                    className="rounded-lg border border-line bg-surface-2"
                  >
                    <summary className="focus-ring cursor-pointer select-none rounded-lg px-3 py-2 text-[13px] font-semibold text-ink-secondary">
                      Generation {g.index}
                      <span className="ml-2 font-mono text-xs text-q-amber-text">best {g.best.fitness.toFixed(4)}</span>
                      <span className="ml-2 text-xs font-normal text-ink-muted">
                        {g.population.length} kept · {g.rejected.length} rejected
                        {g.providerErrors.length ? ` · ${g.providerErrors.length} provider error${g.providerErrors.length === 1 ? '' : 's'}` : ''}
                      </span>
                    </summary>
                    <ul className="space-y-1 px-2 pb-2">
                      {g.population.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            aria-pressed={c.id === selectedId}
                            onClick={() => setSelectedId(c.id)}
                            className={`focus-ring flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-3 ${
                              c.id === selectedId ? 'bg-surface-3 text-ink' : 'text-ink-secondary'
                            }`}
                          >
                            <span className="font-mono">{c.fitness.toFixed(4)}</span>
                            <span className="font-mono text-ink-muted">{c.id}</span>
                            <span className={`font-semibold ${ACCENT_TEXT[palette.get(c.operator) ?? 'violet']}`}>
                              {c.generation < g.index ? 'survivor' : c.operator}
                            </span>
                            {c.verified ? <span className="text-q-teal-text">passes grader</span> : null}
                            <span className="ml-auto truncate font-mono text-[11px] text-ink-muted">
                              {c.text.split('\n').slice(1, 3).join(' · ')}
                              {c.text.split('\n').length > 3 ? ' …' : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {g.rejected.length > 0 ? (
                      <div className="border-t border-line px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Rejected before execution</p>
                        <ul className="mt-1 space-y-1">
                          {g.rejected.map((r, i) => (
                            <li key={i} className="text-[11px] text-ink-secondary">
                              <span className="font-semibold">{r.operator}</span>: {r.reason}
                              <span className="ml-1 font-mono text-ink-muted">
                                — {r.text.replace(/\s+/g, ' ').slice(0, 60)}
                                {r.text.length > 60 ? '…' : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {g.providerErrors.length > 0 ? (
                      <div className="border-t border-line px-3 py-2">
                        <ul className="space-y-1">
                          {g.providerErrors.map((e, i) => (
                            <li key={i} className="text-[11px] text-q-rose-text">
                              {e.provider}: {e.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </details>
                ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Nothing has run yet.</p>
          )}
          {providerErrors.length > 0 && !running ? (
            <p className="mt-3 text-[12px] text-ink-muted">
              {providerErrors.length} provider call{providerErrors.length === 1 ? '' : 's'} failed; the mutation operator filled those slots.
            </p>
          ) : null}
        </section>
      </div>

      {/* ── Prose ── */}
      <div className="mt-10 max-w-3xl">
        <Explainer title="What this tool does">
          <p>
            Pick a problem, set a population and a number of generations, and run. Generation 0 is the
            hand-written seeds plus mutations of them. Every later generation keeps the top few candidates
            unchanged, shows them to each ticked model with the grammar and the scores, and admits whatever
            comes back that parses; the built-in operator — random perturbation of the elites, driven by the seed —
            fills any slot the models leave empty. Every admitted candidate is executed on the statevector
            simulator and scored: for MaxCut, the expected cut of a QAOA state or the cut a local search
            reaches, divided by the brute-forced optimum; for the GHZ challenge, one minus the distance to the
            target distribution, with the real challenge grader confirming a pass.
          </p>
          <p>
            Watch the solid curve: it can only rise, because survivors are kept. Watch the dashed mean: it
            tells you whether the proposals are getting better as a group, or whether one lucky candidate is
            carrying the run. In the tree, a node with many descendants is a heuristic the loop found worth
            varying; a faded node survived without being improved on.
          </p>
        </Explainer>

        <Explainer title="What this tool does not do">
          <p>
            Hive edits real Guppy and CUDA-Q source with a swarm of frontier models and executes it on
            Quantinuum hardware and simulators; the candidates are programs in the ordinary sense. Here a
            candidate is a few lines of a closed DSL — cost and mixer angles, an annealing schedule, a
            local-search recipe, or a short gate list — that this page parses and interprets. No model
            output is ever run as code; a line the grammar does not recognise rejects the candidate, and the
            rejection is listed under its generation. That is the sandbox, and it is also the ceiling: the
            search can find a better schedule, not a new algorithm.
          </p>
          <p>
            The budget is the whole story at this scale. At most {EVOLVE_LIMITS.populationMax} candidates for{' '}
            {EVOLVE_LIMITS.generationsMax} generations on graphs of six or seven nodes, where the optimum is
            known by exhaustion. Fitness 1.0 on these problems is not an achievement; it is the ceiling. The
            point is to see the loop — propose, execute, select, repeat — and to read the lineage of a
            survivor back to the seed it came from.
          </p>
        </Explainer>

        <Explainer title="The grammar every proposer must follow">
          <p>
            Everything a candidate can be is below. Angles are radians and may be written as{' '}
            <code className="font-mono text-ink">pi/4</code>; comments start with{' '}
            <code className="font-mono text-ink">#</code>. This problem accepts {problem.kinds.join(' and ')} programs.
          </p>
          {problem.kinds.map((k) => (
            <pre key={k} className="code-block" aria-label={`${k} grammar`}>
              {GRAMMAR[k]}
            </pre>
          ))}
        </Explainer>

        <Explainer title="Where the physics is checked">
          <p>
            The QAOA interpreter is tested against the closed form for depth-one QAOA on triangle-free graphs:
            on a four-node ring, ⟨C⟩ = 2 + sin 4β · sin 2γ, so γ = π/4, β = π/8 gives exactly three of four
            edges. The XY mixer is checked to conserve Hamming weight, the cost layer to change no probability
            on its own, the local search to gain exactly two edges per flip from the all-zeros split of a ring,
            and the GHZ reference circuit to pass the same grader the challenge page uses. Those tests live in{' '}
            <code className="font-mono text-ink">lib/workbench/evolve.test.ts</code>, next to the tests that
            prove a malformed candidate is rejected before anything runs.
          </p>
        </Explainer>
      </div>
    </div>
  )
}
