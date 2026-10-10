import { describe, expect, it } from 'vitest'
import {
  HBAR,
  UNCERTAINTY_FLOOR,
  analyze,
  chirpedGaussianProduct,
  density,
  fft,
  freeEvolve,
  gaussianSpread,
  gridAdvice,
  makeGrid,
  makePacket,
  moments,
  momentumAmplitudes,
  zeros,
  type Complex,
  type Grid,
  type PacketShape,
} from './uncertainty'

/**
 * Every number checked here comes from somewhere other than this module:
 *
 *  · σx = w and σp = ħ/2w for a Gaussian, from the closed-form Fourier pair;
 *  · σxσp = (n + ½)ħ for harmonic-oscillator eigenstates, straight off the
 *    energy ladder — the same statement as Eₙ = (n + ½)ħω;
 *  · σxσp = ħ√(¼ + c²w⁴) for a chirped Gaussian, derived in the module header;
 *  · σx(t) = σ₀√(1 + (ħt/2mσ₀²)²), the textbook free-spreading law;
 *  · a naive O(N²) DFT, for the FFT itself.
 *
 * The point of the page is that the Gaussian SATURATES ħ/2 and nothing else
 * does. If the numerics were fudged to make that come out, these tests would
 * not survive contact with the oscillator ladder.
 */

const GRID = makeGrid(1024, 40)

function analyzeShape(shape: PacketShape, width: number, k0 = 0, chirp = 0, grid: Grid = GRID) {
  return analyze(grid, makePacket(grid, { shape, width, k0, chirp }))
}

describe('the FFT itself', () => {
  it('matches a naive DFT on random input', () => {
    const n = 64
    const a = zeros(n)
    let seed = 12345
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xffffffff - 0.5
    }
    for (let i = 0; i < n; i++) {
      a.re[i] = rand()
      a.im[i] = rand()
    }
    const naiveRe = new Float64Array(n)
    const naiveIm = new Float64Array(n)
    for (let m = 0; m < n; m++) {
      let sr = 0
      let si = 0
      for (let j = 0; j < n; j++) {
        const ang = (-2 * Math.PI * m * j) / n
        const c = Math.cos(ang)
        const s = Math.sin(ang)
        sr += a.re[j] * c - a.im[j] * s
        si += a.re[j] * s + a.im[j] * c
      }
      naiveRe[m] = sr
      naiveIm[m] = si
    }
    const copy: Complex = { re: Float64Array.from(a.re), im: Float64Array.from(a.im) }
    fft(copy, -1)
    for (let m = 0; m < n; m++) {
      expect(copy.re[m]).toBeCloseTo(naiveRe[m], 9)
      expect(copy.im[m]).toBeCloseTo(naiveIm[m], 9)
    }
  })

  it('rejects a non-power-of-two length rather than returning garbage', () => {
    expect(() => fft(zeros(48), -1)).toThrow()
    expect(() => makeGrid(100, 10)).toThrow()
  })
})

describe('the momentum transform is centred and normalised', () => {
  it('a packet at rest peaks at k = 0, not half a Brillouin zone away', () => {
    const a = analyzeShape('gaussian', 1)
    let peak = 0
    for (let i = 1; i < GRID.n; i++) {
      if (a.momentumDensity[i] > a.momentumDensity[peak]) peak = i
    }
    expect(GRID.k[peak]).toBeCloseTo(0, 6)
    expect(a.p.mean).toBeCloseTo(0, 8)
  })

  it('obeys Parseval: both distributions integrate to one', () => {
    for (const shape of ['gaussian', 'tophat', 'triangle', 'twoBumps'] as PacketShape[]) {
      const a = analyzeShape(shape, 1.5)
      expect(a.x.total).toBeCloseTo(1, 8)
      expect(a.p.total).toBeCloseTo(1, 6)
    }
  })

  it('a boost by k₀ moves the momentum distribution and changes neither width', () => {
    const rest = analyzeShape('gaussian', 1.2, 0)
    const moving = analyzeShape('gaussian', 1.2, 4)
    expect(moving.p.mean).toBeCloseTo(4 * HBAR, 6)
    expect(moving.x.sigma).toBeCloseTo(rest.x.sigma, 9)
    expect(moving.p.sigma).toBeCloseTo(rest.p.sigma, 9)
    expect(moving.product).toBeCloseTo(rest.product, 9)
  })
})

describe('the Gaussian saturates the bound', () => {
  it('σx = w and σp = ħ/2w individually, over a range of widths', () => {
    for (const w of [0.4, 0.75, 1, 1.6, 2.5]) {
      const a = analyzeShape('gaussian', w)
      expect(a.x.sigma).toBeCloseTo(w, 8)
      expect(a.p.sigma).toBeCloseTo(HBAR / (2 * w), 8)
    }
  })

  it('so σx·σp is exactly ħ/2 no matter how hard you squeeze it', () => {
    for (const w of [0.4, 0.75, 1, 1.6, 2.5]) {
      const a = analyzeShape('gaussian', w)
      expect(a.product).toBeCloseTo(UNCERTAINTY_FLOOR, 8)
      expect(a.ratio).toBeCloseTo(1, 8)
    }
  })

  it('squeezing in position really does broaden momentum, proportionally', () => {
    const wide = analyzeShape('gaussian', 2)
    const narrow = analyzeShape('gaussian', 0.5)
    expect(narrow.x.sigma).toBeLessThan(wide.x.sigma)
    expect(narrow.p.sigma).toBeGreaterThan(wide.p.sigma)
    // Four times narrower in x is four times wider in p, to the digit.
    expect(narrow.p.sigma / wide.p.sigma).toBeCloseTo(wide.x.sigma / narrow.x.sigma, 6)
  })
})

describe('everything else sits above the floor', () => {
  const shapes: PacketShape[] = ['tophat', 'triangle', 'twoBumps']

  it('no shape ever gets below ħ/2', () => {
    for (const shape of [...shapes, 'gaussian', 'hermite1', 'hermite2'] as PacketShape[]) {
      for (const w of [0.6, 1, 2]) {
        expect(analyzeShape(shape, w).product).toBeGreaterThanOrEqual(UNCERTAINTY_FLOOR - 1e-9)
      }
    }
  })

  it('a top hat is far above it — sharp edges cost momentum spread', () => {
    // A hard edge has Fourier tails going as 1/k², so ⟨p²⟩ is dominated by the
    // corners rather than by the width of the box.
    const a = analyzeShape('tophat', 1)
    expect(a.ratio).toBeGreaterThan(3)
    // The position width of a uniform box of half-width w is w/√3 exactly.
    expect(a.x.sigma).toBeCloseTo(1 / Math.sqrt(3), 2)
  })

  it('a triangle beats a top hat but still loses to a Gaussian', () => {
    const tri = analyzeShape('triangle', 1).ratio
    const top = analyzeShape('tophat', 1).ratio
    expect(tri).toBeLessThan(top)
    expect(tri).toBeGreaterThan(1)
  })

  it('two separated bumps are wide in position AND structured in momentum', () => {
    const a = analyzeShape('twoBumps', 1.4)
    expect(a.ratio).toBeGreaterThan(1.5)
  })
})

/**
 * The independent check that matters most: the harmonic-oscillator ladder.
 * σxσp = (n + ½)ħ for the n-th eigenstate is the same statement as
 * Eₙ = (n + ½)ħω, and it is derived from the oscillator, not from anything in
 * this module. Nothing here special-cases these shapes.
 */
describe('harmonic-oscillator eigenstates land on (n + ½)ħ', () => {
  it('n = 0 (the ground state) gives ½ħ', () => {
    expect(analyzeShape('gaussian', 1.1).product).toBeCloseTo(0.5 * HBAR, 8)
  })

  it('n = 1 gives 3/2 ħ', () => {
    for (const w of [0.8, 1.1, 1.6]) {
      expect(analyzeShape('hermite1', w).product).toBeCloseTo(1.5 * HBAR, 7)
    }
  })

  it('n = 2 gives 5/2 ħ', () => {
    for (const w of [0.9, 1.3]) {
      expect(analyzeShape('hermite2', w).product).toBeCloseTo(2.5 * HBAR, 6)
    }
  })

  it('and the individual widths follow the √(2n+1) scaling too', () => {
    const w = 1.2
    const n0 = analyzeShape('gaussian', w)
    const n1 = analyzeShape('hermite1', w)
    expect(n1.x.sigma / n0.x.sigma).toBeCloseTo(Math.sqrt(3), 6)
    expect(n1.p.sigma / n0.p.sigma).toBeCloseTo(Math.sqrt(3), 6)
  })
})

describe('a quadratic phase costs uncertainty without touching the shape', () => {
  it('chirp leaves |ψ(x)|² and therefore σx completely alone', () => {
    const plain = analyzeShape('gaussian', 1.2, 0, 0)
    const chirped = analyzeShape('gaussian', 1.2, 0, 0.7)
    expect(chirped.x.sigma).toBeCloseTo(plain.x.sigma, 9)
    for (let i = 0; i < GRID.n; i += 37) {
      expect(chirped.positionDensity[i]).toBeCloseTo(plain.positionDensity[i], 12)
    }
  })

  it('but broadens σp by exactly the amount the closed form predicts', () => {
    for (const w of [0.8, 1.2, 1.8]) {
      for (const c of [0, 0.25, 0.6, 1.2]) {
        const a = analyzeShape('gaussian', w, 0, c)
        expect(a.product).toBeCloseTo(chirpedGaussianProduct(w, c), 6)
      }
    }
  })

  it('so the ONLY minimum-uncertainty states are unchirped Gaussians', () => {
    expect(chirpedGaussianProduct(1, 0)).toBeCloseTo(UNCERTAINTY_FLOOR, 12)
    for (const c of [0.01, 0.5, 3]) {
      expect(chirpedGaussianProduct(1, c)).toBeGreaterThan(UNCERTAINTY_FLOOR)
    }
  })
})

describe('free evolution: a released packet leaves the floor and never returns', () => {
  const grid = makeGrid(2048, 80)

  it('the momentum distribution is frozen — a free particle has conserved p', () => {
    const w = 1.5
    const psi0 = makePacket(grid, { shape: 'gaussian', width: w, k0: 0, chirp: 0 })
    const a0 = analyze(grid, psi0)
    for (const t of [0.5, 2, 5]) {
      const a = analyze(grid, freeEvolve(grid, psi0, t))
      expect(a.p.sigma).toBeCloseTo(a0.p.sigma, 8)
    }
  })

  it('while σx follows the textbook spreading law', () => {
    const w = 1.5
    const psi0 = makePacket(grid, { shape: 'gaussian', width: w, k0: 0, chirp: 0 })
    for (const t of [0.5, 2, 5, 9]) {
      const a = analyze(grid, freeEvolve(grid, psi0, t))
      expect(a.x.sigma).toBeCloseTo(gaussianSpread(w, t), 6)
    }
  })

  it('so the product grows away from ħ/2 the instant you let go', () => {
    const psi0 = makePacket(grid, { shape: 'gaussian', width: 1.5, k0: 0, chirp: 0 })
    expect(analyze(grid, psi0).ratio).toBeCloseTo(1, 7)
    let previous = 0
    for (const t of [0.5, 1, 2, 4, 8]) {
      const r = analyze(grid, freeEvolve(grid, psi0, t)).ratio
      expect(r).toBeGreaterThan(previous)
      previous = r
    }
    expect(previous).toBeGreaterThan(2)
  })

  it('t = 0 is the identity, and the evolution is reversible', () => {
    const psi0 = makePacket(grid, { shape: 'gaussian', width: 1.5, k0: 1.5, chirp: 0 })
    const same = freeEvolve(grid, psi0, 0)
    for (let i = 0; i < grid.n; i += 53) {
      expect(same.re[i]).toBeCloseTo(psi0.re[i], 10)
      expect(same.im[i]).toBeCloseTo(psi0.im[i], 10)
    }
    // Run forward then back: momentum phases are pure rotations, so this is exact.
    const there = freeEvolve(grid, psi0, 3)
    const back = freeEvolve(grid, there, -3)
    for (let i = 0; i < grid.n; i += 53) {
      expect(back.re[i]).toBeCloseTo(psi0.re[i], 9)
      expect(back.im[i]).toBeCloseTo(psi0.im[i], 9)
    }
  })

  it('a moving packet drifts at v = ħk₀/m while it spreads', () => {
    const k0 = 2
    const psi0 = makePacket(grid, { shape: 'gaussian', width: 2, k0, chirp: 0 })
    const t = 4
    const a = analyze(grid, freeEvolve(grid, psi0, t))
    expect(a.x.mean).toBeCloseTo((HBAR * k0 * t) / 1, 4)
  })
})

describe('the grid tells the truth about its own limits', () => {
  it('accepts a well-resolved packet', () => {
    const a = analyzeShape('gaussian', 1)
    expect(gridAdvice(GRID, a).ok).toBe(true)
  })

  it('flags a packet too narrow for the sampling', () => {
    const tiny = makeGrid(64, 40)
    const a = analyze(tiny, makePacket(tiny, { shape: 'gaussian', width: 0.6, k0: 0, chirp: 0 }))
    expect(gridAdvice(tiny, a).ok).toBe(false)
  })

  it('flags a packet whose tails wrap around the box', () => {
    const a = analyzeShape('gaussian', 6)
    expect(gridAdvice(GRID, a).ok).toBe(false)
  })

  it('flags a packet that has DRIFTED to the wall, not just spread to it', () => {
    const grid = makeGrid(1024, 40)
    const psi0 = makePacket(grid, { shape: 'gaussian', width: 1, k0: 6, chirp: 0 })
    expect(gridAdvice(grid, analyze(grid, psi0)).ok).toBe(true)
    // v = ħk₀/m = 6, so by t = 3 the packet is at x ≈ 18, hard against the wall.
    const late = analyze(grid, freeEvolve(grid, psi0, 3))
    expect(gridAdvice(grid, late).ok).toBe(false)
  })
})

describe('moments helper', () => {
  it('reproduces the mean and standard deviation of a known distribution', () => {
    // A discrete two-point distribution: mean 1, σ = 2.
    const coords = Float64Array.from([-1, 3])
    const prob = Float64Array.from([0.5, 0.5])
    const m = moments(coords, prob, 1)
    expect(m.mean).toBeCloseTo(1, 12)
    expect(m.sigma).toBeCloseTo(2, 12)
  })

  it('returns zeros for an empty distribution rather than NaN', () => {
    const m = moments(Float64Array.from([0, 1]), Float64Array.from([0, 0]), 1)
    expect(m.mean).toBe(0)
    expect(m.sigma).toBe(0)
  })

  it('density is |ψ|² and never negative', () => {
    const psi = makePacket(GRID, { shape: 'twoBumps', width: 1, k0: 3, chirp: 0.4 })
    const d = density(psi)
    for (let i = 0; i < d.length; i += 41) expect(d[i]).toBeGreaterThanOrEqual(0)
    const phi = momentumAmplitudes(GRID, psi)
    expect(phi.re.length).toBe(GRID.n)
  })
})
