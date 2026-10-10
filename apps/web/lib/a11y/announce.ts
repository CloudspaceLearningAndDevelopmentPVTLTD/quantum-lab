/**
 * Screen-reader announcements.
 *
 * A sighted user sees a result appear, a gate land on a wire, a verdict flip to
 * "passed". A screen-reader user gets nothing unless the change is written into
 * a live region that already existed when the change happened — which is why
 * these two regions are created once, up front, and reused.
 *
 * Two gotchas this module exists to handle:
 *
 *  1. A live region must be IN THE DOM BEFORE the text changes. Rendering
 *     `<div aria-live>` and its message in the same commit is frequently
 *     missed by assistive tech. Both regions here are appended on first use.
 *  2. Setting a live region's text to the value it ALREADY has announces
 *     nothing. "Ran 1024 shots" twice in a row is silence the second time.
 *     `announce()` therefore clears the node first and sets the text on the
 *     next frame, which forces a fresh announcement every call.
 *
 * SSR-safe (every entry point checks for `document`) and never throws — an
 * announcement failing must not take a feature down with it.
 */

export type AnnouncePriority = 'polite' | 'assertive'

interface Region {
  node: HTMLElement
  timer: number | null
}

const regions: Record<AnnouncePriority, Region | null> = {
  polite: null,
  assertive: null,
}

/** Styles that hide an element visually while leaving it in the a11y tree. */
function applyVisuallyHidden(el: HTMLElement): void {
  const s = el.style
  s.position = 'absolute'
  s.width = '1px'
  s.height = '1px'
  s.margin = '-1px'
  s.padding = '0'
  s.border = '0'
  s.overflow = 'hidden'
  s.clip = 'rect(0 0 0 0)'
  s.clipPath = 'inset(50%)'
  s.whiteSpace = 'nowrap'
}

function getRegion(priority: AnnouncePriority): Region | null {
  if (typeof document === 'undefined' || document.body === null) return null

  const existing = regions[priority]
  // A hot reload (or a stray removeChild) can detach the node; rebuild if so.
  if (existing && existing.node.isConnected) return existing

  const node = document.createElement('div')
  node.setAttribute('aria-live', priority)
  // 'additions text' is the useful default: we always replace the whole text.
  node.setAttribute('aria-atomic', 'true')
  node.setAttribute('role', priority === 'assertive' ? 'alert' : 'status')
  node.setAttribute('data-a11y-live', priority)
  applyVisuallyHidden(node)
  document.body.appendChild(node)

  const region: Region = { node, timer: null }
  regions[priority] = region
  return region
}

/**
 * Announce `message` to screen readers.
 *
 * @param message  Plain text. Empty/whitespace-only messages are ignored.
 * @param priority `'polite'` (default) waits for a pause; `'assertive'`
 *                 interrupts — reserve it for errors and expiring timers.
 */
export function announce(message: string, priority: AnnouncePriority = 'polite'): void {
  try {
    const text = message.trim()
    if (text === '') return

    const region = getRegion(priority)
    if (!region) return // SSR, or the document is gone

    if (region.timer !== null) {
      window.clearTimeout(region.timer)
      region.timer = null
    }

    // Clear first — setting identical text announces nothing at all.
    region.node.textContent = ''
    region.timer = window.setTimeout(() => {
      region.timer = null
      region.node.textContent = text
    }, 60)
  } catch {
    // An announcement is never worth an exception.
  }
}

/** Empty both regions. Useful when navigating away from a noisy surface. */
export function clearAnnouncements(): void {
  try {
    for (const priority of ['polite', 'assertive'] as const) {
      const region = regions[priority]
      if (!region) continue
      if (region.timer !== null) {
        window.clearTimeout(region.timer)
        region.timer = null
      }
      region.node.textContent = ''
    }
  } catch {
    // no-op
  }
}

/** Test seam: drop the regions so the next announce() rebuilds them. */
export function __resetAnnouncerForTests(): void {
  for (const priority of ['polite', 'assertive'] as const) {
    const region = regions[priority]
    if (region?.node.parentNode) region.node.parentNode.removeChild(region.node)
    regions[priority] = null
  }
}
