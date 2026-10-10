'use client'

/**
 * ExportPanel — download the current circuit as a static image (SVG/PNG) or
 * copy it as quantikz LaTeX, for pasting into a paper, a slide, or a README.
 *
 * Self-contained: it takes only `circuit` and `numQubits` and does its own
 * rendering via `lib/export/circuitImage.ts`. Not wired into any page here —
 * see the integration note in this feature's report for where it mounts.
 */

import { useCallback, useState } from 'react'
import { ButtonRow } from '@/components/ui/Controls'
import {
  copyToClipboard,
  renderCircuitQuantikz,
  renderCircuitSvg,
  svgToPngDataUrl,
} from '@/lib/export/circuitImage'
import type { Circuit } from '@/lib/quantum'

export interface ExportPanelProps {
  circuit: Circuit
  numQubits: number
  className?: string
}

/** Trigger a browser download of `content` (or a data URL) as `filename`. */
export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = content.startsWith('data:') ? undefined : new Blob([content], { type: mimeType })
  const url = blob ? URL.createObjectURL(blob) : content
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (blob) window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function ExportPanel({ circuit, numQubits, className = '' }: ExportPanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<'svg' | 'png' | null>(null)

  const empty = circuit.ops.length === 0

  const handleDownloadSvg = useCallback(() => {
    setError(null)
    try {
      const svg = renderCircuitSvg(circuit)
      downloadBlob(svg, 'circuit.svg', 'image/svg+xml')
    } catch {
      setError('Could not render this circuit as SVG.')
    }
  }, [circuit])

  const handleDownloadPng = useCallback(async () => {
    setError(null)
    setBusy('png')
    try {
      const svg = renderCircuitSvg(circuit)
      const dataUrl = await svgToPngDataUrl(svg, 2)
      downloadBlob(dataUrl, 'circuit.png', 'image/png')
    } catch {
      setError('Could not render this circuit as PNG.')
    } finally {
      setBusy(null)
    }
  }, [circuit])

  const handleCopyLatex = useCallback(async () => {
    setError(null)
    try {
      const tex = renderCircuitQuantikz(circuit)
      await copyToClipboard(tex)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy LaTeX — your browser may block clipboard access here.')
    }
  }, [circuit])

  return (
    <section className={`card p-5 ${className}`}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
        Export circuit image
      </p>
      <ButtonRow>
        <button
          type="button"
          className="btn-ghost focus-ring"
          disabled={empty}
          onClick={handleDownloadSvg}
        >
          Download SVG
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          disabled={empty || busy === 'png'}
          onClick={() => void handleDownloadPng()}
        >
          {busy === 'png' ? 'Rendering…' : 'Download PNG'}
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          disabled={empty}
          onClick={() => void handleCopyLatex()}
        >
          {copied ? 'Copied ✓' : 'Copy LaTeX (quantikz)'}
        </button>
      </ButtonRow>
      <p className="mt-2 text-[11px] text-ink-muted">
        {numQubits} qubit{numQubits === 1 ? '' : 's'} · a black/white diagram for printing or
        pasting into a paper. LaTeX needs the quantikz package to compile.
      </p>
      {error ? (
        <p className="mt-2 text-xs text-q-rose-text" role="status">
          {error}
        </p>
      ) : null}
    </section>
  )
}
