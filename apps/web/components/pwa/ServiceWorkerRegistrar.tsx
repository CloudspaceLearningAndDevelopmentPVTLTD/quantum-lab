'use client'

import { useEffect } from 'react'

/** Fired when a new service worker is installed and waiting to take over. */
export const SW_UPDATE_READY_EVENT = 'ql:sw-update-ready'

/**
 * The build id, inlined at build time by next.config.mjs (`env.NEXT_PUBLIC_BUILD_STAMP`,
 * which is also what `generateBuildId` returns).
 *
 * It goes on the worker's script URL. That is the mechanism that makes a deploy
 * invalidate the service worker cache: public/sw.js is a static file, so a deploy
 * that changes app code but not that file ships identical bytes, the browser's
 * byte-comparison update check finds nothing, and the old cache — including cached
 * HTML pointing at chunk hashes the new deploy does not serve — lives on. A changed
 * query string is a changed script URL, which the browser does install. sw.js reads
 * `?v=` back out of `self.location` to name its cache. See docs/PWA.md.
 *
 * The `?? 'unversioned'` matches sw.js's own fallback rather than skipping
 * registration: if this ever ends up undefined the app should still work offline,
 * just without automatic rotation.
 */
const BUILD_STAMP = process.env.NEXT_PUBLIC_BUILD_STAMP ?? 'unversioned'
const SW_URL = `/sw.js?v=${encodeURIComponent(BUILD_STAMP)}`

/**
 * Registers the service worker. Renders nothing and never blocks paint: registration
 * is deferred to the window `load` event so it cannot compete with the initial render
 * for bandwidth or main-thread time.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // A service worker in development is a debugging nightmare: it caches the dev
    // server's HTML and asset URLs, then keeps serving them over the top of a
    // recompiled bundle, so edits appear not to apply. Never register outside prod.
    if (process.env.NODE_ENV !== 'production') return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    let cancelled = false

    const register = () => {
      // Registration failures (no HTTPS, blocked by policy, storage full, user has
      // disabled site data) must be invisible — the app works fine without a worker.
      navigator.serviceWorker
        // Explicit scope: the script URL now carries a query string, and while that
        // does not affect the default scope (which comes from the path), spelling it
        // out means a future edit to SW_URL cannot silently narrow it.
        .register(SW_URL, { scope: '/' })
        .then((registration) => {
          if (cancelled) return

          const notifyIfWaiting = (worker: ServiceWorker) => {
            // `controller` is null on the very first install. In that case there is no
            // old version on screen, so there is nothing for the user to reload away
            // from and we stay silent.
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent(SW_UPDATE_READY_EVENT))
            }
          }

          // A worker that finished installing before this listener attached.
          if (registration.waiting && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent(SW_UPDATE_READY_EVENT))
          }

          registration.onupdatefound = () => {
            const installing = registration.installing
            if (!installing) return
            installing.addEventListener('statechange', () => {
              notifyIfWaiting(installing)
            })
          }
        })
        .catch(() => {
          /* Silent by design. */
        })
    }

    try {
      if (document.readyState === 'complete') {
        register()
      } else {
        window.addEventListener('load', register, { once: true })
      }
    } catch {
      /* Silent by design. */
    }

    return () => {
      cancelled = true
      window.removeEventListener('load', register)
    }
  }, [])

  return null
}

export default ServiceWorkerRegistrar
