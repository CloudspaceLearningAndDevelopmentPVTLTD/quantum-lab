'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * `beforeinstallprompt` is not in lib.dom (it is a Chromium-only extension to the
 * install spec), so we describe it locally rather than reaching for `any`.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

/** iOS Safari exposes standalone mode on navigator, not via matchMedia. */
interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

const DISMISS_KEY = 'quantum-lab.install-dismissed'
const DISMISS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
  } catch {
    /* matchMedia can throw in exotic embedded webviews. */
  }
  return (navigator as NavigatorWithStandalone).standalone === true
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const at = Number.parseInt(raw, 10)
    if (!Number.isFinite(at)) return false
    return Date.now() - at < DISMISS_WINDOW_MS
  } catch {
    // Storage can throw in private mode or when cookies are blocked. Treat an
    // unreadable store as "never dismissed" rather than suppressing the prompt.
    return false
  }
}

function recordDismissal(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    /* Nothing to do — worst case we ask again next visit. */
  }
}

/**
 * An unobtrusive install card, shown only when the browser has actually told us the
 * app is installable. Chromium fires `beforeinstallprompt`; we suppress the default
 * mini-infobar and surface our own affordance at a moment of our choosing, which is
 * the whole reason the event is cancellable.
 */
export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    if (wasRecentlyDismissed()) return

    const onBeforeInstallPrompt = (event: Event) => {
      // Stop the browser's own mini-infobar so there are not two competing prompts.
      event.preventDefault()
      setPromptEvent(event as BeforeInstallPromptEvent)
      setVisible(true)
    }

    const onAppInstalled = () => {
      setVisible(false)
      setPromptEvent(null)
      // Record it so we do not re-offer if the user later opens the site in a tab.
      recordDismissal()
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const install = useCallback(() => {
    if (!promptEvent) return
    const run = async () => {
      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        if (choice.outcome === 'dismissed') {
          recordDismissal()
        }
      } catch {
        /* The event is single-use; if it has gone stale just hide the card. */
      } finally {
        // A prompt event can only be used once, so drop it either way.
        setPromptEvent(null)
        setVisible(false)
      }
    }
    void run()
  }, [promptEvent])

  const dismiss = useCallback(() => {
    recordDismissal()
    setVisible(false)
  }, [])

  if (!visible || !promptEvent) return null

  return (
    <div className="fixed bottom-[calc(var(--mobile-nav-h)+1rem)] right-4 z-40 w-[min(20rem,calc(100vw-2rem))] xl:bottom-4">
      <div className="card p-4 shadow-xl">
        <div className="flex items-start gap-3">
          {/* Plain <img>, not next/image: a static SVG from /public needs no
              optimisation pipeline, and next/image would route it through
              /_next/image for an icon the service worker already precaches. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon.svg"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Install Qubit16</p>
            <p className="mt-1 text-sm text-ink-secondary">
              It works offline — the simulator, visualizations, and course all run in
              your browser.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="focus-ring -mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-ink-secondary transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={install}
            className="btn-primary focus-ring px-3 py-1.5 text-sm"
          >
            Install
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="btn-ghost focus-ring px-3 py-1.5 text-sm"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

export default InstallPrompt
