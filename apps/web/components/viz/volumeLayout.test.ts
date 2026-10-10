import { describe, expect, it } from 'vitest'
import { boxVolume, oscillatorVolume } from '@/lib/quantum/schrodinger3d'
import { toThree } from './blochFrame'
import {
  BOX_WORLD_SIZE,
  boxWorldScale,
  clampOffset,
  clipPlanePlacement,
  clipPlaneTransform,
  clipUniform,
  dragToOffsetDelta,
  encodeVolumeRgba,
  fitDistance,
  fitRect,
  orbitPosition,
  paintSlice,
  parseHex,
  phaseColor,
  physicalExtent,
  physicsToThree,
  transferVisibility,
} from './volumeLayout'

describe('box sizing', () => {
  it('maps physics z-up to three.js y-up with a proper rotation (det +1), matching blochFrame.ts', () => {
    // (x, y, z) → (x, z, −y): the same convention as blochFrame.ts's toThree,
    // not a plain axis swap — a plain swap has determinant −1 (a mirror) and
    // was the CRITICAL bug this test used to enshrine as "correct".
    expect(physicsToThree([1, 2, 3])).toEqual([1, 3, -2])
  })

  it('is a proper rotation: right-handed in, right-handed out', () => {
    // det([Tx, Ty, Tz]) = +1 for a rotation, −1 for a mirror. Check it via
    // the identity T(e1)·(T(e2)×T(e3)) = det(T) for the standard basis,
    // independent of any hand-derived matrix.
    const ex = physicsToThree([1, 0, 0])
    const ey = physicsToThree([0, 1, 0])
    const ez = physicsToThree([0, 0, 1])
    const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]
    const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const c = cross(ey, ez)
    expect(dot(ex, c)).toBeCloseTo(1, 10) // +1: proper rotation, not a mirror
  })

  it('agrees with blochFrame.ts\'s toThree — one house convention, cross-checked against the already-fixed Bloch code', () => {
    const samples: [number, number, number][] = [
      [1, 2, 3],
      [-0.4, 0.9, -1.7],
      [0, 0, 0],
      [5, -5, 5],
    ]
    for (const v of samples) {
      const viaVolume = physicsToThree(v)
      const viaBloch = toThree(v[0], v[1], v[2])
      expect(viaVolume[0]).toBeCloseTo(viaBloch.x, 10)
      expect(viaVolume[1]).toBeCloseTo(viaBloch.y, 10)
      expect(viaVolume[2]).toBeCloseTo(viaBloch.z, 10)
    }
  })

  it('scales the longest physical edge to BOX_WORLD_SIZE, in three.js axis order', () => {
    const v = boxVolume({ n: [1, 1, 1], L: [1, 2, 4], resolution: 8 })
    const ext = physicalExtent(v)
    // Voxel centres sit half a step in from each wall, so the extent is the full L.
    expect(ext[0]).toBeCloseTo(1, 10)
    expect(ext[1]).toBeCloseTo(2, 10)
    expect(ext[2]).toBeCloseTo(4, 10)
    const s = boxWorldScale(v)
    expect(s[0]).toBeCloseTo(BOX_WORLD_SIZE / 4, 10) // x
    expect(s[1]).toBeCloseTo(BOX_WORLD_SIZE, 10) // three y = physics z (the long edge)
    expect(s[2]).toBeCloseTo(BOX_WORLD_SIZE / 2, 10) // three z = physics y
  })

  it('never produces NaN for a degenerate volume', () => {
    const s = boxWorldScale({ min: [0, 0, 0], max: [0, 0, 0], spacing: [0, 0, 0] })
    expect(s.every((x) => Number.isFinite(x) && x > 0)).toBe(true)
  })
})

describe('camera framing', () => {
  it('fits the bounding sphere at any aspect and never collapses to zero', () => {
    const scale: [number, number, number] = [1.6, 1.6, 1.6]
    const r = 0.5 * Math.hypot(1.6, 1.6, 1.6)
    // At aspect 1 with fov 38°, the sphere fits when d·sin(19°) ≥ r.
    const d = fitDistance(scale, 38, 1)
    expect(d * Math.sin((19 * Math.PI) / 180)).toBeGreaterThanOrEqual(r)
    // A tall phone viewport (aspect 0.5) needs the camera further back.
    expect(fitDistance(scale, 38, 0.5)).toBeGreaterThan(d)
    // A wide viewport does not need it any closer than the vertical fit.
    expect(fitDistance(scale, 38, 3)).toBeCloseTo(d, 10)
    // Zero-size first paint: aspect NaN / 0 must not blow up.
    expect(Number.isFinite(fitDistance(scale, 38, NaN))).toBe(true)
    expect(Number.isFinite(fitDistance(scale, 38, 0))).toBe(true)
    expect(fitDistance([0, 0, 0], 38, 1)).toBeGreaterThanOrEqual(0.5)
  })

  it('orbit positions lie on the sphere and clamp the poles', () => {
    const p = orbitPosition(3, 0.4, 1.1)
    expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(3, 10)
    const top = orbitPosition(3, 0, 0)
    expect(top[1]).toBeLessThan(3) // never exactly on the pole, so lookAt stays defined
    expect(top[1]).toBeGreaterThan(2.9)
  })
})

describe('texture encoding', () => {
  it('square-root encodes density and maps phase (−π, π] onto a byte', () => {
    const rgba = encodeVolumeRgba({
      density: new Float32Array([0, 0.25, 1]),
      phase: new Float32Array([-Math.PI, 0, Math.PI]),
      maxDensity: 1,
    })
    expect(Array.from(rgba.subarray(0, 4))).toEqual([0, 0, 0, 255])
    expect(Array.from(rgba.subarray(4, 8))).toEqual([128, 128, 0, 255]) // √0.25 = 0.5
    expect(Array.from(rgba.subarray(8, 12))).toEqual([255, 255, 0, 255])
  })

  it('handles an all-zero volume without dividing by zero', () => {
    const rgba = encodeVolumeRgba({
      density: new Float32Array(4),
      phase: new Float32Array(4),
      maxDensity: 0,
    })
    expect(Array.from(rgba).every((b) => Number.isFinite(b))).toBe(true)
    expect(rgba[0]).toBe(0)
  })
})

describe('clip plane', () => {
  it('clamps offsets', () => {
    expect(clampOffset(-1)).toBe(0)
    expect(clampOffset(2)).toBe(1)
    expect(clampOffset(NaN)).toBe(0.5)
    expect(clampOffset(0.3)).toBe(0.3)
  })

  it('disabled → a half-space nothing fails', () => {
    expect(clipUniform(undefined)[3]).toBeGreaterThan(1e6)
    expect(clipUniform({ axis: 'z', offset: 0.5, enabled: false })[3]).toBeGreaterThan(1e6)
  })

  it('keeps the −axis side: offset 0.5 removes exactly half', () => {
    // Physics z is three y, so a z-normal plane is (0, 1, 0) in the shader.
    expect(clipUniform({ axis: 'z', offset: 0.5, enabled: true })).toEqual([0, 1, 0, 0])
    expect(clipUniform({ axis: 'x', offset: 1, enabled: true })).toEqual([1, 0, 0, 0.5])
    // Physics y → three (0, 0, −1) (physicsToThree's proper-rotation convention).
    expect(clipUniform({ axis: 'y', offset: 0, enabled: true })).toEqual([0, 0, -1, -0.5])
  })

  it('places the quad at the right face with the right cross-section', () => {
    const scale: [number, number, number] = [1, 2, 3] // three x, y, z
    const px = clipPlanePlacement({ axis: 'x', offset: 0.75, enabled: true }, scale)
    expect(px.center).toEqual([0.25, 0, 0])
    expect(px.normal).toEqual([1, 0, 0])
    expect(px.size).toEqual([2, 3])
    const pz = clipPlanePlacement({ axis: 'z', offset: 0, enabled: true }, scale)
    expect(pz.center).toEqual([0, -1, 0])
    expect(pz.normal).toEqual([0, 1, 0])
  })

  it('rotations turn a +z-normal quad to face each axis', () => {
    // Rotate the plane's local normal (0,0,1) and local x (1,0,0) by the Euler XYZ
    // rotation and check where they land, independent of three.js.
    const rot = (r: [number, number, number], v: [number, number, number]) => {
      let [x, y, z] = v
      // X
      let c = Math.cos(r[0])
      let s = Math.sin(r[0])
      ;[y, z] = [y * c - z * s, y * s + z * c]
      // Y
      c = Math.cos(r[1])
      s = Math.sin(r[1])
      ;[x, z] = [x * c + z * s, -x * s + z * c]
      // Z
      c = Math.cos(r[2])
      s = Math.sin(r[2])
      ;[x, y] = [x * c - y * s, x * s + y * c]
      // `+ 0` folds a −0 born of floating-point noise (e.g. sin(π) ≈ 1.2e-16
      // rounding to −0) into 0, so it compares equal to the plain 0 literals below.
      return [x, y, z].map((q) => Math.round(q * 1e9) / 1e9 + 0)
    }
    const scale: [number, number, number] = [1, 2, 3]
    const tx = clipPlaneTransform('x', scale)
    expect(rot(tx.rotation, [0, 0, 1])).toEqual([1, 0, 0])
    expect(rot(tx.rotation, [1, 0, 0])).toEqual([0, 0, -1]) // local x → three −z, size[0] = scale[2]
    expect(tx.size).toEqual([3, 2])
    expect(tx.length).toBe(1)
    const ty = clipPlaneTransform('y', scale)
    // physicsToThree([0, 1, 0]) = (0, 0, −1): the quad's normal must land there.
    expect(rot(ty.rotation, [0, 0, 1])).toEqual([0, 0, -1])
    expect(ty.size).toEqual([1, 2])
    expect(ty.length).toBe(3)
    const tz = clipPlaneTransform('z', scale)
    expect(rot(tz.rotation, [0, 0, 1])).toEqual([0, 1, 0])
    expect(rot(tz.rotation, [1, 0, 0])).toEqual([1, 0, 0])
    expect(rot(tz.rotation, [0, 1, 0])).toEqual([0, 0, -1]) // local y → three −z, size[1] = scale[2]
    expect(tz.size).toEqual([1, 3])
    expect(tz.length).toBe(2)
  })

  it('maps a drag along the projected normal to an offset delta, and ignores a foreshortened normal', () => {
    // Orthographic-ish projection: world x → +200 px per unit, world y → −200 px (screen down).
    const project = (p: [number, number, number]): [number, number] => [100 + p[0] * 200, 100 - p[1] * 200]
    // The box is 1.6 long along the normal, so a full traversal is 320 px.
    expect(dragToOffsetDelta([32, 0], [1, 0, 0], 1.6, project)).toBeCloseTo(0.1, 10)
    expect(dragToOffsetDelta([-160, 0], [1, 0, 0], 1.6, project)).toBeCloseTo(-0.5, 10)
    // Perpendicular drag does nothing.
    expect(dragToOffsetDelta([0, 50], [1, 0, 0], 1.6, project)).toBeCloseTo(0, 10)
    // A y-normal plane moves with vertical drag, with screen-down = −world-y.
    expect(dragToOffsetDelta([0, -32], [0, 1, 0], 1.6, project)).toBeCloseTo(0.1, 10)
    // Looking straight down the normal: it projects to a point → 0, not NaN.
    expect(dragToOffsetDelta([50, 50], [0, 0, 1], 1.6, project)).toBe(0)
  })
})

describe('colour', () => {
  it('parses hex and falls back on anything else', () => {
    expect(parseHex('#ff0080', [0, 0, 0])).toEqual([1, 0, 128 / 255])
    expect(parseHex('oklch(0.7 0.1 250)', [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3])
  })

  it('phase wheel hits its stops at 0, π/2, π, 3π/2 and wraps', () => {
    const wheel: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
    ]
    expect(phaseColor(0, wheel)).toEqual([1, 0, 0])
    expect(phaseColor(Math.PI / 2, wheel).map((c) => Math.round(c * 1e6) / 1e6)).toEqual([0, 1, 0])
    expect(phaseColor(Math.PI, wheel).map((c) => Math.round(c * 1e6) / 1e6)).toEqual([0, 0, 1])
    expect(phaseColor(-Math.PI / 2, wheel).map((c) => Math.round(c * 1e6) / 1e6)).toEqual([1, 1, 0])
    // Midway between stops 0 and 1.
    expect(phaseColor(Math.PI / 4, wheel).map((c) => Math.round(c * 1e6) / 1e6)).toEqual([0.5, 0.5, 0])
    // −π and +π are the same colour.
    expect(phaseColor(-Math.PI, wheel).map((c) => Math.round(c * 1e6) / 1e6)).toEqual(
      phaseColor(Math.PI, wheel).map((c) => Math.round(c * 1e6) / 1e6)
    )
  })

  it('transfer visibility re-scales above the threshold', () => {
    expect(transferVisibility(0.01, 0.02)).toBe(0)
    expect(transferVisibility(0.02, 0.02)).toBe(0)
    expect(transferVisibility(1, 0.02)).toBe(1)
    expect(transferVisibility(0.51, 0.02)).toBeCloseTo(0.5, 10)
    expect(transferVisibility(0.5, 0)).toBe(0.5)
  })
})

describe('slice painting (the 2-D fallback)', () => {
  const palette = {
    low: [0, 0, 1] as [number, number, number],
    high: [1, 1, 1] as [number, number, number],
    phase: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
    ] as [[number, number, number], [number, number, number], [number, number, number], [number, number, number]],
  }

  it('is oriented with the higher physics axis up, and background where density is zero', () => {
    const v = oscillatorVolume({ n: [0, 0, 1], omega: [1, 1, 1], resolution: 16 })
    // x-normal slice through the centre: horizontal y, vertical z.
    const s = paintSlice(v, {
      axis: 'x',
      offset: 0.5,
      threshold: 0,
      colorMode: 'phase',
      palette,
      background: [0, 0, 0],
    })
    expect(s.width).toBe(16)
    expect(s.height).toBe(16)
    expect(s.horizontal).toBe('y')
    expect(s.vertical).toBe('z')
    // n_z = 1: ψ ∝ z e^{−z²/2}, positive above the equator (top rows) → phase 0 → red.
    const topPixel = Array.from(s.rgba.subarray((2 * 16 + 8) * 4, (2 * 16 + 8) * 4 + 3))
    const bottomPixel = Array.from(s.rgba.subarray((13 * 16 + 8) * 4, (13 * 16 + 8) * 4 + 3))
    expect(topPixel[0]).toBeGreaterThan(topPixel[2])
    expect(bottomPixel[2]).toBeGreaterThan(bottomPixel[0])
    // The corner of the grid is far into the Gaussian tail: it paints the background.
    expect(Array.from(s.rgba.subarray(0, 3))).toEqual([0, 0, 0])
    expect(s.rgba[3]).toBe(255)
  })

  it('density mode ramps low → high with the brightest pixel at the peak', () => {
    const v = boxVolume({ n: [1, 1, 1], L: [1, 1, 1], resolution: 9 })
    const s = paintSlice(v, {
      axis: 'z',
      offset: 0.5,
      threshold: 0,
      colorMode: 'density',
      palette,
      background: [0, 0, 0],
    })
    const centre = (4 * 9 + 4) * 4
    expect(Array.from(s.rgba.subarray(centre, centre + 3))).toEqual([255, 255, 255])
    const edge = (0 * 9 + 0) * 4
    expect(s.rgba[edge]).toBeLessThan(s.rgba[centre])
  })

  it('fits a rectangle without ever going negative', () => {
    expect(fitRect(16, 8, 100, 100)).toEqual({ x: 0, y: 25, width: 100, height: 50 })
    expect(fitRect(16, 8, 0, 0)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(fitRect(0, 8, 100, 100)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
