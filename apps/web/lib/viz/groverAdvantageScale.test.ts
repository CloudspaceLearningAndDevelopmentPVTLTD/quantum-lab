import { describe, expect, it } from 'vitest'
import { formatCount } from '@/app/visualizations/grover/page'

// formatCount backs the "Quantum advantage at scale" section on
// /visualizations/grover — the slider drives search-space sizes from 2^4 up
// to 2^50, so the formatter has to stay readable across roughly 15 orders of
// magnitude, not just the small numbers the rest of the page ever produces.

describe('formatCount', () => {
  it('formats small integers plainly, with thousands separators', () => {
    expect(formatCount(16)).toBe('16')
    expect(formatCount(1_000)).toBe('1,000')
    expect(formatCount(999_999)).toBe('999,999')
  })

  it('rounds a non-integer plain count to the nearest whole number', () => {
    // classicalAvg = n / 2 for an odd n is the only non-integer input this
    // function ever actually receives.
    expect(formatCount(500_000.5)).toBe('500,001')
  })

  it('switches to scientific notation at one million and above', () => {
    expect(formatCount(1_000_000)).toBe('1.00 × 10^6')
    expect(formatCount(2 ** 20)).toBe('1.05 × 10^6')
  })

  it('stays readable at the top of the slider range (2^50)', () => {
    expect(formatCount(2 ** 50)).toBe('1.13 × 10^15')
  })

  it('never produces the raw "e+" exponent notation', () => {
    expect(formatCount(2 ** 40)).not.toContain('e+')
  })
})
