'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * The two next steps after a visualization: open the simulator, or install
 * the app. Rendered under every visualization page from the route layout.
 *
 * Install has three outcomes, decided at click time:
 *   1. The browser fired `beforeinstallprompt` (Chromium) — call it, which
 *      shows the native install dialog.
 *   2. Already running as an installed app or inside a store app — the whole
 *      install half is omitted (the store apps also hide it via data-store-hide,
 *      this is belt and braces for the standalone PWA case).
 *   3. Anything else (Safari, Firefox, desktop browsers that have not fired the
 *      event yet) — a short platform-specific instruction unfolds in place.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
  } catch {
    /* matchMedia can throw in embedded webviews */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Standalone mode as an external store: false on the server, live in the browser. */
function subscribeStandalone(onChange: () => void): () => void {
  window.addEventListener('appinstalled', onChange)
  let mql: MediaQueryList | null = null
  try {
    mql = window.matchMedia('(display-mode: standalone)')
    mql.addEventListener('change', onChange)
  } catch {
    /* no matchMedia */
  }
  return () => {
    window.removeEventListener('appinstalled', onChange)
    mql?.removeEventListener('change', onChange)
  }
}

const INSTRUCTIONS: Record<Platform, string> = {
  ios: 'In Safari, tap the Share button, then "Add to Home Screen". Qubit16 then opens full-screen like any app.',
  android:
    'Open the browser menu (⋮) and choose "Install app" or "Add to Home screen". The Google Play version is in early access; ask hello@qubit16.ai for an invite.',
  desktop:
    'In Chrome or Edge, click the install icon at the right end of the address bar, or open the browser menu and choose "Install Qubit16".',
}

export default function VizCallToAction() {
  const pathname = usePathname()
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [help, setHelp] = useState<Platform | null>(null)
  const standalone =
    useSyncExternalStore(subscribeStandalone, isStandalone, () => false) || accepted

  useEffect(() => {
    const onPrompt = (event: Event) => setInstallEvent(event as BeforeInstallPromptEvent)
    const onInstalled = () => setInstallEvent(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // The catalogue page has its own hero; only the individual visualizations get this.
  if (!pathname || pathname === '/visualizations') return null

  const onInstall = async () => {
    if (installEvent) {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      if (choice.outcome === 'accepted') setAccepted(true)
      setInstallEvent(null)
      return
    }
    setHelp((h) => (h ? null : detectPlatform()))
  }

  return (
    <section
      className="card mx-auto mt-10 max-w-5xl p-6"
      aria-labelledby="viz-next-heading"
      data-testid="viz-cta"
    >
      <p className="section-label">Keep going</p>
      <h2 id="viz-next-heading" className="mt-1 text-lg font-bold text-ink">
        Build this yourself
      </h2>
      <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-secondary">
        Every visualization on this page is computed by the same engine as the simulator.
        Open it to place the gates by hand, up to 16 qubits, free and without an account.
        Or install Qubit16 so the whole lab is one tap away and works offline.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/simulator" className="btn-primary focus-ring">
          Open the simulator
        </Link>
        {!standalone && (
          <button
            type="button"
            onClick={onInstall}
            className="btn-ghost focus-ring"
            data-store-hide
            aria-expanded={help !== null}
            aria-controls="viz-install-help"
          >
            Install the app
          </button>
        )}
      </div>
      {help && !standalone && (
        <p
          id="viz-install-help"
          className="mt-3 max-w-prose text-[13px] leading-relaxed text-ink-secondary"
          data-store-hide
        >
          {INSTRUCTIONS[help]}
        </p>
      )}
    </section>
  )
}
