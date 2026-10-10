/**
 * blochFrame.ts — the Bloch sphere's furniture (shell, wire grid, equator and
 * meridians, axes, |0⟩ |1⟩ |+⟩ |i⟩ labels) as a mountable three.js group.
 *
 * This is the scene-setup half of components/viz/BlochSphere.tsx, lifted out so
 * a scene that shows MORE than one point on the sphere (the Majorana stars) can
 * draw the same globe without forking that file. Colours are read from the same
 * CSS custom properties at mount time and re-read by `recolor()` when the theme
 * class on <html> flips; the caller owns the MutationObserver.
 *
 * Coordinates are three.js world space: Bloch (x, y, z) → three (x, z, -y), i.e.
 * +y up is |0⟩, and the sign flip on the third axis keeps the mapping
 * right-handed (det +1) so RZ/S/T rotations spin the visually correct way —
 * see the fix applied to BlochSphere.tsx/DecoherenceLab.tsx. Use `toThree()`
 * for anything placed on the sphere.
 */

import * as THREE from 'three'

export const FRAME_FALLBACKS = {
  violet: '#a99dff',
  line: '#3d5070',
  equator: '#6283c8',
  shell: '#141a2c',
  ink: '#eef2ff',
  skyText: '#8faae0',
  tealText: '#8ae8da',
} as const

/** Read a CSS custom property off <html>, falling back if it is unset. */
export function readVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Bloch (x, y, z) → three.js (x, z, -y). Right-handed (det +1) — matches BlochSphere.tsx. */
export function toThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y)
}

/** (Re)draw a label's canvas texture with a new fill colour, in place. */
export function paintLabel(canvas: HTMLCanvasElement, text: string, color: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const size = canvas.width
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = color
  ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, size / 2)
}

export interface LabelSprite {
  sprite: THREE.Sprite
  texture: THREE.Texture
  material: THREE.SpriteMaterial
  canvas: HTMLCanvasElement
}

/** Build a label sprite from a 2D canvas texture. Caller disposes texture + material. */
export function makeLabel(text: string, color: string, scale = 0.42): LabelSprite {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  paintLabel(canvas, text, color)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(scale, scale, scale)
  sprite.renderOrder = 10
  return { sprite, texture, material, canvas }
}

/** A circle of radius `r` in the plane spanned by two unit axes. */
export function ringGeometry(
  r: number,
  axisA: THREE.Vector3,
  axisB: THREE.Vector3,
  segments = 128
): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    pts.push(
      new THREE.Vector3().addScaledVector(axisA, Math.cos(t) * r).addScaledVector(axisB, Math.sin(t) * r)
    )
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

export interface BlochFrame {
  group: THREE.Group
  /** Re-read every CSS token and repaint labels. Call from a theme observer. */
  recolor(): void
  dispose(): void
}

export interface BlochFrameOptions {
  /** Shell opacity; the Majorana scene uses a fainter shell so stars behind it stay legible. */
  shellOpacity?: number
  /** Draw the four axis labels (default true). */
  labels?: boolean
}

/**
 * Mount the globe into `scene`. Everything created is tracked and released by
 * `dispose()`; the caller still removes the group from the scene (or clears it).
 */
export function mountBlochFrame(scene: THREE.Scene, options: BlochFrameOptions = {}): BlochFrame {
  const { shellOpacity = 0.55, labels = true } = options
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const labelSprites: { canvas: HTMLCanvasElement; text: string; colorVar: string; fallback: string }[] = []

  // ── Sphere: faint shell + wireframe ──
  const shellGeo = new THREE.SphereGeometry(1, 48, 32)
  const shellMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(readVar('--surface-2', FRAME_FALLBACKS.shell)),
    transparent: true,
    opacity: shellOpacity,
    side: THREE.BackSide,
  })
  geometries.push(shellGeo)
  materials.push(shellMat)
  group.add(new THREE.Mesh(shellGeo, shellMat))

  const gridGeo = new THREE.SphereGeometry(1, 24, 16)
  const gridMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(readVar('--ink-muted', FRAME_FALLBACKS.line)),
    wireframe: true,
    transparent: true,
    opacity: 0.22,
  })
  geometries.push(gridGeo)
  materials.push(gridMat)
  group.add(new THREE.Mesh(gridGeo, gridMat))

  // ── Rings ──
  const X = new THREE.Vector3(1, 0, 0)
  const Y = new THREE.Vector3(0, 1, 0)
  const Z = new THREE.Vector3(0, 0, 1)

  const equatorGeo = ringGeometry(1, X, Z)
  const equatorMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(readVar('--q-sky', FRAME_FALLBACKS.equator)),
    transparent: true,
    opacity: 0.75,
  })
  geometries.push(equatorGeo)
  materials.push(equatorMat)
  group.add(new THREE.Line(equatorGeo, equatorMat))

  const meridianMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(readVar('--ink-muted', FRAME_FALLBACKS.line)),
    transparent: true,
    opacity: 0.5,
  })
  materials.push(meridianMat)
  for (const [a, b] of [
    [X, Y],
    [Z, Y],
  ] as const) {
    const geo = ringGeometry(1, a, b)
    geometries.push(geo)
    group.add(new THREE.Line(geo, meridianMat))
  }

  // ── Axes ──
  const axisMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(readVar('--ink-muted', FRAME_FALLBACKS.line)),
    transparent: true,
    opacity: 0.8,
  })
  materials.push(axisMat)
  for (const dir of [X, Y, Z]) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      dir.clone().multiplyScalar(-1.18),
      dir.clone().multiplyScalar(1.18),
    ])
    geometries.push(geo)
    group.add(new THREE.Line(geo, axisMat))
  }

  // ── Labels (three.js coords: Bloch z is three y) ──
  if (labels) {
    const specs: [string, string, string, THREE.Vector3][] = [
      ['|0⟩', '--ink', FRAME_FALLBACKS.ink, new THREE.Vector3(0, 1.26, 0)],
      ['|1⟩', '--ink', FRAME_FALLBACKS.ink, new THREE.Vector3(0, -1.26, 0)],
      ['|+⟩', '--q-sky-text', FRAME_FALLBACKS.skyText, new THREE.Vector3(1.26, 0, 0)],
      ['|i⟩', '--q-teal-text', FRAME_FALLBACKS.tealText, new THREE.Vector3(0, 0, -1.26)],
    ]
    for (const [text, colorVar, fallback, pos] of specs) {
      const { sprite, texture, material, canvas } = makeLabel(text, readVar(colorVar, fallback))
      sprite.position.copy(pos)
      textures.push(texture)
      materials.push(material)
      group.add(sprite)
      labelSprites.push({ canvas, text, colorVar, fallback })
    }
  }

  scene.add(group)

  const recolor = () => {
    shellMat.color.set(readVar('--surface-2', FRAME_FALLBACKS.shell))
    gridMat.color.set(readVar('--ink-muted', FRAME_FALLBACKS.line))
    equatorMat.color.set(readVar('--q-sky', FRAME_FALLBACKS.equator))
    meridianMat.color.set(readVar('--ink-muted', FRAME_FALLBACKS.line))
    axisMat.color.set(readVar('--ink-muted', FRAME_FALLBACKS.line))
    for (const { canvas, text, colorVar, fallback } of labelSprites) {
      paintLabel(canvas, text, readVar(colorVar, fallback))
    }
    for (const t of textures) t.needsUpdate = true
  }

  const dispose = () => {
    scene.remove(group)
    group.clear()
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
    for (const t of textures) t.dispose()
  }

  return { group, recolor, dispose }
}

/**
 * The spherical camera orbit BlochSphere.tsx uses, with its narrow-aspect fix:
 * below aspect 1 the horizontal FOV is the tight one, so the camera pulls back
 * by 1/aspect to keep the |+⟩ label inside the frame on a phone.
 */
export function placeOrbitCamera(
  camera: THREE.PerspectiveCamera,
  radius: number,
  azimuth: number,
  polar: number
): void {
  const aspect = camera.aspect > 0 && Number.isFinite(camera.aspect) ? camera.aspect : 1
  const fit = aspect < 1 ? 1 / aspect : 1
  const r = radius * fit
  camera.position.set(r * Math.sin(polar) * Math.sin(azimuth), r * Math.cos(polar), r * Math.sin(polar) * Math.cos(azimuth))
  camera.lookAt(0, 0, 0)
}
