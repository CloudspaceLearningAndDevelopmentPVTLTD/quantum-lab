/**
 * rank.test.ts — the ⌘K ranking ladder, pinned on small synthetic corpora.
 *
 * The case that motivated it: "bs" must find "The Bloch Sphere". A leading
 * article used to count against the first-hit penalty in the fuzzy tier.
 */

import { describe, expect, it } from 'vitest'

import type { SearchDoc } from './corpus'
import { search } from './rank'

function doc(id: string, title: string, kind: SearchDoc['kind'] = 'visualization'): SearchDoc {
  return { id, kind, title, subtitle: '', href: `/${id}`, keywords: [] }
}

describe('search ranking', () => {
  it('finds "The Bloch Sphere" from its initials, ahead of a preset', () => {
    const corpus = [doc('bell', 'Bell State (Φ+)', 'preset'), doc('bloch', 'The Bloch Sphere')]
    const results = search(corpus, 'bs')
    expect(results[0].doc.id).toBe('bloch')
    expect(results[0].indices).toEqual([4, 10])
  })

  it('does not penalise a leading article in the fuzzy score', () => {
    const [withArticle] = search([doc('a', 'The Bloch Sphere')], 'bs')
    const [without] = search([doc('b', 'Bloch Sphere')], 'bs')
    expect(withArticle.score).toBe(without.score)
  })

  it('still penalises a late first hit that is not an article', () => {
    const [early] = search([doc('a', 'Bloch Sphere')], 'bs')
    const [late] = search([doc('b', 'Quantum Bloch Sphere')], 'bs')
    expect(late.score).toBeLessThan(early.score)
  })
})
