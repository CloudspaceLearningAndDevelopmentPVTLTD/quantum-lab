'use client'

import { useCallback, useEffect, useState } from 'react'
import { SW_UPDATE_READY_EVENT } from './ServiceWorkerRegistrar'

/**
 * Two slim, dismissible status banners pinned to the bottom of the viewport:
 *
 *  1. Offline — phrased around what still works, because in this app that is almost
 *     everything. The simulator, the visualizations and the course are pure
 *     client-side computation.
 *  2. Update ready — a new service worker is waiting; offer a one-click reload.
 */
export function OfflineBanner() {
  // Rendering nothing until mounted keeps SSR output and first client render
  // identical. navigator.onLine does not exist on the server, so reading it during
  // render would guarantee a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  const [offline, setOffline] = useState(false)
  const [offlineDismissed, setOfflineDismissed] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  useEffect(() => {
    setMounted(true)
    setOffline(!navigator.onLine)

    const handleOnline = () => {
      setOffline(false)
      // Re-arm the banner so a later disconnection is announced again.
      setOfflineDismissed(false)
    }
    const handleOffline = () => setOffline(true)
    const handleUpdate = () => setUpdateReady(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener(SW_UPDATE_READY_EVENT, handleUpdate)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener(SW_UPDATE_READY_EVENT, handleUpdate)
    }
  }, [])

  const reload = useCallback(() => {
    const activate = async () => {
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration()
          registration?.waiting?.postMessage({ type: 'SKIP_WAITING' })
        }
      } catch {
        /* Fall through to a plain reload — worst case the update lands next visit. */
      }
      window.location.reload()
    }
    void activate()
  }, [])

  if (!mounted) return null

  const showOffline = offline && !offlineDismissed
  const showUpdate = updateReady && !updateDismissed

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[var(--mobile-nav-h)] z-50 flex flex-col gap-2 p-3"
    >
      {showUpdate ? (
        <div className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-3 rounded-card border border-q-violet/40 bg-surface-2 px-4 py-2.5 text-sm text-ink shadow-lg">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full bg-q-violet-text"
          />
          <p className="min-w-0 flex-1">A new version is ready</p>
          <button
            type="button"
            onClick={reload}
            className="btn-primary focus-ring shrink-0 px-3 py-1 text-xs"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => setUpdateDismissed(true)}
            aria-label="Dismiss update notice"
            className="focus-ring shrink-0 rounded-lg px-2 py-1 text-ink-secondary transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      ) : null}

      {showOffline ? (
        <div className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-3 rounded-card border border-q-amber/40 bg-surface-2 px-4 py-2.5 text-sm text-ink shadow-lg">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-q-amber-text" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold text-q-amber-text">You&rsquo;re offline</span>
            <span className="text-ink-secondary">
              {' '}
              — the simulator, visualizations, and course still work.
            </span>
          </p>
          <button
            type="button"
            onClick={() => setOfflineDismissed(true)}
            aria-label="Dismiss offline notice"
            className="focus-ring shrink-0 rounded-lg px-2 py-1 text-ink-secondary transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default OfflineBanner
