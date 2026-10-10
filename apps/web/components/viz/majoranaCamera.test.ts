import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fallbackCameraAngles } from './MajoranaSphere'
import { projectOrtho } from '@/lib/viz/majoranaGeometry'
import { placeOrbitCamera, toThree } from './blochFrame'

/**
 * Regression test for a real shipped bug: the 2-D fallback's `yaw` formula
 * used to be `π − azimuth`, which mirrors the WebGL scene left-right for any
 * star off the polar axis. This test builds the actual 3-D camera (three.js,
 * the same `placeOrbitCamera` the WebGL scene uses) and the actual 2-D
 * fallback projection (`projectOrtho` fed by `fallbackCameraAngles`), and
 * checks they agree on which SIDE of the screen a star lands on — not just
 * that they compile, since the mirror bug produced plausible-looking, wrong
 * output that only a cross-projection comparison like this one catches.
 */
describe('fallbackCameraAngles', () => {
  const testOrbits = [
    { azimuth: 1.1, polar: 1.3 },
    { azimuth: -0.6, polar: 2.0 },
    { azimuth: 2.4, polar: 0.9 },
  ]
  const testStars: [number, number, number][] = [
    [0.5, 0.2, Math.sqrt(1 - 0.25 - 0.04)],
    [-0.5, 0.2, 0.843],
    [0.3, -0.4, 0.866],
    [-0.6, -0.3, 0.742],
    [0.1, 0.7, 0.7],
  ]

  it('agrees in screen-x sign with the real 3-D camera projection, for every star off the polar axis', () => {
    for (const { azimuth, polar } of testOrbits) {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
      placeOrbitCamera(camera, 5, azimuth, polar)
      camera.updateMatrixWorld()
      const { yaw, pitch } = fallbackCameraAngles(azimuth, polar)

      for (const [x, y, z] of testStars) {
        const worldPoint = toThree(x, y, z)
        const ndc = worldPoint.clone().project(camera)
        const orth = projectOrtho({ x, y, z }, yaw, pitch, 0, 0, 1)
        // Same side of the screen (allowing near-zero as either, since a star
        // almost dead-center is not where a mirror bug is observable).
        if (Math.abs(ndc.x) > 0.05 && Math.abs(orth.sx) > 0.05) {
          expect(Math.sign(orth.sx), `azimuth=${azimuth} polar=${polar} star=(${x},${y},${z})`).toBe(
            Math.sign(ndc.x)
          )
        }
      }
    }
  })

  it('keeps the previously-correct pitch formula (π/2 − polar)', () => {
    expect(fallbackCameraAngles(1.1, 1.3).pitch).toBeCloseTo(Math.PI / 2 - 1.3, 10)
  })
})
