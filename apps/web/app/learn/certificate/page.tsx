'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Certificate } from '@/components/lesson/Certificate'
import {
  certificateEligibility,
  lessonTitle,
  makeCertificateId,
  remainingLessons,
} from '@/lib/certificate'
import { completionCardSvg } from '@/lib/completionCard'
import { TRACKS } from '@/lib/lessons'
import { loadProgress } from '@/lib/lessons/progress'

const NAME_KEY = 'quantum-lab.name'
const DEFAULT_NAME = 'Quantum Learner'

function readStoredName(): string {
  if (typeof window === 'undefined') return DEFAULT_NAME
  try {
    const raw = window.localStorage.getItem(NAME_KEY)
    return raw !== null && raw.trim() !== '' ? raw : DEFAULT_NAME
  } catch {
    return DEFAULT_NAME
  }
}

function storeName(value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(NAME_KEY, value)
  } catch {
    // Storage disabled or full — the in-memory name still drives this session.
  }
}

export default function CertificatePage() {
  // Start empty so the server markup and the first client render agree; real
  // progress arrives in the effect below, after mount.
  const [mounted, setMounted] = useState(false)
  const [completed, setCompleted] = useState<string[]>([])
  const [name, setName] = useState(DEFAULT_NAME)
  const [completedAt, setCompletedAt] = useState('')

  useEffect(() => {
    setCompleted(loadProgress().completed)
    setName(readStoredName())
    setCompletedAt(new Date().toISOString())
    setMounted(true)
  }, [])

  const handleNameChange = useCallback((value: string) => {
    setName(value)
    storeName(value)
  }, [])

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="max-w-2xl">
        <p className="section-label">Certification</p>
        <h1 className="section-title mt-2 text-3xl md:text-4xl">Your certificates</h1>
        <p className="section-desc mt-3">
          Finish every lesson in a track and its certificate unlocks here — generated in your
          browser, from progress stored on this device. Nothing is uploaded, and nothing is
          verified against a registry; treat it as a record of study rather than a credential.
        </p>
        <p className="section-desc mt-3">
          Two different things are on offer, and they make two different claims.{' '}
          <Link href="/certify" className="text-q-violet-text underline underline-offset-2">
            Certification exams
          </Link>{' '}
          are graded on our servers, so those certificates are verifiable — each one has a
          number anyone can check. Track completion happens entirely on your device, so what
          you get here is a shareable <strong>completion card</strong>: it says, in its own
          wording, that the claim is self-reported. We will not issue a verified-looking badge
          for something we never saw you do.
        </p>
        <p className="mt-3 text-xs text-ink-muted">
          Quantum Foundations certificates are free. Advanced certification is included with
          Pro<span data-store-hide> — see <Link href="/pricing" className="text-q-violet-text underline underline-offset-2">plans</Link></span>.
        </p>
      </header>

      <div className="mt-10 space-y-6">
        {TRACKS.map((track) => (
          <TrackCard
            key={track.id}
            trackId={track.id}
            trackName={track.name}
            blurb={track.blurb}
            completed={completed}
            mounted={mounted}
            name={name}
            completedAt={completedAt}
            onNameChange={handleNameChange}
          />
        ))}
      </div>
    </div>
  )
}

interface TrackCardProps {
  trackId: string
  trackName: string
  blurb: string
  completed: string[]
  mounted: boolean
  name: string
  completedAt: string
  onNameChange: (value: string) => void
}

function TrackCard({
  trackId,
  trackName,
  blurb,
  completed,
  mounted,
  name,
  completedAt,
  onNameChange,
}: TrackCardProps) {
  const { eligible, completed: done, total } = certificateEligibility(trackId, completed)
  const remaining = remainingLessons(trackId, completed)
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="section-title text-xl">{trackName}</h2>
        <span className="pill border-line text-ink-secondary">
          {mounted ? `${done} / ${total} complete` : `${total} lessons`}
        </span>
      </div>
      <p className="section-desc mt-2 max-w-2xl">{blurb}</p>

      <div
        className="mt-5 h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label={`${trackName} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={mounted ? percent : 0}
      >
        <div
          className="h-full rounded-full bg-q-violet transition-[width] duration-500"
          style={{ width: `${mounted ? percent : 0}%` }}
        />
      </div>

      {!mounted ? (
        <p className="mt-5 text-sm text-ink-muted">Loading your progress…</p>
      ) : eligible ? (
        <div className="mt-6">
          <label className="block text-sm text-ink-secondary" htmlFor={`name-${trackId}`}>
            Name on the certificate
          </label>
          <input
            id={`name-${trackId}`}
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={DEFAULT_NAME}
            maxLength={60}
            className="focus-ring mt-2 w-full max-w-sm rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />

          <div className="mt-6">
            <Certificate
              name={name}
              trackName={trackName}
              completedAt={completedAt}
              lessonCount={total}
              id={makeCertificateId(name.trim() === '' ? DEFAULT_NAME : name, trackId)}
            />
          </div>

          <CompletionCardDownload
            trackId={trackId}
            completed={completed}
            completedAt={completedAt}
          />
        </div>
      ) : (
        <div className="mt-6">
          <p className="text-sm text-ink-secondary">
            {remaining.length === 1
              ? '1 lesson to go before this certificate unlocks.'
              : `${remaining.length} lessons to go before this certificate unlocks.`}
          </p>
          <ul className="mt-3 space-y-1.5">
            {remaining.map((slug) => (
              <li key={slug}>
                <Link
                  href={`/learn/${slug}`}
                  className="focus-ring text-sm text-q-violet-text hover:underline"
                >
                  {lessonTitle(slug)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────
// The self-attested completion card (see lib/completionCard.ts)
// ────────────────────────────────────────────────────────────

interface CompletionCardDownloadProps {
  trackId: string
  completed: string[]
  completedAt: string
}

type CardFeedback = { tone: 'ok' | 'error'; message: string } | null

/**
 * Trigger a browser download of `blob` as `name`. Revocation is deferred a
 * beat because revoking synchronously can cancel the download in some
 * browsers before the fetch for the blob URL starts (same reasoning as the
 * Certificate component's handler).
 */
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Download buttons for the shareable completion card. The SVG comes straight
 * from `completionCardSvg`; the PNG is the same SVG rasterised through an
 * offscreen <img> + <canvas> at 2× — all client-side, because the whole point
 * of this card is that the server is never asked to attest local progress.
 */
function CompletionCardDownload({
  trackId,
  completed,
  completedAt,
}: CompletionCardDownloadProps) {
  const [feedback, setFeedback] = useState<CardFeedback>(null)

  const handleSvg = useCallback(() => {
    const card = completionCardSvg({ trackId, completedSlugs: completed, completedAt })
    if (!card) {
      setFeedback({ tone: 'error', message: 'Could not build the card for this track.' })
      return
    }
    try {
      downloadBlob(
        new Blob([card.svg], { type: 'image/svg+xml;charset=utf-8' }),
        `${card.fileName}.svg`
      )
      setFeedback({ tone: 'ok', message: 'Card downloaded (SVG).' })
    } catch {
      setFeedback({ tone: 'error', message: 'Could not download the card.' })
    }
  }, [trackId, completed, completedAt])

  const handlePng = useCallback(() => {
    const card = completionCardSvg({ trackId, completedSlugs: completed, completedAt })
    if (!card) {
      setFeedback({ tone: 'error', message: 'Could not build the card for this track.' })
      return
    }
    const svgUrl = URL.createObjectURL(
      new Blob([card.svg], { type: 'image/svg+xml;charset=utf-8' })
    )
    const finish = () => URL.revokeObjectURL(svgUrl)
    const fail = () => {
      finish()
      setFeedback({
        tone: 'error',
        message: 'PNG conversion failed in this browser — use the SVG download instead.',
      })
    }
    const image = new Image()
    image.onload = () => {
      try {
        const scale = 2 // crisp on high-DPI screens and in social-feed resizes
        const canvas = document.createElement('canvas')
        canvas.width = card.width * scale
        canvas.height = card.height * scale
        const ctx = canvas.getContext('2d')
        if (!ctx) return fail()
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          finish()
          if (!blob) {
            setFeedback({
              tone: 'error',
              message: 'PNG conversion failed in this browser — use the SVG download instead.',
            })
            return
          }
          try {
            downloadBlob(blob, `${card.fileName}.png`)
            setFeedback({ tone: 'ok', message: 'Card downloaded (PNG).' })
          } catch {
            setFeedback({ tone: 'error', message: 'Could not download the card.' })
          }
        }, 'image/png')
      } catch {
        fail()
      }
    }
    image.onerror = fail
    image.src = svgUrl
  }, [trackId, completed, completedAt])

  return (
    <div className="mt-8 rounded-card border border-line bg-surface-2 p-4">
      <h3 className="text-sm font-semibold text-ink">Shareable completion card</h3>
      <p className="mt-1 text-xs text-ink-muted">
        A compact card listing every lesson you finished — sized for sharing. Unlike an exam
        certificate it carries no verification number: its wording marks it as self-reported,
        because your progress lives on this device and was never graded by our servers.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={handlePng} className="btn-primary focus-ring">
          Download card (PNG)
        </button>
        <button type="button" onClick={handleSvg} className="btn-ghost focus-ring">
          Download card (SVG)
        </button>
        {feedback && (
          <span
            role="status"
            className={
              feedback.tone === 'ok' ? 'text-xs text-q-teal-text' : 'text-xs text-q-rose-text'
            }
          >
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  )
}
