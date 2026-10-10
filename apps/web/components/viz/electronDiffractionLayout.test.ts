import { describe, expect, it } from 'vitest'
import {
  BENCH_HEIGHT,
  DETECTOR_HALF_WIDTH_DEG,
  GUN_SHADOW_DEG,
  buildLayout,
  describeBench,
  describeScan,
  describeXray,
} from './ElectronDiffractionLab'
import { DEFAULT_ELECTRON_MODEL, DEG } from '@/lib/viz/electronDiffraction'

/**
 * The bench is generated geometry. The way it fails is a detector box or an
 * angle label sliding off the canvas at some width, so these walk the widths
 * the page can be rendered at and check the arc, the gun and the crystal all
 * stay inside.
 */

describe('bench layout', () => {
  const widths = [320, 360, 390, 480, 640, 768, 900, 1100]

  it('keeps the detector arc and its labels inside the canvas at every width', () => {
    for (const w of widths) {
      const L = buildLayout(w, BENCH_HEIGHT)
      // Arc ends at ±90°, labels sit 16px beyond the arc.
      expect(L.cx - L.arcR - 16).toBeGreaterThanOrEqual(0)
      expect(L.cx + L.arcR + 16).toBeLessThanOrEqual(w)
      // Top of the arc clears the gun.
      expect(L.cy - L.arcR).toBeGreaterThanOrEqual(L.gunBottom)
      expect(L.gunBottom).toBeGreaterThan(L.gunTop + 20)
      // Crystal sits below the arc centre and above the legend line.
      expect(L.cy + L.crystalH).toBeLessThan(BENCH_HEIGHT - 14)
      expect(L.crystalW).toBeLessThan(w)
    }
  })

  it('detector positions at 10° and 90° both land on the canvas', () => {
    for (const w of widths) {
      const L = buildLayout(w, BENCH_HEIGHT)
      for (const deg of [10, 50, 90]) {
        const x = L.cx + Math.sin(deg * DEG) * L.arcR
        const y = L.cy - Math.cos(deg * DEG) * L.arcR
        expect(x + 13).toBeLessThanOrEqual(w)
        expect(y - 9).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('the aperture is narrower than the gun shadow, so counts mean something', () => {
    expect(DETECTOR_HALF_WIDTH_DEG * 2).toBeLessThan(GUN_SHADOW_DEG)
  })
})

describe('accessible descriptions', () => {
  it('say where the peak is at 54 V and that there is none at 30 V', () => {
    const at54 = describeBench(54, 50, DEFAULT_ELECTRON_MODEL)
    expect(at54).toMatch(/peak is predicted at 50\.\d degrees/)
    expect(at54).toContain('54 volts')
    const at30 = describeBench(30, 50, DEFAULT_ELECTRON_MODEL)
    expect(at30).toContain('no diffraction peak')
  })

  it('name the first and second order voltages for a 50° detector', () => {
    const s = describeScan(54, 50)
    expect(s).toMatch(/First order peaks at 5[45] volts/)
    expect(s).toMatch(/second order at 2[12]\d volts/)
  })

  it('list the (111) line at 48.4° for the 54 V wavelength', () => {
    expect(describeXray(54)).toContain('(111) at 48.4 degrees')
  })
})
