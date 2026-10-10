/**
 * heroQubitScene.ts — the WebGL renderer behind components/ui/HeroQubit.tsx.
 *
 * Loaded with a dynamic import AFTER the page has painted, so three.js
 * (~150 kB gzipped) is never in the home route's First Load JS: the 2D
 * canvas in HeroQubit paints first and stays as the fallback when WebGL is
 * unavailable or the import fails. This module owns nothing but pixels — the
 * qubit's state, the view angles and the theme colours are handed in every
 * frame by the caller, so both renderers draw exactly the same thing.
 *
 * Coordinates: Bloch space is z-up; three.js is y-up. The mapping is
 * (x, y, z)_bloch → (x, z, y)_three, the same one the /visualizations/bloch-
 * sphere page uses, so |0⟩ is at the top of the screen in both.
 */

import * as THREE from 'three'

export interface SceneColors {
  violet: string
  teal: string
  amber: string
  ink: string
  inkMuted: string
  /**
   * Which theme these colours came from.
   *
   * The scene cannot be derived from the five hues alone: light and dark need
   * genuinely different LIGHTING and MATERIAL settings, not just different
   * swatches. Tuned only for the dark canvas it was written against, the light
   * theme rendered a flat grey-lavender ball — the 0.2-opacity glass shell went
   * transparent against white instead of reading as glass, a 1.4-intensity
   * white key light plus a 6-intensity specular blew out what little tint was
   * left, and the depth field (near-black `--ink` specks at 0.35) was invisible
   * on a white ground while contributing nothing but noise where it did land.
   *
   * Defaults to 'dark' so an omitted field keeps the original tuning exactly.
   */
  mode?: 'light' | 'dark'
}

export interface SceneFrame {
  /** Unit Bloch vector. */
  state: [number, number, number]
  yaw: number
  pitch: number
}

export interface HeroScene {
  render(frame: SceneFrame): void
  resize(px: number): void
  /** Screen positions (CSS px, canvas-relative) of the two poles, for HTML labels. */
  poles(): { zero: [number, number]; one: [number, number] }
  dispose(): void
}

const toThree = (v: [number, number, number]) => new THREE.Vector3(v[0], v[2], v[1])

function greatCircle(axis: 'xy' | 'xz' | 'yz', color: THREE.ColorRepresentation, opacity: number) {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const b: [number, number, number] =
      axis === 'xy' ? [c, s, 0] : axis === 'xz' ? [c, 0, s] : [0, c, s]
    pts.push(toThree(b))
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  return new THREE.LineLoop(geo, mat)
}

export function mountHeroScene(canvas: HTMLCanvasElement, colors: SceneColors): HeroScene | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setClearColor(0x000000, 0)

  /**
   * On a light ground the sphere has to hold its own against white rather than
   * glow out of black, so every one of these is turned DOWN except the glass
   * opacity, which is turned up. See SceneColors.mode.
   */
  const light = colors.mode === 'light'
  const L = light
    ? { ambient: 0.62, key: 0.65, fill: 0.22, spec: 1.6, shell: 0.3, shellBack: 0.16, star: 0.22, starColor: colors.inkMuted }
    : { ambient: 0.55, key: 1.4, fill: 0.35, spec: 6, shell: 0.2, shellBack: 0.07, star: 0.35, starColor: colors.ink }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50)
  const CAM_DIST = 4.25

  // ── Lighting: one key, one fill, one rim. Enough for a sphere to read as a
  // sphere without looking like a product render.
  scene.add(new THREE.AmbientLight(0xffffff, L.ambient))
  const key = new THREE.DirectionalLight(0xffffff, L.key)
  key.position.set(2.5, 3.5, 3)
  scene.add(key)
  const fill = new THREE.DirectionalLight(new THREE.Color(colors.teal), L.fill)
  fill.position.set(-3, -1, 2)
  scene.add(fill)
  // A point light that rides with the camera gives the glass a moving
  // specular highlight as the sphere orbits — the strongest single depth cue.
  const spec = new THREE.PointLight(0xffffff, L.spec, 12, 2)
  scene.add(spec)

  // ── Depth field: a few hundred faint points far behind the sphere. They
  // parallax against it as the view orbits, which is what makes the sphere
  // read as an object in space rather than a drawing on a card.
  const starCount = 360
  const starPos = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount; i++) {
    const r = 3.5 + Math.random() * 4
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    starPos[i * 3 + 1] = r * Math.cos(phi)
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: new THREE.Color(L.starColor), size: 0.035, transparent: true, opacity: L.star, sizeAttenuation: true, depthWrite: false }),
  )
  scene.add(stars)

  // ── The sphere: a translucent glass ball with a faint inner glow. Two
  // shells (front and back faces) give it visible thickness and a rim.
  const violet = new THREE.Color(colors.violet)
  const sphereGeo = new THREE.SphereGeometry(1, 64, 48)
  const shellFront = new THREE.Mesh(
    sphereGeo,
    new THREE.MeshPhysicalMaterial({
      color: violet,
      transparent: true,
      opacity: L.shell,
      roughness: 0.18,
      metalness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.25,
      side: THREE.FrontSide,
      depthWrite: false,
    }),
  )
  const shellBack = new THREE.Mesh(
    sphereGeo,
    new THREE.MeshBasicMaterial({ color: violet, transparent: true, opacity: L.shellBack, side: THREE.BackSide, depthWrite: false }),
  )
  scene.add(shellBack, shellFront)

  // ── Great circles and the vertical axis.
  const equator = greatCircle('xy', colors.teal, 0.85)
  const meridianA = greatCircle('xz', colors.inkMuted, 0.35)
  const meridianB = greatCircle('yz', colors.inkMuted, 0.35)
  scene.add(equator, meridianA, meridianB)
  const axisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)])
  scene.add(new THREE.Line(axisGeo, new THREE.LineBasicMaterial({ color: colors.inkMuted, transparent: true, opacity: 0.3 })))

  // ── The state vector: a solid shaft + cone with an emissive tip.
  const arrow = new THREE.Group()
  const shaftLen = 0.82
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, shaftLen, 16),
    new THREE.MeshStandardMaterial({ color: violet, emissive: violet, emissiveIntensity: 0.35, roughness: 0.4 }),
  )
  shaft.position.y = shaftLen / 2
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.18, 24),
    new THREE.MeshStandardMaterial({ color: violet, emissive: violet, emissiveIntensity: 0.5, roughness: 0.35 }),
  )
  head.position.y = shaftLen + 0.09
  const amber = new THREE.Color(colors.amber)
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 24, 16),
    new THREE.MeshStandardMaterial({ color: amber, emissive: amber, emissiveIntensity: 0.9, roughness: 0.3 }),
  )
  tip.position.y = 1
  arrow.add(shaft, head, tip)
  scene.add(arrow)

  // Soft halo at the tip so it reads through the glass from behind.
  const haloTex = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    return new THREE.CanvasTexture(c)
  })()
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: haloTex, color: amber, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false }),
  )
  halo.scale.setScalar(0.42)
  scene.add(halo)

  // Drop line from the tip to the equatorial plane: makes the latitude (the
  // measurement odds) legible at a glance.
  const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
  const drop = new THREE.Line(
    dropGeo,
    new THREE.LineDashedMaterial({ color: amber, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.7 }),
  )
  scene.add(drop)

  const up = new THREE.Vector3(0, 1, 0)
  const q = new THREE.Quaternion()
  const dir = new THREE.Vector3()
  const tipWorld = new THREE.Vector3()
  const foot = new THREE.Vector3()
  let sizePx = 1

  const render = (frame: SceneFrame) => {
    // Camera on an orbit: yaw around the vertical axis, pitch above the
    // equator. Same parameters the 2D fallback uses, so a drag feels identical
    // before and after the upgrade.
    const { yaw, pitch } = frame
    camera.position.set(
      CAM_DIST * Math.cos(pitch) * Math.sin(-yaw),
      CAM_DIST * Math.sin(pitch),
      CAM_DIST * Math.cos(pitch) * Math.cos(-yaw),
    )
    camera.lookAt(0, 0, 0)
    spec.position.copy(camera.position).multiplyScalar(0.7).add(new THREE.Vector3(0.8, 1.2, 0))
    stars.rotation.y = -yaw * 0.35

    dir.copy(toThree(frame.state)).normalize()
    q.setFromUnitVectors(up, dir)
    arrow.quaternion.copy(q)
    tipWorld.copy(dir)
    halo.position.copy(tipWorld)
    foot.set(dir.x, 0, dir.z)
    const pos = dropGeo.attributes.position as THREE.BufferAttribute
    pos.setXYZ(0, tipWorld.x, tipWorld.y, tipWorld.z)
    pos.setXYZ(1, foot.x, foot.y, foot.z)
    pos.needsUpdate = true
    drop.computeLineDistances()

    renderer.render(scene, camera)
  }

  const resize = (px: number) => {
    sizePx = Math.max(1, px)
    renderer.setSize(sizePx, sizePx, false)
    camera.aspect = 1
    camera.updateProjectionMatrix()
  }

  const projected = (v: THREE.Vector3): [number, number] => {
    const p = v.clone().project(camera)
    return [((p.x + 1) / 2) * sizePx, ((1 - p.y) / 2) * sizePx]
  }

  const poles = () => ({
    zero: projected(new THREE.Vector3(0, 1.13, 0)),
    one: projected(new THREE.Vector3(0, -1.13, 0)),
  })

  const dispose = () => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    haloTex.dispose()
    starGeo.dispose()
    renderer.dispose()
  }

  return { render, resize, poles, dispose }
}
