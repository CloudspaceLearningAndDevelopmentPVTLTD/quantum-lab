/**
 * The frame-loop gate every visualization on this site is required to have.
 *
 * A rAF loop keeps firing at 60 Hz in a background tab in some browsers, and always
 * keeps firing when the canvas has been scrolled a screen away. The eight older labs
 * each carry a hand-written copy of this gate (IntersectionObserver + visibilitychange
 * + teardown); the review that found them all running forever is described in
 * TunnelingLab.tsx, which has the measured before/after callback counts.
 *
 * This module is that gate, extracted so the three labs added in this batch share one
 * implementation and so the behaviour can be unit-tested in node — the older copies
 * cannot be, because they are welded inside a useEffect that needs a canvas.
 *
 * Structural host types rather than `Window`/`Document`: the browser objects satisfy
 * them, and a test can supply a fake without a DOM. `createFrameLoop(window, document,
 * el, onFrame)` is the production call.
 */

export interface FrameHost {
  requestAnimationFrame(cb: (t: number) => void): number
  cancelAnimationFrame(id: number): void
}

export interface VisibilityHost {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', fn: () => void): void
  removeEventListener(type: 'visibilitychange', fn: () => void): void
}

/**
 * Told whether the element is on screen. Returns its own teardown.
 * Production passes a wrapper around IntersectionObserver; tests pass a stub; a
 * browser without IntersectionObserver passes null and the loop treats the element
 * as always on screen (degrading to the old always-on behaviour rather than to a
 * canvas that never paints).
 */
export type IntersectionWatcher = (onChange: (onScreen: boolean) => void) => () => void

export interface FrameLoop {
  /** Ask for a frame. No-op if already scheduled, or if gated off. */
  start(): void
  /** Cancel any scheduled frame. Does not change the gate state. */
  stop(): void
  /** True while a frame is scheduled. */
  isRunning(): boolean
  /** True when both gates are open — i.e. `start()` would actually schedule. */
  canRun(): boolean
  /** Remove every listener and cancel any pending frame. Idempotent. */
  dispose(): void
}

/**
 * @param onFrame called with the rAF timestamp. Return `true` to request another
 *   frame, `false` to go idle until something calls `start()` again. Returning
 *   `false` is how a settled easing animation or a reduced-motion render stops.
 */
export function createFrameLoop(
  frames: FrameHost,
  visibility: VisibilityHost,
  watchIntersection: IntersectionWatcher | null,
  onFrame: (now: number) => boolean
): FrameLoop {
  let handle: number | null = null
  let disposed = false
  let pageVisible = !visibility.hidden
  // Assume on screen until an observer says otherwise. IntersectionObserver fires an
  // initial callback on observe(), so this is only the value for the first frame or
  // two; assuming false instead would leave a canvas blank when no observer exists.
  let onScreen = true

  const canRun = () => !disposed && pageVisible && onScreen

  const tick = (now: number): void => {
    handle = null
    let again = false
    try {
      again = onFrame(now)
    } finally {
      // Reschedule in `finally` so a throw inside onFrame stops the loop instead of
      // producing one exception per frame forever.
      if (again && canRun() && handle === null) {
        handle = frames.requestAnimationFrame(tick)
      }
    }
  }

  const start = (): void => {
    if (handle === null && canRun()) handle = frames.requestAnimationFrame(tick)
  }

  const stop = (): void => {
    if (handle !== null) {
      frames.cancelAnimationFrame(handle)
      handle = null
    }
  }

  const onVisibilityChange = (): void => {
    pageVisible = !visibility.hidden
    if (pageVisible) start()
    else stop()
  }
  visibility.addEventListener('visibilitychange', onVisibilityChange)

  const unwatch = watchIntersection
    ? watchIntersection((visible) => {
        onScreen = visible
        if (visible) start()
        else stop()
      })
    : null

  return {
    start,
    stop,
    isRunning: () => handle !== null,
    canRun,
    dispose: () => {
      if (disposed) return
      disposed = true
      stop()
      visibility.removeEventListener('visibilitychange', onVisibilityChange)
      unwatch?.()
    },
  }
}

/**
 * The production IntersectionWatcher. `rootMargin: '128px'` matches the eight older
 * labs: the loop wakes just before the canvas scrolls into view, so the first visible
 * frame is already painted.
 */
export function domIntersectionWatcher(el: Element): IntersectionWatcher | null {
  if (typeof IntersectionObserver !== 'function') return null
  return (onChange) => {
    const observer = new IntersectionObserver(
      (entries) => onChange(entries.some((e) => e.isIntersecting)),
      { rootMargin: '128px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }
}

/**
 * Re-read theme tokens when the class on <html> changes, and repaint immediately —
 * a theme toggle must be reflected even while the loop is paused off-screen.
 * Returns a teardown, or a no-op where MutationObserver does not exist.
 */
export function watchThemeChange(onChange: () => void): () => void {
  if (typeof MutationObserver !== 'function' || typeof document === 'undefined') {
    return () => {}
  }
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** True when the user has asked for reduced motion. Safe to call during an effect. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
