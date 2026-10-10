import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { VISUALIZATIONS } from '@/lib/visualizations'
import { formatEntry } from './DensityMatrixView'

/**
 * Wiring for /visualizations/density-matrix: the catalogue entry the layout,
 * OG card and JSON-LD all key on, the files that must exist beside it, and
 * the number formatter every cell of the matrix passes through.
 */

const HREF = '/visualizations/density-matrix'
const ROUTE_DIR = path.resolve(__dirname, '..', '..', 'app', 'visualizations', 'density-matrix')

describe('density-matrix catalogue entry', () => {
  it('is registered once, Advanced, violet, with a single-emoji icon', () => {
    const entries = VISUALIZATIONS.filter((v) => v.href === HREF)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.level).toBe('Advanced')
    expect(entry.accent).toBe('violet')
    expect(entry.title).toBe('Mixed States and the Density Matrix')
    expect(entry.hook.length).toBeGreaterThan(30)
    expect([...entry.icon].length).toBeLessThanOrEqual(2)
  })

  it('has its page, layout and OG image beside each other', () => {
    for (const f of ['page.tsx', 'layout.tsx', 'opengraph-image.tsx']) {
      expect(fs.existsSync(path.join(ROUTE_DIR, f)), f).toBe(true)
    }
    const layout = fs.readFileSync(path.join(ROUTE_DIR, 'layout.tsx'), 'utf8')
    expect(layout).toContain(`path: '${HREF}'`)
    expect(layout).toContain('vizPageSchemas(HREF)')
  })

  it('is cross-linked from the decoherence page', () => {
    const decoherence = fs.readFileSync(
      path.resolve(ROUTE_DIR, '..', 'decoherence', 'page.tsx'),
      'utf8'
    )
    expect(decoherence).toContain(`href="${HREF}"`)
  })
})

describe('formatEntry', () => {
  it('prints reals, imaginaries and both with proper minus signs', () => {
    expect(formatEntry({ re: 0.5, im: 0 })).toBe('0.50')
    expect(formatEntry({ re: -0.5, im: 0 })).toBe('−0.50')
    expect(formatEntry({ re: 0, im: 0.5 })).toBe('0.50i')
    expect(formatEntry({ re: 0, im: -0.5 })).toBe('−0.50i')
    expect(formatEntry({ re: 0.25, im: -0.25 })).toBe('0.25 − 0.25i')
    expect(formatEntry({ re: -0.25, im: 0.25 })).toBe('−0.25 + 0.25i')
  })

  it('rounds float dust to a clean zero instead of "-0.00"', () => {
    expect(formatEntry({ re: -1e-17, im: 3e-17 })).toBe('0.00')
    expect(formatEntry({ re: 0.5, im: -2e-16 })).toBe('0.50')
  })

  it('honours the digit count', () => {
    expect(formatEntry({ re: 1 / 3, im: 0 }, 3)).toBe('0.333')
  })
})
