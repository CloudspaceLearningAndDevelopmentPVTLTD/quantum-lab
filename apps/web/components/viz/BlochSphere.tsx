'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * BlochSphere — a hand-rolled three.js rendering of the Bloch sphere.
 *
 * No OrbitControls (three/examples is unavailable here), so the orbit is
 * implemented directly on pointer events with a spherical camera.
 *
 * Conventions match lib/quantum.ts:
 *   |0⟩ = +Z, |1⟩ = -Z, |+⟩ = +X, |i⟩ = +Y
 *   x = sin θ cos φ,  y = sin θ sin φ,  z = cos θ
 *
 * three.js is Y-up, so the world mapping is (x, y, z)_bloch → (x, z, −y)_three.
 * The matrix [[1,0,0],[0,0,1],[0,−1,0]] has det +1 — a proper rotation, so
 * RZ/S/T rotations turn the same way on screen as they do in the algebra.
 * (The earlier (x, z, y) map had det −1: a mirror image.)
 */

// Fallbacks only — real values are read from CSS custom properties at
// runtime inside the effect (see docs/THEMING.md: never read them at module
// scope, since that runs before the theme class exists on <html>).
const FALLBACK_VIOLET = '#a99dff'
const FALLBACK_LINE = '#3d5070'
const FALLBACK_EQUATOR = '#6283c8'

/** Read a CSS custom property off <html>, falling back if it's unset. */
function readVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** (Re)draw a label's canvas texture with a new fill colour, in place. */
function paintLabel(canvas: HTMLCanvasElement, text: string, color: string): void {
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

/** Build a label sprite from a 2D canvas texture. Caller disposes both. */
function makeLabel(
  text: string,
  color: string
): {
  sprite: THREE.Sprite
  texture: THREE.Texture
  material: THREE.SpriteMaterial
  canvas: HTMLCanvasElement
} {
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
  sprite.scale.set(0.42, 0.42, 0.42)
  sprite.renderOrder = 10
  return { sprite, texture, material, canvas }
}

/** A circle of radius `r` in the plane spanned by two unit axes. */
function ringGeometry(
  r: number,
  axisA: THREE.Vector3,
  axisB: THREE.Vector3,
  segments = 128
): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    pts.push(
      new THREE.Vector3()
        .addScaledVector(axisA, Math.cos(t) * r)
        .addScaledVector(axisB, Math.sin(t) * r)
    )
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

export function BlochSphere({
  theta,
  phi,
  className,
}: {
  theta: number
  phi: number
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Live target so the animation loop reads fresh angles without re-initialising.
  const targetRef = useRef({ theta, phi })
  targetRef.current = { theta, phi }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.touchAction = 'none'
    container.appendChild(renderer.domElement)

    // Everything disposable is tracked so unmount can be exhaustive.
    const geometries: THREE.BufferGeometry[] = []
    const materials: THREE.Material[] = []
    const textures: THREE.Texture[] = []

    const track = <G extends THREE.BufferGeometry, M extends THREE.Material>(g: G, m: M) => {
      geometries.push(g)
      materials.push(m)
    }

    // Colours read from CSS custom properties, not module-scope constants —
    // this runs after mount, so the theme class on <html> is already set.
    const violet = readVar('--q-violet', FALLBACK_VIOLET)
    const line = readVar('--ink-muted', FALLBACK_LINE)
    const equator = readVar('--q-sky', FALLBACK_EQUATOR)
    const shellColor = readVar('--surface-2', '#141a2c')
    const violetText = readVar('--q-violet-text', '#c1bbfe')
    const inkColor = readVar('--ink', '#eef2ff')
    const skyText = readVar('--q-sky-text', '#8faae0')
    const tealText = readVar('--q-teal-text', '#8ae8da')

    // ── Sphere: faint wireframe shell ──
    const shellGeo = new THREE.SphereGeometry(1, 48, 32)
    const shellMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(shellColor),
      transparent: true,
      opacity: 0.55,
      side: THREE.BackSide,
    })
    track(shellGeo, shellMat)
    scene.add(new THREE.Mesh(shellGeo, shellMat))

    const gridGeo = new THREE.SphereGeometry(1, 24, 16)
    const gridMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(line),
      wireframe: true,
      transparent: true,
      opacity: 0.22,
    })
    track(gridGeo, gridMat)
    scene.add(new THREE.Mesh(gridGeo, gridMat))

    // ── Rings: emphasised equator + two meridians ──
    const X = new THREE.Vector3(1, 0, 0)
    const Y = new THREE.Vector3(0, 1, 0)
    const Z = new THREE.Vector3(0, 0, 1)

    const equatorGeo = ringGeometry(1, X, Z)
    const equatorMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(equator),
      transparent: true,
      opacity: 0.75,
    })
    track(equatorGeo, equatorMat)
    scene.add(new THREE.Line(equatorGeo, equatorMat))

    const meridianMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(line),
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
      scene.add(new THREE.Line(geo, meridianMat))
    }

    // ── Axes ──
    const axisMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(line),
      transparent: true,
      opacity: 0.8,
    })
    materials.push(axisMat)
    const axisEnds: THREE.Vector3[] = [X, Y, Z]
    for (const dir of axisEnds) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        dir.clone().multiplyScalar(-1.18),
        dir.clone().multiplyScalar(1.18),
      ])
      geometries.push(geo)
      scene.add(new THREE.Line(geo, axisMat))
    }

    // ── Labels (three.js coords: bloch z is three y, bloch y is three −z) ──
    const labelSpecs: [string, string, THREE.Vector3][] = [
      ['|0⟩', inkColor, new THREE.Vector3(0, 1.26, 0)],
      ['|1⟩', inkColor, new THREE.Vector3(0, -1.26, 0)],
      ['|+⟩', skyText, new THREE.Vector3(1.26, 0, 0)],
      ['|i⟩', tealText, new THREE.Vector3(0, 0, -1.26)],
    ]
    const labelSprites: { canvas: HTMLCanvasElement; text: string; colorVar: string }[] = []
    const labelColorVars = ['--ink', '--ink', '--q-sky-text', '--q-teal-text']
    labelSpecs.forEach(([text, color, pos], i) => {
      const { sprite, texture, material, canvas } = makeLabel(text, color)
      sprite.position.copy(pos)
      textures.push(texture)
      materials.push(material)
      scene.add(sprite)
      labelSprites.push({ canvas, text, colorVar: labelColorVars[i] })
    })

    // ── Bloch vector arrow ──
    const arrow = new THREE.Group()
    const SHAFT = 0.82
    const HEAD = 0.18

    const shaftGeo = new THREE.CylinderGeometry(0.018, 0.018, SHAFT, 16)
    shaftGeo.translate(0, SHAFT / 2, 0)
    const arrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(violet) })
    track(shaftGeo, arrowMat)
    arrow.add(new THREE.Mesh(shaftGeo, arrowMat))

    const headGeo = new THREE.ConeGeometry(0.062, HEAD, 20)
    headGeo.translate(0, SHAFT + HEAD / 2, 0)
    geometries.push(headGeo)
    arrow.add(new THREE.Mesh(headGeo, arrowMat))
    scene.add(arrow)

    const tipGeo = new THREE.SphereGeometry(0.045, 20, 14)
    const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(violetText) })
    track(tipGeo, tipMat)
    const tip = new THREE.Mesh(tipGeo, tipMat)
    scene.add(tip)

    // ── Re-theme in place when <html>'s class flips between .dark / .light ──
    const applyThemeColors = () => {
      shellMat.color.set(readVar('--surface-2', '#141a2c'))
      gridMat.color.set(readVar('--ink-muted', FALLBACK_LINE))
      equatorMat.color.set(readVar('--q-sky', FALLBACK_EQUATOR))
      meridianMat.color.set(readVar('--ink-muted', FALLBACK_LINE))
      axisMat.color.set(readVar('--ink-muted', FALLBACK_LINE))
      arrowMat.color.set(readVar('--q-violet', FALLBACK_VIOLET))
      tipMat.color.set(readVar('--q-violet-text', '#c1bbfe'))
      for (const { canvas, text, colorVar } of labelSprites) {
        paintLabel(canvas, text, readVar(colorVar, '#eef2ff'))
      }
      for (const t of textures) t.needsUpdate = true
      if (reduceMotion) draw()
    }
    const themeObserver = new MutationObserver(applyThemeColors)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const UP = new THREE.Vector3(0, 1, 0)
    const current = new THREE.Vector3(0, 1, 0)
    const target = new THREE.Vector3(0, 1, 0)

    const readTarget = () => {
      const { theta: th, phi: ph } = targetRef.current
      // (x, y, z)_bloch → (x, z, −y)_three — a proper rotation (det +1), so
      // increasing φ turns the arrow the same way on screen as in the algebra.
      target.set(
        Math.sin(th) * Math.cos(ph),
        Math.cos(th),
        -Math.sin(th) * Math.sin(ph)
      )
      if (target.lengthSq() < 1e-12) target.copy(UP)
    }
    readTarget()
    current.copy(target)

    // ── Camera orbit state ──
    let radius = 4.05
    let azimuth = Math.PI * 0.75
    let polar = Math.PI * 0.42

    // Below aspect 1 (narrower than tall — e.g. a 390px-wide phone canvas),
    // the *horizontal* FOV is tighter than the vertical FOV even though the
    // vertical FOV is fixed, so the labels at the sphere's horizontal
    // extremes (like |+⟩) clip against the left/right edges even though
    // they fit fine vertically. Pull the camera back proportionally to
    // 1/aspect so the horizontal extent fits too.
    const placeCamera = () => {
      const aspect = camera.aspect || 1
      const fit = aspect < 1 ? 1 / aspect : 1
      const effectiveRadius = radius * fit
      camera.position.set(
        effectiveRadius * Math.sin(polar) * Math.sin(azimuth),
        effectiveRadius * Math.cos(polar),
        effectiveRadius * Math.sin(polar) * Math.cos(azimuth)
      )
      camera.lookAt(0, 0, 0)
    }
    placeCamera()

    let dragging = false
    let lastX = 0
    let lastY = 0
    const canvasEl = renderer.domElement

    const onPointerDown = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      canvasEl.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      azimuth -= dx * 0.008
      polar = Math.min(Math.PI - 0.05, Math.max(0.05, polar - dy * 0.008))
      placeCamera()
    }
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      if (canvasEl.hasPointerCapture(e.pointerId)) canvasEl.releasePointerCapture(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      radius = Math.min(7.5, Math.max(2.6, radius + e.deltaY * 0.0022))
      placeCamera()
    }

    canvasEl.addEventListener('pointerdown', onPointerDown)
    canvasEl.addEventListener('pointermove', onPointerMove)
    canvasEl.addEventListener('pointerup', endDrag)
    canvasEl.addEventListener('pointercancel', endDrag)
    canvasEl.addEventListener('wheel', onWheel, { passive: false })

    // ── Sizing ──
    const resize = () => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      placeCamera()
    }
    resize()

    const observer = new ResizeObserver(resize)
    observer.observe(container)

    // ── Frame loop ──
    let raf = 0
    const quat = new THREE.Quaternion()

    const draw = () => {
      readTarget()
      if (reduceMotion) {
        current.copy(target)
      } else {
        current.lerp(target, 0.16)
        if (current.lengthSq() < 1e-8) current.copy(target)
      }
      const dir = current.clone().normalize()
      quat.setFromUnitVectors(UP, dir)
      arrow.quaternion.copy(quat)
      tip.position.copy(dir).multiplyScalar(SHAFT + HEAD)
      renderer.render(scene, camera)
    }

    // ── Frame-loop gating ────────────────────────────────────────────────────
    // MEASURED (Playwright, rAF callbacks counted over a 2 s window; headless chromium
    // on software WebGL, so absolute fps is GPU-bound and low — the before/after ratio
    // is the point). Scrolled 4000 px past the canvas: 25 frames before this gate,
    // 0 after. Tab hidden via a stubbed document.hidden + visibilitychange: 19 frames
    // before, 0 after. Back on screen: 41 frames, so the loop demonstrably resumes.
    // The off-screen case is the real win — a scrolled-away canvas kept rendering a
    // full WebGL frame forever. See docs/PERFORMANCE.md.
    let pageVisible = typeof document === 'undefined' || !document.hidden
    let onScreen = true
    const shouldRun = () => !reduceMotion && pageVisible && onScreen

    const loop = () => {
      raf = 0
      if (!shouldRun()) return
      draw()
      raf = requestAnimationFrame(loop)
    }
    const startLoop = () => {
      if (raf === 0 && shouldRun()) raf = requestAnimationFrame(loop)
    }
    const stopLoop = () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    if (reduceMotion) {
      draw()
    } else {
      startLoop()
    }

    const onVisibilityChange = () => {
      pageVisible = !document.hidden
      // Resuming redraws immediately so the arrow is never left mid-lerp on screen.
      if (pageVisible) startLoop()
      else stopLoop()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Off-screen is the case the browser does NOT handle for us.
    const visibilityObserver =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              onScreen = entries.some((e) => e.isIntersecting)
              if (onScreen) startLoop()
              else stopLoop()
            },
            // A margin so the loop is already running by the time it scrolls into view.
            { rootMargin: '128px' }
          )
        : null
    visibilityObserver?.observe(container)

    // Static renders still need a redraw when props change or the box resizes.
    const staticRedraw = () => {
      if (reduceMotion && pageVisible && onScreen) draw()
    }
    const redrawTimer = reduceMotion ? window.setInterval(staticRedraw, 120) : 0

    return () => {
      stopLoop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      visibilityObserver?.disconnect()
      themeObserver.disconnect()
      if (redrawTimer) window.clearInterval(redrawTimer)
      observer.disconnect()
      canvasEl.removeEventListener('pointerdown', onPointerDown)
      canvasEl.removeEventListener('pointermove', onPointerMove)
      canvasEl.removeEventListener('pointerup', endDrag)
      canvasEl.removeEventListener('pointercancel', endDrag)
      canvasEl.removeEventListener('wheel', onWheel)
      scene.clear()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
      renderer.dispose()
      if (canvasEl.parentNode === container) container.removeChild(canvasEl)
    }
  }, [])

  const x = Math.sin(theta) * Math.cos(phi)
  const y = Math.sin(theta) * Math.sin(phi)
  const z = Math.cos(theta)

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Bloch sphere. State vector at theta ${(theta / Math.PI).toFixed(2)} pi, phi ${(
        phi / Math.PI
      ).toFixed(2)} pi, Bloch coordinates x ${x.toFixed(2)}, y ${y.toFixed(2)}, z ${z.toFixed(
        2
      )}. Drag to rotate the view. On a mouse or trackpad, scroll to zoom.`}
      className={`w-full min-h-[420px] ${className ?? ''}`}
    />
  )
}

export default BlochSphere
