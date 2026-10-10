'use client'

/**
 * /circuits — your saved circuit library, plus the built-in presets so the page
 * is useful even before you have saved anything.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import AuthPanel from '@/components/auth/AuthPanel'
import { announce } from '@/lib/a11y/announce'
import {
  deleteCircuit,
  listCircuits,
  relativeTime,
  type SavedCircuit,
} from '@/lib/circuit-store'
import { buildShareUrl, encodeCircuit } from '@/lib/share-link'
import { downloadNotebook, type NotebookVariant } from '@/lib/export/notebook'
import { PRESETS, fromQasm, type Circuit } from '@/lib/quantum'

function gateCount(qasm: string): number {
  try {
    return fromQasm(qasm).ops.length
  } catch {
    return 0
  }
}

export default function CircuitsPage() {
  const [items, setItems] = useState<SavedCircuit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await listCircuits())
      setError(null)
    } catch {
      setError('Could not load your circuit library.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCopy = useCallback(async (item: SavedCircuit) => {
    const url = buildShareUrl(fromQasm(item.qasm))
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(item.id)
      // The button's label flips to "Copied ✓" while it still holds focus,
      // which assistive tech does not reliably re-read.
      announce(`Share link for ${item.name} copied to the clipboard.`)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // Clipboard unavailable — the "Open in simulator" link carries the same circuit.
      setCopiedId(null)
    }
  }, [])

  const handleDelete = useCallback(
    async (item: SavedCircuit) => {
      if (confirmId !== item.id) {
        setConfirmId(item.id)
        /*
         * A11Y (WCAG 3.3.4 / 4.1.3). This is a two-press confirm on a
         * destructive, irreversible action, and the ONLY signal that the first
         * press armed it used to be the button's visible text changing from "✕"
         * to "Sure?" — which nothing announced, and which the static
         * `aria-label="Delete <name>"` actively masked, since aria-label wins
         * over content. A screen-reader user pressed a button labelled "Delete
         * Bell state", heard nothing at all, pressed it again to see if it had
         * worked, and destroyed the circuit. The label below is now derived
         * from the state; this says the same thing out loud, and names the
         * 3-second window, because the arming silently expires.
         */
        announce(`Delete ${item.name}? Press the button again within 3 seconds to confirm.`)
        window.setTimeout(
          () => setConfirmId((current) => (current === item.id ? null : current)),
          3000
        )
        return
      }
      setConfirmId(null)
      await deleteCircuit(item.id)
      await refresh()
      announce(`${item.name} deleted.`)
    },
    [confirmId, refresh]
  )

  const handleExport = useCallback((circuit: Circuit, variant: NotebookVariant, name: string) => {
    downloadNotebook(circuit, variant, name)
    announce(`${variant === 'qiskit' ? 'Qiskit' : 'PennyLane'} notebook for ${name} downloaded.`)
  }, [])

  const presetTiles = useMemo(
    () => PRESETS.map((p) => ({ ...p, token: encodeCircuit(p.circuit) })),
    []
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-7">
        <p className="section-label">Library</p>
        <h1 className="section-title mt-1">Saved Circuits</h1>
        <p className="section-desc mt-2">
          Everything you have saved, plus a shelf of classics to start from.
        </p>
      </header>

      <AuthPanel />

      <section className="mt-6">
        <h2 className="mb-3 text-[13px] font-semibold text-ink-secondary">Your circuits</h2>
        {/* A load failure is an error, not a status: it needs to interrupt. */}
        {error ? (
          <p className="mb-3 text-sm text-q-rose-text" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : items.length === 0 ? (
          <div className="card p-6 text-sm text-ink-secondary">
            Nothing saved yet.{' '}
            <Link href="/simulator" className="text-q-violet-text underline underline-offset-2">
              Build a circuit in the simulator
            </Link>{' '}
            and hit Save.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="card card-hover flex flex-col p-5">
                <h3 className="text-sm font-semibold text-ink">{item.name}</h3>
                <p className="mt-1 flex-1 text-[13px] text-ink-secondary">
                  {item.description ?? 'No description.'}
                </p>
                <p className="mt-2 text-[11px] text-ink-muted">
                  {item.numQubits} qubit{item.numQubits === 1 ? '' : 's'} ·{' '}
                  {gateCount(item.qasm)} gates · saved {relativeTime(item.updatedAt)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/simulator?c=${encodeCircuit(fromQasm(item.qasm))}`}
                    className="btn-primary focus-ring !px-3 !py-1"
                  >
                    Open in simulator
                  </Link>
                  <button
                    type="button"
                    className="btn-ghost focus-ring !px-3 !py-1"
                    onClick={() => void handleCopy(item)}
                  >
                    {copiedId === item.id ? 'Copied ✓' : 'Copy link'}
                  </button>
                  {/* Notebook export is built client-side from the saved QASM —
                      no server round trip, works in local-storage mode too. */}
                  <button
                    type="button"
                    className="btn-ghost focus-ring !px-3 !py-1"
                    aria-label={`Export ${item.name} as a Qiskit notebook`}
                    onClick={() => handleExport(fromQasm(item.qasm), 'qiskit', item.name)}
                  >
                    Qiskit .ipynb
                  </button>
                  <button
                    type="button"
                    className="btn-ghost focus-ring !px-3 !py-1"
                    aria-label={`Export ${item.name} as a PennyLane notebook`}
                    onClick={() => handleExport(fromQasm(item.qasm), 'pennylane', item.name)}
                  >
                    PennyLane .ipynb
                  </button>
                  <button
                    type="button"
                    aria-label={
                      confirmId === item.id
                        ? `Confirm deleting ${item.name}. This cannot be undone.`
                        : `Delete ${item.name}`
                    }
                    className="focus-ring rounded-lg border border-line px-2.5 py-1 text-xs text-ink-secondary hover:border-line-strong hover:text-q-rose-text"
                    onClick={() => void handleDelete(item)}
                  >
                    {confirmId === item.id ? 'Sure?' : '✕'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[13px] font-semibold text-ink-secondary">Built-in presets</h2>
        <p className="mb-3 text-[13px] text-ink-muted">
          Canonical circuits — open one, then tweak it and save your own version.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {presetTiles.map((preset) => (
            <article key={preset.id} className="card card-hover flex flex-col p-5">
              <h3 className="text-sm font-semibold text-ink">{preset.name}</h3>
              <p className="mt-1 flex-1 text-[13px] text-ink-secondary">{preset.blurb}</p>
              <p className="mt-2 text-[11px] text-ink-muted">
                {preset.circuit.numQubits} qubit{preset.circuit.numQubits === 1 ? '' : 's'} ·{' '}
                {preset.circuit.ops.length} gates
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href={`/simulator?c=${preset.token}`}
                  className="btn-ghost focus-ring !px-3 !py-1"
                >
                  Open in simulator
                </Link>
                <button
                  type="button"
                  className="btn-ghost focus-ring !px-3 !py-1"
                  aria-label={`Export ${preset.name} as a Qiskit notebook`}
                  onClick={() => handleExport(preset.circuit, 'qiskit', preset.name)}
                >
                  Qiskit .ipynb
                </button>
                <button
                  type="button"
                  className="btn-ghost focus-ring !px-3 !py-1"
                  aria-label={`Export ${preset.name} as a PennyLane notebook`}
                  onClick={() => handleExport(preset.circuit, 'pennylane', preset.name)}
                >
                  PennyLane .ipynb
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
