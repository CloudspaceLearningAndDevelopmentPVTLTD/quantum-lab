'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CODE_PRESETS, MAX_CODE_QUBITS, analyseCode, syndromeOf, type CodeAnalysis } from '@/lib/qec/stabilizerCode'

/**
 * /workbench/code-explorer — paste stabilizer generators, get the code.
 *
 * lib/qec/stabilizerCode.ts does the work: validity, [[n, k, d]], logical
 * operators, degeneracy. This page adds the single-error syndrome table, which
 * is the thing you actually look at to see WHY a code has the distance it has.
 *
 * The distance search is exponential and budgeted. When the budget runs out
 * the page shows the bracket the search established, never a point estimate.
 */

const SYNDROME_TABLE_MAX_QUBITS = 18

type Result = { ok: true; analysis: CodeAnalysis; generators: string[] } | { ok: false; error: string }

function run(text: string): Result {
  const generators = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  try {
    return { ok: true, analysis: analyseCode(generators), generators }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Those generators could not be analysed.' }
  }
}

function SyndromeTable({ generators, n }: { generators: string[]; n: number }) {
  const rows = useMemo(() => {
    const table = Array.from({ length: n }, (_, q) =>
      (['X', 'Y', 'Z'] as const).map((p) => syndromeOf(generators, 'I'.repeat(q) + p + 'I'.repeat(n - q - 1))),
    )
    const counts = new Map<string, number>()
    for (const s of table.flat()) counts.set(s, (counts.get(s) ?? 0) + 1)
    return { table, counts }
  }, [generators, n])

  const zero = '0'.repeat(generators.length)
  const cell = (s: string) =>
    s === zero
      ? 'bg-q-rose/15 text-q-rose-text'
      : (rows.counts.get(s) ?? 0) > 1
        ? 'bg-q-amber/15 text-q-amber-text'
        : 'text-ink'

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left font-mono text-[12px]">
        <thead>
          <tr className="text-ink-muted">
            <th scope="col" className="py-1 pr-4 font-sans font-semibold">
              Qubit
            </th>
            {['X error', 'Y error', 'Z error'].map((h) => (
              <th key={h} scope="col" className="py-1 pr-4 font-sans font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.table.map((syndromes, q) => (
            <tr key={q} className="border-t border-line">
              <th scope="row" className="py-1 pr-4 font-normal text-ink-muted">
                {q}
              </th>
              {syndromes.map((s, i) => (
                <td key={i} className="py-1 pr-4">
                  <span className={`rounded px-1 ${cell(s)}`}>{s}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 font-sans text-xs text-ink-muted">
        One bit per generator, in the order you wrote them; 1 means the error anticommutes with it.{' '}
        <span className="rounded bg-q-rose/15 px-1 text-q-rose-text">Rose</span>: the all-zero syndrome — an undetected
        error. <span className="rounded bg-q-amber/15 px-1 text-q-amber-text">Amber</span>: a syndrome shared with
        another single-qubit error.
      </p>
    </div>
  )
}

export default function CodeExplorerPage() {
  const [presetId, setPresetId] = useState(CODE_PRESETS[0].id)
  const [text, setText] = useState(CODE_PRESETS[0].generators.join('\n'))
  const [result, setResult] = useState<Result>(() => run(CODE_PRESETS[0].generators.join('\n')))

  const preset = CODE_PRESETS.find((p) => p.id === presetId)
  const isPresetText = preset ? preset.generators.join('\n') === text.trim() : false

  const choose = (id: string) => {
    const next = CODE_PRESETS.find((p) => p.id === id)
    if (!next) return
    const source = next.generators.join('\n')
    setPresetId(id)
    setText(source)
    setResult(run(source))
  }

  const a = result.ok ? result.analysis : null
  const d = a?.distance ?? null

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <header className="mb-8 max-w-3xl">
        <span className="pill border border-q-violet/30 bg-q-violet/15 text-q-violet-text">measure</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Stabilizer Code Explorer</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          Write down stabilizer generators — one Pauli string per line — and get back what code they define: whether
          they are a valid stabilizer group at all, how many logical qubits they leave (k), the code distance (d), a
          set of logical operators, and the syndrome every single-qubit error produces. Start from a named code, then
          change a generator and watch the parameters move.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="card min-w-0 self-start p-5">
          <label className="text-[13px] font-semibold text-ink-secondary">
            Start from
            <select
              value={presetId}
              onChange={(e) => choose(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              {CODE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {preset ? (
            <p className="mt-2 text-sm text-ink-secondary">
              {preset.note}{' '}
              <a href={preset.zoo} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                Error Correction Zoo entry ↗
              </a>
            </p>
          ) : null}

          <label className="mt-4 block text-[13px] font-semibold text-ink-secondary" htmlFor="generators">
            Stabilizer generators
          </label>
          <textarea
            id="generators"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(20, Math.max(8, text.split('\n').length + 1))}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 p-3 font-mono text-[13px] text-ink"
          />
          <p className="mt-1 text-xs text-ink-muted">
            I, X, Y, Z per qubit (_ also means identity); an optional leading + or −. Up to {MAX_CODE_QUBITS} qubits.
          </p>
          <div className="mt-4">
            <button type="button" onClick={() => setResult(run(text))} className="btn btn-primary">
              Analyse code
            </button>
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          {!result.ok ? (
            <div className="card p-5">
              <p className="text-sm text-q-rose-text" role="alert">
                {result.error}
              </p>
            </div>
          ) : null}

          {a ? (
            <>
              <div className="card p-5" role="status">
                <p className="text-xs text-ink-muted">Code parameters</p>
                <p className="mt-1 font-mono text-4xl font-extrabold text-ink">
                  [[{a.n}, {a.k}, {d ? (d.exact ? d.upper : `${d.lower}–${d.upper}`) : '—'}]]
                </p>
                <p className="mt-2 text-sm text-ink-secondary">
                  {a.n} physical qubits, {a.rank} independent check{a.rank === 1 ? '' : 's'}, so {a.k} logical qubit
                  {a.k === 1 ? '' : 's'}.{' '}
                  {d === null
                    ? 'With no logical qubits this is a stabilizer state, not a code, and distance is not defined.'
                    : d.exact
                      ? `Distance ${d.upper}: detects any error on up to ${d.upper - 1} qubit${d.upper - 1 === 1 ? '' : 's'}, corrects any on up to ${Math.floor((d.upper - 1) / 2)}.`
                      : `The distance search ran out of budget: every Pauli of weight below ${d.lower} was checked and none is a logical operator, and a logical operator of weight ${d.upper} exists. So ${d.lower} ≤ d ≤ ${d.upper}.`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="pill border border-line text-ink-secondary">{a.css ? 'CSS as written' : 'not CSS as written'}</span>
                  {a.degenerate !== null ? (
                    <span className="pill border border-line text-ink-secondary">
                      {a.degenerate ? 'degenerate' : 'non-degenerate'}
                    </span>
                  ) : null}
                  {a.redundant.length > 0 ? (
                    <span className="pill border border-q-amber/40 bg-q-amber/15 text-q-amber-text">
                      {a.redundant.length} redundant generator{a.redundant.length === 1 ? '' : 's'} (line
                      {a.redundant.length === 1 ? '' : 's'} {a.redundant.map((i) => i + 1).join(', ')})
                    </span>
                  ) : null}
                  {isPresetText && preset && d?.exact ? (
                    <span className="pill border border-q-teal/40 bg-q-teal/15 text-q-teal-text">
                      matches the published [[{preset.params.join(', ')}]]
                    </span>
                  ) : null}
                </div>
                {a.degenerate ? (
                  <p className="mt-3 text-sm text-ink-secondary">
                    Degenerate: the lightest stabilizer has weight {a.minStabilizerWeight}, below the distance, so some
                    different low-weight errors act identically on the code and share a syndrome — harmlessly.
                  </p>
                ) : null}
              </div>

              {d ? (
                <div className="card min-w-0 p-5">
                  <h2 className="text-lg font-bold text-ink">Logical operators</h2>
                  <p className="mt-1 text-sm text-ink-secondary">
                    One valid choice: the two operators of a pair anticommute with each other and commute with every
                    other pair and every stabilizer. Multiplying any of them by a stabilizer gives an equally good representative.
                  </p>
                  <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] leading-5 text-ink">
                    {a.logicals.map((l, i) => `X̄${i + 1} = ${l.x}\nZ̄${i + 1} = ${l.z}`).join('\n')}
                  </pre>
                  <p className="mt-3 text-sm text-ink-secondary">
                    A minimum-weight logical operator{d.exact ? '' : ' found so far'}:{' '}
                    <span className="font-mono text-ink">{d.witness}</span> (weight {d.upper}).{' '}
                    <span className="text-ink-muted">{d.searched.toLocaleString('en-US')} Paulis searched.</span>
                  </p>
                </div>
              ) : null}

              {result.ok && a.n <= SYNDROME_TABLE_MAX_QUBITS ? (
                <div className="card min-w-0 p-5">
                  <h2 className="text-lg font-bold text-ink">Syndrome of every single-qubit error</h2>
                  <div className="mt-3">
                    <SyndromeTable generators={result.generators} n={a.n} />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <section className="mt-10 max-w-3xl text-sm text-ink-secondary">
        <h2 className="text-lg font-bold text-ink">How it is computed</h2>
        <p className="mt-2">
          Each Pauli string becomes a 2n-bit vector, and commuting becomes a symplectic inner product over GF(2). The
          number of logical qubits is n minus the rank of the generators; the logical operators are a symplectic basis
          for the Paulis that commute with every generator, modulo the generators themselves. Those steps are exact.
        </p>
        <p className="mt-2">
          The distance is the hard part — computing it is NP-hard in general — so it is found by exhaustive search over
          Paulis of weight 1, 2, 3, … until one commutes with every generator without being a product of them. The
          search is capped at twenty million candidates; past that the page reports the range it has established
          instead of a number.
        </p>
        <p className="mt-2">
          Signs are checked (a generator set whose product is −I is rejected) but do not change n, k or d. To see the
          surface code decoded rather than analysed, open the{' '}
          <Link href="/workbench/decoder-lab" className="underline hover:text-ink">
            Decoder Lab
          </Link>
          ; to run a syndrome-extraction circuit at scale, the{' '}
          <Link href="/workbench/stabilizer" className="underline hover:text-ink">
            Stabilizer Simulator
          </Link>
          .
        </p>
      </section>
    </div>
  )
}
