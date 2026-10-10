import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { VISUALIZATIONS } from './visualizations'
import { WORKBENCH } from './workbench'
import { PLAN_BY_ID } from './plans'
import { clampDescription, hasOwnSocialCard, pageMetadata } from './seo'
import { CHALLENGES } from './challenges/catalogue'

/**
 * The meta-description length rule, made checkable.
 *
 * docs/SEO.md states the house rule — descriptions stay under ~155 characters,
 * because Google truncates around there and a description cut mid-clause reads
 * as carelessness in the one place a stranger meets the page. It was a rule
 * nothing enforced, so when sixteen visualizations landed in one wave every
 * single one overshot it (the worst by 70 characters) and the doc quietly
 * became false.
 *
 * This reads the descriptions the same way a crawler eventually would: off the
 * route's own metadata source. Importing the route modules instead is not an
 * option here — `layout.tsx` pulls in React components and next/font — so the
 * literal is read out of the file. That is coarse but it is the thing being
 * asserted: a number of characters in a string a human typed.
 */

const APP_DIR = path.resolve(__dirname, '..', 'app')

/** Google's truncation point, near enough. Also the number docs/SEO.md quotes. */
const MAX_DESCRIPTION = 155

/** The `description: '…'` passed to `pageMetadata` in a route's metadata file. */
const DESCRIPTION_RE = /description:\s*\n?\s*'((?:[^'\\]|\\.)*)'/

function metadataFileFor(href: string): string {
  const dir = path.join(APP_DIR, href.replace(/^\//, ''))
  for (const name of ['layout.tsx', 'page.tsx']) {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) {
      const source = fs.readFileSync(file, 'utf8')
      if (source.includes('pageMetadata(')) return file
    }
  }
  throw new Error(`no metadata file calling pageMetadata() for ${href}`)
}

function descriptionOf(href: string): string {
  const file = metadataFileFor(href)
  const match = fs.readFileSync(file, 'utf8').match(DESCRIPTION_RE)
  if (!match) throw new Error(`no description literal in ${file}`)
  // The literal is source; `\'` is one character to a crawler, not two.
  return match[1].replace(/\\'/g, "'")
}

describe('visualization meta descriptions', () => {
  it('covers every route in the catalogue', () => {
    // Guards the guard: if a page stops calling pageMetadata, fail loudly here
    // rather than silently checking nothing.
    for (const viz of VISUALIZATIONS) {
      expect(descriptionOf(viz.href).length, viz.href).toBeGreaterThan(0)
    }
    expect(VISUALIZATIONS.length).toBeGreaterThanOrEqual(28)
  })

  for (const viz of VISUALIZATIONS) {
    it(`${viz.href} fits in a search result`, () => {
      const description = descriptionOf(viz.href)
      expect(
        description.length,
        `${viz.href}: ${description.length} characters, over the ${MAX_DESCRIPTION} limit — ` +
          `Google will cut it mid-sentence. Trim it, load-bearing clause first.`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTION)
    })
  }
})

describe('site meta descriptions', () => {
  // Every other public, statically-described route (i.e. not driven by a
  // catalogue and not `generateMetadata`'d from one, which the two loops
  // above already cover, and not `noIndex` — /account, /admin, /instructor,
  // /offline, /embed/circuit carry no ranking risk from an overlong
  // description). docs/SEO.md named four of these as "not yet trimmed" by
  // hand; this is that check made permanent instead of re-drifting silently.
  //
  // /simulator and /visualizations are deliberately absent from this list:
  // both interpolate a number (qubit limits, catalogue length) into a
  // template literal, so DESCRIPTION_RE's single-quoted-string match can't
  // read them off the source file. That is exactly why they had drifted to
  // 226 and 186 characters respectively before this pass — a regex-based
  // check that silently skips the two computed cases is worse than no check,
  // so they get their own tests below that compute the real string instead.
  const routes = [
    '/about',
    '/compare',
    '/educators',
    '/help',
    '/privacy',
    '/terms',
    '/contact',
    '/compete',
    '/welcome',
    '/learn',
    '/learn/certificate',
    '/pricing',
    '/hardware',
    '/insights',
    '/coach',
    '/circuits',
    '/tutor',
    '/challenges',
    '/certify',
  ]

  it('covers every route in the list', () => {
    for (const href of routes) {
      expect(descriptionOf(href).length, href).toBeGreaterThan(0)
    }
  })

  for (const href of routes) {
    it(`${href} fits in a search result`, () => {
      const description = descriptionOf(href)
      expect(
        description.length,
        `${href}: ${description.length} characters, over the ${MAX_DESCRIPTION} limit — ` +
          `Google will cut it mid-sentence. Trim it, load-bearing clause first.`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTION)
    })
  }

  // The two computed cases the regex above cannot see. Each string here must
  // be kept byte-for-byte in sync with its layout.tsx — that duplication is
  // the price of actually catching a number that grows the string past the
  // limit (a new plan tier, a 40th visualization) instead of trusting a human
  // to notice.
  it('/simulator fits in a search result', () => {
    const FREE_QUBITS = PLAN_BY_ID.free.limits.maxQubits
    const MAX_QUBITS = PLAN_BY_ID.edu.limits.maxQubits
    const description =
      `A state-vector quantum circuit simulator that runs in your browser — ${FREE_QUBITS} qubits ` +
      `free, up to ${MAX_QUBITS} on a paid plan. Inspect amplitudes, export OpenQASM 3.`
    expect(
      description.length,
      `/simulator: ${description.length} characters, over the ${MAX_DESCRIPTION} limit.`,
    ).toBeLessThanOrEqual(MAX_DESCRIPTION)
  })

  it('/visualizations fits in a search result', () => {
    const COUNT = VISUALIZATIONS.length
    const description =
      `${COUNT} live quantum simulations — double slit, Bloch sphere, entanglement, tunneling, ` +
      `Grover, the QFT. Every frame is computed from the state as you watch.`
    expect(
      description.length,
      `/visualizations: ${description.length} characters, over the ${MAX_DESCRIPTION} limit.`,
    ).toBeLessThanOrEqual(MAX_DESCRIPTION)
  })
})

describe('workbench meta descriptions', () => {
  // The workbench index plus every tool in its catalogue. The visualization
  // loop above never saw these routes, so all nine overshot the limit while
  // the test stayed green — the exact failure the file comment describes.
  const routes = ['/workbench', ...WORKBENCH.map((tool) => tool.href)]

  it('covers every workbench route', () => {
    for (const href of routes) {
      expect(descriptionOf(href).length, href).toBeGreaterThan(0)
    }
    expect(WORKBENCH.length).toBeGreaterThanOrEqual(8)
  })

  for (const href of routes) {
    it(`${href} fits in a search result`, () => {
      const description = descriptionOf(href)
      expect(
        description.length,
        `${href}: ${description.length} characters, over the ${MAX_DESCRIPTION} limit — ` +
          `Google will cut it mid-sentence. Trim it, load-bearing clause first.`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTION)
    })
  }
})

describe('clampDescription', () => {
  it('leaves a description that already fits alone', () => {
    expect(clampDescription('Short and done.')).toBe('Short and done.')
  })

  it('keeps whole sentences while they fit', () => {
    const first = 'Build a Bell pair from two qubits that start in zero, using one Hadamard and one CNOT.'
    const text = `${first} ${'Then a much longer second sentence that pushes the total well past the limit. '.repeat(3)}`
    expect(clampDescription(text)).toBe(first)
  })

  it('cuts one overlong sentence at a word boundary and marks it', () => {
    const text = 'word '.repeat(60).trim() + '.'
    const out = clampDescription(text)
    expect(out.length).toBeLessThanOrEqual(155)
    expect(out.endsWith('word…')).toBe(true)
  })

  it('does not stop at a sentence too short to be a description', () => {
    const out = clampDescription(`Hi. ${'word '.repeat(60)}`)
    expect(out.length).toBeGreaterThan(100)
    expect(out.length).toBeLessThanOrEqual(155)
  })

  it('brings every challenge description under the limit', () => {
    // These are built from the brief, which runs to several hundred characters.
    for (const challenge of CHALLENGES) {
      const meta = pageMetadata({ title: challenge.title, description: challenge.brief, path: `/challenges/${challenge.id}` })
      expect(String(meta.description).length, challenge.id).toBeLessThanOrEqual(155)
      expect(String(meta.description).length, challenge.id).toBeGreaterThan(40)
    }
  })
})

describe('pageMetadata social image', () => {
  it('names the site card on a route without its own, so it still unfurls with an image', () => {
    const meta = pageMetadata({ title: 'T', description: 'D', path: '/x' })
    expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: '/opengraph-image', width: 1200, height: 630 })])
    expect(meta.twitter?.images).toEqual([expect.objectContaining({ url: '/opengraph-image' })])
  })

  it('names nothing on a route with its own card, so the file is what gets served', () => {
    for (const path of ['/visualizations/qft', '/workbench/noise', '/learn/shor']) {
      const meta = pageMetadata({ title: 'T', description: 'D', path })
      expect(meta.openGraph && 'images' in meta.openGraph, path).toBe(false)
      expect(meta.twitter && 'images' in meta.twitter, path).toBe(false)
    }
  })

  // hasOwnSocialCard is a pattern list; this is what keeps it true. Every
  // directory under app/ is a route, and it either has a card file or not.
  const routeDirs: { route: string; hasCard: boolean }[] = []
  const walk = (dir: string, route: string) => {
    const names = fs.readdirSync(dir)
    if (names.includes('page.tsx')) routeDirs.push({ route: route || '/', hasCard: names.includes('opengraph-image.tsx') })
    for (const name of names) {
      const full = path.join(dir, name)
      // Private folders, route groups and API handlers are not pages.
      if (!fs.statSync(full).isDirectory() || name.startsWith('_') || name === 'api') continue
      // A dynamic segment stands for any value; 'sample' is as good as another.
      walk(full, `${route}/${name.startsWith('[') ? 'sample' : name}`)
    }
  }
  walk(APP_DIR, '')

  it('finds the routes it is checking', () => {
    expect(routeDirs.length).toBeGreaterThan(80)
    expect(routeDirs.filter((r) => r.hasCard).length).toBeGreaterThan(50)
  })

  for (const { route, hasCard } of routeDirs) {
    // The root card is the default itself, and '/' does not go through pageMetadata.
    if (route === '/') continue
    it(`${route} ${hasCard ? 'has' : 'has no'} card file, and hasOwnSocialCard agrees`, () => {
      expect(hasOwnSocialCard(route)).toBe(hasCard)
    })
  }
})
