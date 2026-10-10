/**
 * terms.test.ts — every glossary link lands somewhere real.
 *
 * A glossary entry's `see` links are the whole point of it, so a dead one is a
 * broken promise. They are checked against the catalogues the pages render
 * from, not against a hand-kept list of routes.
 */

import { describe, expect, it } from 'vitest'

import { resolveSeeLink } from './links'
import { GLOSSARY, getTerm } from './terms'

const hrefExists = (href: string) => resolveSeeLink(href) !== null

describe('glossary', () => {
  it('has unique, URL-safe ids', () => {
    const ids = GLOSSARY.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it.each(GLOSSARY.map((t) => [t.id, t] as const))('%s: every see-link resolves', (_id, term) => {
    expect(term.see.length).toBeGreaterThan(0)
    for (const href of term.see) expect(hrefExists(href), `${href} is dead`).toBe(true)
  })

  it.each(GLOSSARY.map((t) => [t.id, t] as const))('%s: related terms exist and are not itself', (_id, term) => {
    for (const rel of term.related ?? []) {
      expect(getTerm(rel), `${rel} is not a glossary id`).toBeDefined()
      expect(rel).not.toBe(term.id)
    }
  })

  it('keeps short definitions to one sentence-sized line', () => {
    for (const term of GLOSSARY) {
      expect(term.short.length, term.id).toBeLessThanOrEqual(170)
      expect(term.short.endsWith('.'), term.id).toBe(true)
    }
  })

  it('the link checker itself rejects dead links', () => {
    expect(hrefExists('/learn/not-a-lesson')).toBe(false)
    expect(hrefExists('/simulator?preset=nope')).toBe(false)
    expect(hrefExists('/nowhere')).toBe(false)
  })
})
