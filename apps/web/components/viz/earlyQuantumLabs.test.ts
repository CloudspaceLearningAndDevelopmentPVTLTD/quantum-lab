import { describe, expect, it } from 'vitest'
import { renderBlackbodyPlot, formatWavelength } from './BlackbodyLab'
import { renderPhotoelectricScene, staticSim } from './PhotoelectricLab'
import { renderSlopePlot } from './PhotoelectricSlopePlot'
import { VIZ_TOKENS, type VizColors } from './theme'
import { METALS, metalById, readout } from '@/lib/viz/photoelectric'
import { REFERENCE_TEMPERATURES } from '@/lib/viz/blackbody'

/**
 * The failure mode these tests exist for: a canvas handed a NaN coordinate draws
 * NOTHING and reports NOTHING. No exception, no warning, no console message — the
 * path is silently discarded and the reader sees an empty box. That is the single
 * most common way a working visualization dies, and it cannot be caught by looking at
 * a screenshot of the state that happens to work.
 *
 * So the three render functions are driven through a recording stub that asserts every
 * numeric argument it is ever handed is finite, and every colour it is assigned is a
 * non-empty string. The stub is not a canvas implementation: nothing is rasterised,
 * and nothing here checks that the picture is *pretty*. It checks that the picture is
 * DRAWN, at the extremes of every control — 2.7 K and 12 589 K, below and above
 * threshold, zero width, a canvas one pixel tall.
 */

type Recorder = {
  ctx: CanvasRenderingContext2D
  calls: number
  /** Distinct drawing operations seen, e.g. 'stroke', 'fillText'. */
  ops: Set<string>
  /** save() minus restore(); must be back to zero when a render returns. */
  saveDepth: () => number
}

const COLOUR_PROPS = new Set(['fillStyle', 'strokeStyle'])

function createRecorder(): Recorder {
  let depth = 0
  const rec: Recorder = {
    ctx: null as unknown as CanvasRenderingContext2D,
    calls: 0,
    ops: new Set(),
    saveDepth: () => depth,
  }
  const store: Record<string, unknown> = {
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    fillStyle: '#000',
    strokeStyle: '#000',
  }

  const target: Record<string, unknown> = {}
  const method =
    (name: string) =>
    (...args: unknown[]) => {
      rec.calls += 1
      rec.ops.add(name)
      for (const arg of args) {
        if (typeof arg === 'number') {
          expect(Number.isFinite(arg), `${name} was handed a non-finite number`).toBe(true)
        }
      }
      // save/restore must balance, so track depth via the stub itself.
      if (name === 'save') depth += 1
      if (name === 'restore') {
        depth -= 1
        expect(depth, 'restore() without a matching save()').toBeGreaterThanOrEqual(0)
      }
      return undefined
    }

  for (const name of [
    'clearRect',
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'arc',
    'arcTo',
    'rect',
    'fill',
    'stroke',
    'fillRect',
    'fillText',
    'save',
    'restore',
    'clip',
    'setLineDash',
    'translate',
    'rotate',
    'setTransform',
    'measureText',
  ]) {
    target[name] = method(name)
  }
  target.measureText = () => ({ width: 10 })

  rec.ctx = new Proxy(target, {
    get: (t, prop: string) => (prop in t ? t[prop] : store[prop]),
    set: (_t, prop: string, value) => {
      if (COLOUR_PROPS.has(prop)) {
        expect(typeof value, `${prop} must be a colour string`).toBe('string')
        expect(String(value).length, `${prop} must not be empty`).toBeGreaterThan(0)
        expect(String(value)).not.toMatch(/NaN|undefined/)
      }
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${prop} was set to a non-finite number`).toBe(true)
      }
      store[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D

  return rec
}

/** The dark-theme fallbacks, which is what readVizColors resolves to outside a browser. */
const COLORS = Object.fromEntries(
  Object.entries(VIZ_TOKENS).map(([key, [, fallback]]) => [key, fallback])
) as VizColors

describe('the recorder itself', () => {
  /**
   * A stub that quietly accepts everything would make every test below pass forever.
   * These four lines are the proof that it does not.
   */
  it('rejects exactly the failures the render tests are looking for', () => {
    expect(() => createRecorder().ctx.lineTo(Number.NaN, 10)).toThrow()
    expect(() => createRecorder().ctx.arc(10, Number.POSITIVE_INFINITY, 3, 0, 6)).toThrow()
    expect(() => {
      createRecorder().ctx.fillStyle = undefined as unknown as string
    }).toThrow()
    expect(() => {
      createRecorder().ctx.lineWidth = Number.NaN
    }).toThrow()
    const rec = createRecorder()
    rec.ctx.save()
    expect(rec.saveDepth()).toBe(1)
    rec.ctx.restore()
    expect(rec.saveDepth()).toBe(0)
  })
})

describe('BlackbodyLab render', () => {
  it('draws at every reference temperature, on both axis scales', () => {
    for (const t of REFERENCE_TEMPERATURES) {
      for (const logScale of [false, true]) {
        for (const showClassical of [false, true]) {
          const rec = createRecorder()
          renderBlackbodyPlot(rec.ctx, t.kelvin, { showClassical, logScale }, 720, 420, COLORS)
          expect(rec.calls, `${t.label} drew nothing`).toBeGreaterThan(50)
          expect(rec.saveDepth(), 'unbalanced save/restore').toBe(0)
          expect(rec.ops.has('stroke')).toBe(true)
          expect(rec.ops.has('fill')).toBe(true)
          expect(rec.ops.has('fillText')).toBe(true)
        }
      }
    }
  })

  it('survives the extremes of the temperature slider', () => {
    // The slider carries log₁₀T over [0.3, 4.1]; both ends, plus absurd inputs.
    for (const T of [Math.pow(10, 0.3), Math.pow(10, 4.1), 1e-3, 1e6]) {
      const rec = createRecorder()
      renderBlackbodyPlot(rec.ctx, T, { showClassical: true, logScale: false }, 720, 420, COLORS)
      expect(rec.calls).toBeGreaterThan(50)
      expect(rec.saveDepth(), 'unbalanced save/restore').toBe(0)
    }
  })

  it('survives degenerate canvas sizes', () => {
    for (const [w, h] of [
      [1, 1],
      [80, 40],
      [4000, 200],
    ]) {
      const rec = createRecorder()
      renderBlackbodyPlot(rec.ctx, 5778, { showClassical: true, logScale: true }, w, h, COLORS)
      expect(rec.calls).toBeGreaterThan(10)
      expect(rec.saveDepth(), 'unbalanced save/restore').toBe(0)
    }
  })

  it('formats wavelengths in the unit a reader would use', () => {
    expect(formatWavelength(501.5)).toBe('502 nm')
    expect(formatWavelength(1034.9)).toBe('1.03 µm')
    expect(formatWavelength(9348)).toBe('9.35 µm')
    expect(formatWavelength(1.073e6)).toBe('1.07 mm')
    expect(formatWavelength(Infinity)).toBe('—')
  })
})

describe('PhotoelectricLab render', () => {
  const scene = (frequencyHz: number, metalId: string, intensity: number, retardingVoltageV: number) => {
    const metal = metalById(metalId)
    const r = readout({
      frequencyHz,
      workFunctionEv: metal.workFunctionEv,
      intensity,
      retardingVoltageV,
    })
    return {
      r,
      sim: staticSim(r, intensity, retardingVoltageV),
      props: {
        readout: r,
        intensity,
        retardingVoltageV,
        metalLabel: `${metal.name} (${metal.symbol})`,
      },
    }
  }

  it('draws above threshold, below threshold and with the lamp off', () => {
    for (const metal of METALS) {
      for (const [fUnits, intensity, retard] of [
        [8, 0.5, 0],
        [20, 1, 3],
        [3, 1, 0], // deep infrared: below threshold for every metal here
        [12, 0, 0], // lamp off
      ]) {
        const { sim, props } = scene(fUnits * 1e14, metal.id, intensity, retard)
        const rec = createRecorder()
        renderPhotoelectricScene(rec.ctx, sim, props, 720, 360, COLORS)
        expect(rec.calls).toBeGreaterThan(30)
        expect(rec.saveDepth(), 'unbalanced save/restore').toBe(0)
        expect(rec.ops.has('fillText')).toBe(true)
      }
    }
  })

  it('emits no electrons below threshold, at full intensity', () => {
    // 3e14 Hz is 1.24 eV, under every work function in the table.
    const { r, sim } = scene(3e14, 'sodium', 1, 0)
    expect(r.emits).toBe(false)
    expect(sim.electrons).toHaveLength(0)
    expect(sim.photons.length).toBeGreaterThan(0)
  })

  it('places the still frame\'s turned-back electrons short of the collector', () => {
    // 1.03 V of retarding voltage against KE_max of 1.03 eV: the slower half turn back.
    const { r, sim } = scene(8e14, 'sodium', 1, r0(8e14))
    expect(r.emits).toBe(true)
    const returning = sim.electrons.filter((e) => e.dir < 0)
    expect(returning.length).toBeGreaterThan(0)
    for (const e of returning) expect(e.u).toBeLessThan(1)
  })

  function r0(frequencyHz: number): number {
    return readout({
      frequencyHz,
      workFunctionEv: metalById('sodium').workFunctionEv,
      intensity: 1,
      retardingVoltageV: 0,
    }).stoppingVoltageV
  }

  it('survives degenerate canvas sizes', () => {
    const { sim, props } = scene(8e14, 'sodium', 0.5, 0.4)
    for (const [w, h] of [
      [1, 1],
      [120, 60],
      [3000, 300],
    ]) {
      const rec = createRecorder()
      renderPhotoelectricScene(rec.ctx, sim, props, w, h, COLORS)
      expect(rec.calls).toBeGreaterThan(10)
      expect(rec.saveDepth(), 'unbalanced save/restore').toBe(0)
    }
  })
})

describe('PhotoelectricSlopePlot render', () => {
  it('draws every metal, and marks a frequency below as well as above threshold', () => {
    for (const metal of METALS) {
      for (const fUnits of [3, 8, 15.4, 20]) {
        const rec = createRecorder()
        renderSlopePlot(rec.ctx, { activeMetal: metal, frequencyHz: fUnits * 1e14 }, 720, 320, COLORS)
        expect(rec.calls).toBeGreaterThan(50)
        expect(rec.saveDepth(), 'unbalanced save/restore').toBe(0)
        expect(rec.ops.has('stroke')).toBe(true)
      }
    }
  })

  it('survives degenerate canvas sizes', () => {
    for (const [w, h] of [
      [1, 1],
      [200, 80],
      [2400, 400],
    ]) {
      const rec = createRecorder()
      renderSlopePlot(rec.ctx, { activeMetal: METALS[0], frequencyHz: 8e14 }, w, h, COLORS)
      expect(rec.calls).toBeGreaterThan(10)
      expect(rec.saveDepth(), 'unbalanced save/restore').toBe(0)
    }
  })
})
