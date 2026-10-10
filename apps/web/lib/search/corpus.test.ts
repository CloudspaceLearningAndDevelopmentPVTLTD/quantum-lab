/**
 * corpus.test.ts — the ⌘K index still finds every lesson, and still contains no
 * lesson body.
 *
 * Why this file exists now: `lib/search/corpus.ts` is the module that put the
 * whole course into the client bundle. It is imported by CommandPalette, which
 * is in the root layout, so whatever it reaches is on every page. It only ever
 * wanted titles, subtitles and objectives — the split in `lib/lessons` makes
 * that the only thing it CAN read, and these cases pin both halves of that:
 * the search results are still complete, and the index is still text-free below
 * the metadata line.
 *
 * NOTE FOR WHOEVER RUNS THIS NEXT: `buildCorpus()` also reads `EXAMS` from
 * `lib/exams/questions.ts`. At the time of writing that module has stopped
 * exporting `EXAMS` (a concurrent edit), so `buildCorpus()` throws
 * "EXAMS is not iterable" and these tests fail — as does the ⌘K palette on
 * every route, at runtime, in the browser. That is a real defect in that file,
 * not in this one; nothing here depends on it being fixed a particular way.
 */

import { describe, expect, it } from 'vitest'

import { LESSONS } from '@/lib/lessons'
import { allFullLessons } from '@/lib/lessons/server'
import { buildCorpus } from './corpus'

describe('search corpus', () => {
  it('indexes every lesson, by title and by objective', () => {
    const docs = buildCorpus().filter((doc) => doc.kind === 'lesson')
    expect(docs).toHaveLength(LESSONS.length)

    for (const lesson of LESSONS) {
      const doc = docs.find((d) => d.href === `/learn/${lesson.slug}`)
      expect(doc, `${lesson.slug} is missing from search`).toBeDefined()
      expect(doc!.title).toBe(lesson.title)
      expect(doc!.subtitle).toBe(lesson.subtitle)

      // Objectives are what a learner actually types ("measure a qubit"), so
      // their words have to be in the keyword set, not just the title's.
      const keywords = doc!.keywords.join(' ').toLowerCase()
      for (const objective of lesson.objectives) {
        const word = objective
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 6 && /^[a-z]+$/.test(w))[0]
        if (!word) continue
        expect(keywords, `${lesson.slug}: "${word}" is not searchable`).toContain(word)
      }
    }
  })

  it('carries no lesson body text into the client-side index', () => {
    // The corpus is built in the browser on every page. If a body sentence can
    // be found in it, the paywalled course is back in the bundle by another
    // door — through search rather than through LESSONS.
    const serialised = JSON.stringify(buildCorpus())
    let sampled = 0
    for (const lesson of allFullLessons()) {
      for (const block of lesson.blocks) {
        if (block.kind !== 'prose') continue
        for (const paragraph of block.paragraphs) {
          const probe = paragraph.trim().slice(0, 60)
          if (probe.length < 60) continue
          sampled += 1
          expect(serialised, `${lesson.slug} prose is in the search index`).not.toContain(probe)
        }
      }
    }
    expect(sampled, 'no prose was sampled — the fixture is broken').toBeGreaterThan(50)
  })
})
