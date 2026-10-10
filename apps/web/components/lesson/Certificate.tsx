'use client'

import { useCallback, useRef, useState } from 'react'
import { formatCertificateDate } from '@/lib/certificate'
import type { CertificateData } from '@/lib/certificate'

const W = 1000
const H = 700

const VIOLET = '#a99dff'
const VIOLET_LIGHT = '#c1bbfe'
const INK = '#eef2ff'
const INK_SECONDARY = '#8fa3c8'
const INK_MUTED = '#3d5070'

type Feedback = { tone: 'ok' | 'error'; message: string } | null

/**
 * A hand-built SVG certificate.
 *
 * Rendered inline rather than as an <img> for two reasons: the text stays
 * selectable and readable to assistive technology, and the same DOM node can be
 * serialised straight to a downloadable file with no canvas round-trip and no
 * PDF dependency.
 */
export function Certificate({
  name,
  trackName,
  completedAt,
  lessonCount,
  id,
}: CertificateData) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const displayName = name.trim() === '' ? 'Quantum Learner' : name.trim()
  const dateLabel = formatCertificateDate(completedAt)
  const lessonLabel = `${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'}`

  // Long names have to shrink or they collide with the border rules.
  const nameSize = displayName.length > 34 ? 40 : displayName.length > 24 ? 50 : 62

  const handleDownload = useCallback(() => {
    if (typeof window === 'undefined') return
    const node = svgRef.current
    if (!node) {
      setFeedback({ tone: 'error', message: 'Certificate is not ready yet.' })
      return
    }

    let url: string | null = null
    let anchor: HTMLAnchorElement | null = null
    try {
      const source = new XMLSerializer().serializeToString(node)
      const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${source}`], {
        type: 'image/svg+xml;charset=utf-8',
      })
      url = URL.createObjectURL(blob)

      anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `qubit16-certificate-${id}.svg`
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      setFeedback({ tone: 'ok', message: 'Downloaded.' })
    } catch {
      setFeedback({ tone: 'error', message: 'Could not download the certificate.' })
    } finally {
      if (anchor && anchor.parentNode) anchor.parentNode.removeChild(anchor)
      // Revoke on the next tick — revoking synchronously can cancel the
      // download in some browsers before the fetch for the blob starts.
      if (url) {
        const toRevoke = url
        window.setTimeout(() => URL.revokeObjectURL(toRevoke), 2000)
      }
    }
  }, [id])

  const handleCopy = useCallback(() => {
    if (typeof window === 'undefined') return
    const text = `I completed the ${trackName} track on Qubit16 — ${lessonLabel}, finished ${dateLabel}. Certificate ${id}.`
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(
          () => setFeedback({ tone: 'ok', message: 'Share text copied.' }),
          () => setFeedback({ tone: 'error', message: 'Clipboard access was refused.' })
        )
        return
      }
      setFeedback({ tone: 'error', message: 'Clipboard is unavailable in this browser.' })
    } catch {
      setFeedback({ tone: 'error', message: 'Could not copy the share text.' })
    }
  }, [trackName, lessonLabel, dateLabel, id])

  return (
    <div>
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Certificate of completion for ${displayName}, ${trackName}, ${lessonLabel}, ${dateLabel}, certificate ${id}`}
        className="block h-auto w-full rounded-card border border-line"
      >
        <defs>
          <linearGradient id="ql-cert-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0d1120" />
            <stop offset="55%" stopColor="#0a0e1a" />
            <stop offset="100%" stopColor="#07090f" />
          </linearGradient>
          <linearGradient id="ql-cert-rule" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={VIOLET} stopOpacity="0" />
            <stop offset="50%" stopColor={VIOLET_LIGHT} stopOpacity="0.9" />
            <stop offset="100%" stopColor={VIOLET} stopOpacity="0" />
          </linearGradient>
          <radialGradient id="ql-cert-glow" cx="0.5" cy="0.1" r="0.8">
            <stop offset="0%" stopColor={VIOLET} stopOpacity="0.22" />
            <stop offset="100%" stopColor={VIOLET} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={W} height={H} fill="url(#ql-cert-bg)" />
        <rect width={W} height={H} fill="url(#ql-cert-glow)" />

        {/* ── Faint circuit motif: two wires, an H box, a CNOT ───────── */}
        <g opacity="0.09" stroke={VIOLET_LIGHT} strokeWidth="2.5" fill="none">
          <line x1="120" y1="470" x2="880" y2="470" />
          <line x1="120" y1="560" x2="880" y2="560" />

          {/* Hadamard on the top wire */}
          <rect x="255" y="443" width="54" height="54" rx="8" />
          <path
            d="M270 458 v24 M294 458 v24 M270 470 h24"
            strokeWidth="3"
            strokeLinecap="round"
          />

          {/* CNOT: filled control on the top wire, ⊕ target below */}
          <circle cx="470" cy="470" r="9" fill={VIOLET_LIGHT} stroke="none" />
          <line x1="470" y1="470" x2="470" y2="560" />
          <circle cx="470" cy="560" r="19" />
          <path d="M451 560 h38 M470 541 v38" />

          {/* A phase gate and a measurement-ish flourish further right */}
          <rect x="640" y="533" width="54" height="54" rx="8" />
          <circle cx="667" cy="560" r="11" />
          <circle cx="800" cy="470" r="14" />
          <line x1="800" y1="470" x2="812" y2="456" />
        </g>

        {/* ── Double border ──────────────────────────────────────────── */}
        <rect
          x="26"
          y="26"
          width={W - 52}
          height={H - 52}
          rx="16"
          fill="none"
          stroke={VIOLET}
          strokeOpacity="0.75"
          strokeWidth="2.5"
        />
        <rect
          x="42"
          y="42"
          width={W - 84}
          height={H - 84}
          rx="10"
          fill="none"
          stroke={VIOLET}
          strokeOpacity="0.32"
          strokeWidth="1"
        />

        {/* ── Corner flourishes ──────────────────────────────────────── */}
        <g stroke={VIOLET_LIGHT} strokeOpacity="0.55" strokeWidth="2" fill="none">
          <path d="M60 96 V60 H96" />
          <path d="M904 60 H940 V96" />
          <path d="M940 604 V640 H904" />
          <path d="M96 640 H60 V604" />
        </g>
        <g fill={VIOLET} fillOpacity="0.5">
          <circle cx="72" cy="72" r="3.5" />
          <circle cx="928" cy="72" r="3.5" />
          <circle cx="928" cy="628" r="3.5" />
          <circle cx="72" cy="628" r="3.5" />
        </g>

        {/* ── Wordmark ───────────────────────────────────────────────── */}
        <text
          x={W / 2}
          y="128"
          textAnchor="middle"
          fill={VIOLET_LIGHT}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="22"
          fontWeight="700"
          letterSpacing="6"
        >
          ⚛ QUANTUM LAB
        </text>

        {/* ── Title ──────────────────────────────────────────────────── */}
        <text
          x={W / 2}
          y="196"
          textAnchor="middle"
          fill={INK_SECONDARY}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="15"
          fontWeight="700"
          letterSpacing="9"
        >
          CERTIFICATE OF COMPLETION
        </text>

        <rect x={W / 2 - 190} y="216" width="380" height="2" fill="url(#ql-cert-rule)" />

        {/* ── Recipient ──────────────────────────────────────────────── */}
        <text
          x={W / 2}
          y="308"
          textAnchor="middle"
          fill={INK}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize={nameSize}
          fontWeight="700"
        >
          {displayName}
        </text>

        <text
          x={W / 2}
          y="358"
          textAnchor="middle"
          fill={INK_SECONDARY}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="17"
        >
          has completed the
        </text>

        <text
          x={W / 2}
          y="406"
          textAnchor="middle"
          fill={VIOLET_LIGHT}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="34"
          fontWeight="700"
        >
          {trackName}
        </text>

        <text
          x={W / 2}
          y="440"
          textAnchor="middle"
          fill={INK_SECONDARY}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="15"
        >
          {`${lessonLabel} · completed ${dateLabel}`}
        </text>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <line
          x1="120"
          y1="596"
          x2="880"
          y2="596"
          stroke={VIOLET}
          strokeOpacity="0.28"
          strokeWidth="1"
        />
        <text
          x="120"
          y="622"
          fill={INK_MUTED}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="13"
          letterSpacing="1.5"
        >
          {id}
        </text>
        <text
          x="880"
          y="622"
          textAnchor="end"
          fill={INK_MUTED}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="13"
        >
          quantum-lab · self-directed study
        </text>
      </svg>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={handleDownload} className="btn-primary focus-ring">
          Download SVG
        </button>
        <button type="button" onClick={handleCopy} className="btn-ghost focus-ring">
          Copy share text
        </button>
        {feedback && (
          <span
            role="status"
            className={
              feedback.tone === 'ok'
                ? 'text-xs text-q-teal-text'
                : 'text-xs text-q-rose-text'
            }
          >
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  )
}

export default Certificate
