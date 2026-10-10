import { describe, it, expect } from 'vitest'
import { createHistory, push, undo, redo, canUndo, canRedo, MAX_PAST } from './history'

describe('history', () => {
  it('push then undo returns the previous value', () => {
    const h0 = createHistory('a')
    const h1 = push(h0, 'b')
    const h2 = undo(h1)
    expect(h2.present).toBe('a')
  })

  it('undo at the start of history is a no-op', () => {
    const h0 = createHistory('a')
    const h1 = undo(h0)
    expect(h1).toBe(h0)
    expect(h1.present).toBe('a')
    expect(canUndo(h1)).toBe(false)
  })

  it('redo after undo restores the pushed value', () => {
    const h0 = createHistory('a')
    const h1 = push(h0, 'b')
    const h2 = undo(h1)
    const h3 = redo(h2)
    expect(h3.present).toBe('b')
    expect(canRedo(h3)).toBe(false)
  })

  it('pushing after an undo clears the redo stack', () => {
    const h0 = createHistory('a')
    const h1 = push(h0, 'b')
    const h2 = undo(h1)
    expect(canRedo(h2)).toBe(true)
    const h3 = push(h2, 'c')
    expect(h3.future).toEqual([])
    expect(canRedo(h3)).toBe(false)
    expect(h3.present).toBe('c')
    // 'b' was abandoned — undoing 'c' should land back on 'a', not 'b'.
    expect(undo(h3).present).toBe('a')
  })

  it('the 100-entry cap drops the oldest', () => {
    let h = createHistory(0)
    for (let i = 1; i <= MAX_PAST + 5; i++) {
      h = push(h, i)
    }
    expect(h.past.length).toBe(MAX_PAST)
    // The oldest entries (0..4) were dropped; the oldest surviving is 5.
    expect(h.past[0]).toBe(5)
    expect(h.past[h.past.length - 1]).toBe(MAX_PAST + 4)
    expect(h.present).toBe(MAX_PAST + 5)
  })

  it('canUndo/canRedo reflect an empty history', () => {
    const h0 = createHistory('a')
    expect(canUndo(h0)).toBe(false)
    expect(canRedo(h0)).toBe(false)
  })
})
