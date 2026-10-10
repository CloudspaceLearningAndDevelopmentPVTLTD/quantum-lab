import { describe, expect, it } from 'vitest'
import { buildCorpus } from './corpus'
import { search } from './rank'

describe('fuzzy initials against the real corpus', () => {
  it('"bs" ranks The Bloch Sphere first', () => {
    expect(search(buildCorpus(), 'bs')[0].doc.title).toBe('The Bloch Sphere')
  })
})
