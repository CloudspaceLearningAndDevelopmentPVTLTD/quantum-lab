import { describe, it, expect } from 'vitest'
import {
  createFrameLoop,
  type FrameHost,
  type IntersectionWatcher,
  type VisibilityHost,
} from './frameLoop'

/**
 * These tests exist because "the rAF loop pauses off-screen" was, for the whole of
 * this product's first eight visualizations, a claim nobody could check without
 * driving a browser. The gate is now a plain function with injected hosts, so the
 * three properties that matter — pauses when hidden, pauses when off-screen, cancels
 * on dispose — are assertable in node.
 */

function makeFrames() {
  let next = 1
  const pending = new Map<number, (t: number) => void>()
  const cancelled: number[] = []
  const host: FrameHost = {
    requestAnimationFrame(cb) {
      const id = next++
      pending.set(id, cb)
      return id
    },
    cancelAnimationFrame(id) {
      cancelled.push(id)
      pending.delete(id)
    },
  }
  return {
    host,
    cancelled,
    pendingCount: () => pending.size,
    /** Run every currently scheduled callback once. Returns how many ran. */
    flush(now = 0): number {
      const callbacks = Array.from(pending.entries())
      pending.clear()
      for (const [, cb] of callbacks) cb(now)
      return callbacks.length
    },
  }
}

function makeVisibility() {
  const listeners = new Set<() => void>()
  const state = { hidden: false }
  const host: VisibilityHost = {
    get hidden() {
      return state.hidden
    },
    addEventListener(_type, fn) {
      listeners.add(fn)
    },
    removeEventListener(_type, fn) {
      listeners.delete(fn)
    },
  }
  return {
    host,
    listenerCount: () => listeners.size,
    setHidden(hidden: boolean) {
      state.hidden = hidden
      for (const fn of Array.from(listeners)) fn()
    },
  }
}

function makeWatcher() {
  let notify: ((onScreen: boolean) => void) | null = null
  let disposed = false
  const watcher: IntersectionWatcher = (onChange) => {
    notify = onChange
    return () => {
      disposed = true
      notify = null
    }
  }
  return {
    watcher,
    set(onScreen: boolean) {
      notify?.(onScreen)
    },
    wasDisposed: () => disposed,
  }
}

describe('createFrameLoop', () => {
  it('runs frames while visible and on screen', () => {
    const frames = makeFrames()
    const visibility = makeVisibility()
    let count = 0
    const loop = createFrameLoop(frames.host, visibility.host, null, () => {
      count += 1
      return true
    })
    loop.start()
    for (let i = 0; i < 5; i++) frames.flush(i * 16)
    expect(count).toBe(5)
    loop.dispose()
  })

  it('stops scheduling once the page is hidden, and resumes when it comes back', () => {
    const frames = makeFrames()
    const visibility = makeVisibility()
    let count = 0
    const loop = createFrameLoop(frames.host, visibility.host, null, () => {
      count += 1
      return true
    })
    loop.start()
    frames.flush()
    frames.flush()
    expect(count).toBe(2)

    visibility.setHidden(true)
    expect(loop.isRunning()).toBe(false)
    expect(frames.pendingCount()).toBe(0)
    // Nothing left to flush: the loop is genuinely off, not merely returning early.
    expect(frames.flush()).toBe(0)
    expect(count).toBe(2)

    visibility.setHidden(false)
    expect(loop.isRunning()).toBe(true)
    frames.flush()
    expect(count).toBe(3)
    loop.dispose()
  })

  it('stops scheduling when the element scrolls off screen', () => {
    const frames = makeFrames()
    const visibility = makeVisibility()
    const watcher = makeWatcher()
    let count = 0
    const loop = createFrameLoop(frames.host, visibility.host, watcher.watcher, () => {
      count += 1
      return true
    })
    loop.start()
    frames.flush()
    expect(count).toBe(1)

    watcher.set(false)
    expect(loop.canRun()).toBe(false)
    expect(frames.flush()).toBe(0)
    // start() must not override the gate — a control change on an off-screen canvas
    // used to be exactly how these loops woke back up.
    loop.start()
    expect(frames.pendingCount()).toBe(0)
    expect(count).toBe(1)

    watcher.set(true)
    frames.flush()
    expect(count).toBe(2)
    loop.dispose()
  })

  it('needs BOTH gates open, not either', () => {
    const frames = makeFrames()
    const visibility = makeVisibility()
    const watcher = makeWatcher()
    const loop = createFrameLoop(frames.host, visibility.host, watcher.watcher, () => true)
    watcher.set(false)
    visibility.setHidden(true)
    expect(loop.canRun()).toBe(false)
    // Coming back on screen while the tab is still hidden must not restart it.
    watcher.set(true)
    expect(loop.canRun()).toBe(false)
    expect(frames.pendingCount()).toBe(0)
    visibility.setHidden(false)
    expect(loop.canRun()).toBe(true)
    loop.dispose()
  })

  it('goes idle when onFrame returns false, and start() wakes it again', () => {
    const frames = makeFrames()
    const visibility = makeVisibility()
    let more = true
    let count = 0
    const loop = createFrameLoop(frames.host, visibility.host, null, () => {
      count += 1
      return more
    })
    loop.start()
    frames.flush()
    more = false
    frames.flush()
    expect(count).toBe(2)
    expect(loop.isRunning()).toBe(false)
    expect(frames.flush()).toBe(0)

    loop.start()
    frames.flush()
    expect(count).toBe(3)
    loop.dispose()
  })

  it('dispose cancels the pending frame, removes the listener and unwatches', () => {
    const frames = makeFrames()
    const visibility = makeVisibility()
    const watcher = makeWatcher()
    const loop = createFrameLoop(frames.host, visibility.host, watcher.watcher, () => true)
    loop.start()
    expect(frames.pendingCount()).toBe(1)
    expect(visibility.listenerCount()).toBe(1)

    loop.dispose()
    expect(frames.cancelled.length).toBe(1)
    expect(frames.pendingCount()).toBe(0)
    expect(visibility.listenerCount()).toBe(0)
    expect(watcher.wasDisposed()).toBe(true)
    // A disposed loop must stay disposed even if something still holds a reference.
    loop.start()
    expect(frames.pendingCount()).toBe(0)
    loop.dispose()
  })

  it('a throwing onFrame stops the loop instead of throwing once per frame forever', () => {
    const frames = makeFrames()
    const visibility = makeVisibility()
    const loop = createFrameLoop(frames.host, visibility.host, null, () => {
      throw new Error('render blew up')
    })
    loop.start()
    expect(() => frames.flush()).toThrow(/render blew up/)
    expect(frames.pendingCount()).toBe(0)
    expect(loop.isRunning()).toBe(false)
    loop.dispose()
  })

  it('starts paused when the page is already hidden at construction', () => {
    const frames = makeFrames()
    const visibility = makeVisibility()
    visibility.setHidden(true)
    const loop = createFrameLoop(frames.host, visibility.host, null, () => true)
    loop.start()
    expect(frames.pendingCount()).toBe(0)
    loop.dispose()
  })
})
