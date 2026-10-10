'use client'

/**
 * SaveLoadPanel — save, reload and share the circuit currently on the canvas.
 *
 * Works with or without an account: circuit-store transparently writes to
 * Supabase when a session exists and to localStorage otherwise.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useEntitlement } from '@/components/billing/useEntitlement'
import { canSaveAnotherCircuit, formatLimit, limitsFor } from '@/lib/plans'
import {
  deleteCircuit,
  listCircuits,
  relativeTime,
  saveCircuit,
  CircuitLimitError,
  storageMode,
  type SavedCircuit,
} from '@/lib/circuit-store'
import { buildShareUrl } from '@/lib/share-link'
import { downloadNotebook, type NotebookVariant } from '@/lib/export/notebook'
import {
  buildExportBundle,
  bundleFilename,
  bundleToTextArchive,
} from '@/lib/research/exportBundle'
import { track } from '@/lib/analytics/track'
import { fromQasm, type Circuit, type RunResult } from '@/lib/quantum'

const AMBER = { color: 'var(--q-amber-text)', background: 'rgb(var(--q-amber-rgb) / 0.14)' }
const TEAL = { color: 'var(--q-teal-text)', background: 'rgb(var(--q-teal-rgb) / 0.14)' }

export interface SaveLoadPanelProps {
  circuit: Circuit
  onLoad: (circuit: Circuit) => void
  /**
   * The run whose numbers the export bundle should cite, when the page has
   * one. Optional, and absent is a real state rather than a hole: a circuit
   * exported before it is run produces a bundle that says "no run recorded"
   * instead of one that implies results it does not have.
   */
  result?: RunResult | null
  /**
   * The readout bit-flip probability and RNG seed that produced `result`.
   * They belong with it: a run exported without them is written into the
   * manifest as `readoutNoise: 0, seed: null`, which a reader takes to mean
   * "clean and unseeded" rather than "not recorded" — a false provenance claim
   * in the one file whose entire job is honest provenance.
   */
  noise?: number
  seed?: number
  className?: string
}

export default function SaveLoadPanel({
  circuit,
  onLoad,
  result = null,
  noise,
  seed,
  className = '',
}: SaveLoadPanelProps) {
  const { entitlement, plan, loading: entitlementLoading } = useEntitlement()
  const [items, setItems] = useState<SavedCircuit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<'supabase' | 'local'>('local')
  const [bundleStatus, setBundleStatus] = useState<string | null>(null)
  const shareRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listCircuits()
      setItems(list)
      setMode(storageMode())
      setError(null)
    } catch {
      setError('Could not load your saved circuits.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const maxSaved = limitsFor(entitlement).maxSavedCircuits
  // While the entitlement is loading, assume there is room: blocking Save on a
  // stale free-tier default would lock out someone who already pays.
  const atCap = !entitlementLoading && !loading && !canSaveAnotherCircuit(entitlement, items.length)

  const canSave = name.trim().length > 0 && circuit.ops.length > 0 && !saving && !atCap

  const handleSave = useCallback(async () => {
    if (!canSave) return
    if (!canSaveAnotherCircuit(entitlement, items.length)) return
    setSaving(true)
    setError(null)
    try {
      await saveCircuit({ name: name.trim(), description: description.trim(), circuit })
      // Shape only — never the name, description or QASM.
      track('circuit.saved', { numQubits: circuit.numQubits, gateCount: circuit.ops.length })
      setName('')
      setDescription('')
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1800)
      await refresh()
    } catch (err) {
      setError(
        err instanceof CircuitLimitError
          ? err.message
          : 'Saving failed. Your browser storage may be full.'
      )
    } finally {
      setSaving(false)
    }
  }, [canSave, circuit, description, entitlement, items.length, name, refresh])

  const handleDelete = useCallback(
    async (id: string) => {
      if (confirmId !== id) {
        setConfirmId(id)
        window.setTimeout(() => setConfirmId((current) => (current === id ? null : current)), 3000)
        return
      }
      setConfirmId(null)
      await deleteCircuit(id)
      await refresh()
    },
    [confirmId, refresh]
  )

  const handleCopyShare = useCallback(async () => {
    const url = buildShareUrl(circuit)
    try {
      await navigator.clipboard.writeText(url)
      track('circuit.shared', { numQubits: circuit.numQubits })
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard denied or insecure context — surface the URL for manual copying.
      const input = shareRef.current
      if (input) {
        input.value = url
        input.select()
      }
      setCopied(false)
    }
  }, [circuit])

  const handleExportNotebook = useCallback(
    (variant: NotebookVariant) => {
      // Not tracked: the event taxonomy in lib/analytics/events.ts is closed
      // by design, and adding 'circuit.notebook_exported' is that module
      // owner's call, not a drive-by from here.
      downloadNotebook(circuit, variant, name.trim() || 'Qubit16 circuit')
    },
    [circuit, name]
  )

  const handleExportBundle = useCallback(() => {
    // The clock lives HERE, not in the builder: exportBundle is pure so the
    // artifact it produces can be asserted byte-for-byte in a test, and a
    // module that read the time itself could not be.
    const exportedAt = new Date().toISOString()
    const bundle = buildExportBundle({
      circuit,
      exportedAt,
      name: name.trim() || undefined,
      result,
      noise,
      seed,
    })
    const filename = bundleFilename(bundle)
    const blob = new Blob([bundleToTextArchive(bundle)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoke on the next tick: revoking synchronously races the click in Safari.
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    // The stamp is in the sentence because a live region only speaks when its
    // text CHANGES. Filename, file count and cite key are all stable across
    // exports of one circuit on one day, so without it the second download in
    // a row is announced as nothing at all — and the download tray is the only
    // other evidence, which a screen reader user does not see either.
    setBundleStatus(
      `Downloaded ${filename} — ${Object.keys(bundle.files).length} files, ` +
        `cite key ${bundle.citationKey}, stamped ${exportedAt}.`
    )
  }, [circuit, name, noise, result, seed])

  return (
    <section className={`card p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-ink-secondary">Save &amp; share</h2>
        <span className="pill" style={mode === 'supabase' ? TEAL : AMBER}>
          {mode === 'supabase' ? 'synced' : 'local storage'}
        </span>
      </div>

      {/* 1 — SAVE */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Circuit name"
          aria-label="Circuit name"
          className="focus-ring min-h-[44px] min-w-[160px] flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-base text-ink placeholder:text-ink-muted sm:text-sm"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          aria-label="Circuit description"
          className="focus-ring min-h-[44px] min-w-[160px] flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-base text-ink placeholder:text-ink-muted sm:text-sm"
        />
        <button
          type="button"
          className="btn-primary focus-ring"
          disabled={!canSave}
          onClick={() => void handleSave()}
        >
          {savedFlash ? 'Saved ✓' : 'Save circuit'}
        </button>
      </div>
      {atCap ? (
        <p className="mt-2 text-xs text-q-amber-text" role="status">
          You&apos;ve saved {items.length} of {formatLimit(maxSaved)} circuits on {plan.name}.{' '}
          <Link
            href="/pricing"
            className="focus-ring rounded font-semibold underline underline-offset-2"
          >
            Upgrade
          </Link>{' '}
          for unlimited, or delete one.
        </p>
      ) : circuit.ops.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-muted">Place at least one gate to save.</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-q-rose-text">{error}</p> : null}

      {/* 2 — YOUR CIRCUITS */}
      <div className="mt-5">
        <p className="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          <span>Your circuits</span>
          <span className={atCap ? 'text-q-amber-text' : undefined}>
            {items.length} / {formatLimit(maxSaved)} saved
          </span>
        </p>
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No saved circuits yet — build something and save it.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-[140px] flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{item.name}</p>
                  <p className="text-[11px] text-ink-muted">
                    {item.numQubits} qubit{item.numQubits === 1 ? '' : 's'} · saved{' '}
                    {relativeTime(item.updatedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost focus-ring !px-3 !py-1"
                  onClick={() => onLoad(fromQasm(item.qasm))}
                >
                  Load
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${item.name}`}
                  className="focus-ring min-h-[44px] min-w-[44px] rounded-lg border border-line px-2.5 py-1 text-xs text-ink-secondary hover:border-line-strong hover:text-q-rose-text"
                  onClick={() => void handleDelete(item.id)}
                >
                  {confirmId === item.id ? 'Sure?' : '✕'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 3 — SHARE */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost focus-ring" onClick={() => void handleCopyShare()}>
          {copied ? 'Copied ✓' : 'Copy share link'}
        </button>
        <input
          ref={shareRef}
          readOnly
          aria-label="Share link"
          className="focus-ring min-w-[200px] flex-1 rounded-lg border border-line bg-surface-3 px-3 py-2 font-mono text-[11px] text-ink-secondary"
          placeholder="A permalink that encodes the whole circuit"
        />
      </div>

      {/* 4 — EXPORT NOTEBOOK */}
      <div className="mt-5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          Export notebook
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost focus-ring"
            disabled={circuit.ops.length === 0}
            onClick={() => handleExportNotebook('qiskit')}
          >
            Qiskit .ipynb
          </button>
          <button
            type="button"
            className="btn-ghost focus-ring"
            disabled={circuit.ops.length === 0}
            onClick={() => handleExportNotebook('pennylane')}
          >
            PennyLane .ipynb
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">
          A ready-to-run Jupyter notebook of this circuit — open it in Colab or your own
          environment. Built in your browser; nothing leaves this page.
        </p>
      </div>

      {/* 5 — REPRODUCIBILITY BUNDLE */}
      <div className="mt-5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          Cite this result
        </p>
        <button
          type="button"
          className="btn-ghost focus-ring"
          disabled={circuit.ops.length === 0}
          onClick={handleExportBundle}
        >
          Export reproducibility bundle
        </button>
        <p className="mt-2 text-[11px] text-ink-muted">
          One file holding the OpenQASM 3 circuit, a JSON manifest of what was run with what,
          {result ? ' the measured counts, ' : ' '}a BibTeX entry, and a README that says how to
          re-run it.
          {result ? '' : ' No run is recorded yet — run the circuit to include its counts.'}
        </p>
        {/* The download is the only evidence anything happened, and a file
            landing in the downloads tray is invisible to a screen reader —
            hence a live region rather than a label flash. It is rendered
            before there is anything to say, because a region inserted at the
            moment its text arrives is not yet being observed and stays
            silent; `empty:mt-0` keeps it from reserving space until then. */}
        <p className="mt-2 text-[11px] text-q-teal-text empty:mt-0" role="status" aria-live="polite">
          {bundleStatus}
        </p>
      </div>
    </section>
  )
}
