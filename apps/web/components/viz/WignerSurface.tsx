'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { PhaseSpaceField } from '@/lib/quantum/phasespace'
import { createFrameLoop, domIntersectionWatcher, prefersReducedMotion, watchThemeChange } from './frameLoop'
import {
  buildSurfaceMesh,
  contourSet,
  contoursToWorld,
  drawHeatmap,
  fillSurfaceMesh,
  floorTextureData,
  parseHex,
  surfaceGridLines,
  type DivergingPalette,
  type Rgb,
  type SurfaceOptions,
} from './wignerSurfaceLayout'

/**
 * WignerSurface — a quasi-probability distribution over phase space as a 3-D
 * height map, with the same picture projected flat on the floor beneath it.
 *
 * PROPS
 *   field          A PhaseSpaceField (lib/quantum/phasespace.ts): values on an
 *                  n × n (x, p) grid. Any scalar field works — the page passes
 *                  W or Q; a density-matrix page can pass anything on a grid.
 *   scale          The value that reaches full height and full colour. Default
 *                  1/π, the bound |W| ≤ 1/π, so every state is drawn to one
 *                  ruler and a tall vacuum and a shallow thermal state compare
 *                  honestly. Pass a smaller number to magnify faint structure.
 *   label          Short name for the function ('W' or 'Q'), used in the axis
 *                  label and the fallback caption.
 *   showContours   Draw iso-lines on the floor projection (default true).
 *   description    Accessible description of what is on show; the page
 *                  composes it from the state and its statistics.
 *   force2D        Skip WebGL and render the 2-D heat map (tests, previews).
 *   className      Extra classes on the root element (min-h-[440px] built in).
 *
 * CONVENTIONS
 *   Quadrature x runs along three.js +X (left → right in the default view),
 *   p along +Z (towards the viewer), and the function value along +Y (up).
 *   Colour is a diverging map — positive values in rose, negative in sky,
 *   zero neutral — so a dip below the zero plane is unmistakable even from an
 *   angle where its depth is hard to judge. The floor is a flat projection of
 *   the same map plus contour lines, which is what a textbook figure shows.
 *
 * BEHAVIOUR
 *   · Feature-detects WebGL and falls back to a 2-D canvas heat map (same
 *     colours, same contours, top view) rather than an error.
 *   · Orbit by drag or arrow keys; zoom by wheel, pinch, or + / −. A slow idle
 *     turn shows the relief until the first interaction; under
 *     prefers-reduced-motion there is no idle motion at all.
 *   · The renderer is created once; field changes update vertex buffers in
 *     place (same grid size) so the viewpoint survives a slider drag.
 *   · Render loop is gated by tab visibility and an IntersectionObserver
 *     (components/viz/frameLoop.ts); devicePixelRatio is capped at 2; every
 *     geometry, material, texture and the renderer are disposed on unmount.
 *   · A 0 × 0 container draws nothing and throws nothing.
 *   · Theme colours are read from CSS custom properties at mount and again
 *     whenever the class on <html> changes.
 */

export type WignerSurfaceProps = {
  field: PhaseSpaceField
  scale?: number
  label?: string
  showContours?: boolean
  description?: string
  force2D?: boolean
  className?: string
}

const FALLBACK = {
  rose: '#e57969',
  sky: '#6283c8',
  inkMuted: '#7d8cb0',
  ink: '#eef2ff',
  roseText: '#f5a193',
  skyText: '#8faae0',
} as const

function readVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** The three-colour diverging palette from the current theme tokens. */
function readPalette(): DivergingPalette {
  const pick = (token: string, fallback: string): Rgb => parseHex(readVar(token, fallback)) ?? parseHex(fallback)!
  return {
    positive: pick('--q-rose', FALLBACK.rose),
    negative: pick('--q-sky', FALLBACK.sky),
    zero: pick('--ink-muted', FALLBACK.inkMuted),
  }
}

/** sRGB triple → THREE.Color in the renderer's working (linear) space. */
function toThreeColor(c: Rgb): THREE.Color {
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)
}

/** Vertex colours are consumed as linear; convert the sRGB palette once. */
function linearPalette(p: DivergingPalette): DivergingPalette {
  const lin = (c: Rgb): Rgb => {
    const t = toThreeColor(c)
    return [t.r, t.g, t.b]
  }
  return { positive: lin(p.positive), negative: lin(p.negative), zero: lin(p.zero) }
}

function paintLabel(canvas: HTMLCanvasElement, text: string, color: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = color
  ctx.font = 'italic bold 60px ui-serif, Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
}

/** True if this browser will hand out a WebGL context at all. */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

const HALF_WIDTH = 2.2
const HEIGHT = 1.35
const FLOOR_Y = -HEIGHT * 1.25

type Spec = { field: PhaseSpaceField; scale: number; label: string; showContours: boolean }

export function WignerSurface({
  field,
  scale = 1 / Math.PI,
  label = 'W',
  showContours = true,
  description,
  force2D = false,
  className,
}: WignerSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<'probing' | 'webgl' | 'canvas'>('probing')
  const updateRef = useRef<((spec: Spec) => void) | null>(null)
  const specRef = useRef<Spec>({ field, scale, label, showContours })
  specRef.current = { field, scale, label, showContours }

  // ── Decide which renderer this machine gets ───────────────────────────────
  useEffect(() => {
    setMode(!force2D && webglAvailable() ? 'webgl' : 'canvas')
  }, [force2D])

  // ── 2-D fallback ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'canvas') return
    const canvas = fallbackCanvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const draw = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (!(w > 0 && h > 0)) return
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const spec = specRef.current
      drawHeatmap(ctx, spec.field, w, h, spec.scale, {
        palette: readPalette(),
        ink: readVar('--ink', FALLBACK.ink),
        inkMuted: readVar('--ink-muted', FALLBACK.inkMuted),
        positiveLine: readVar('--q-rose-text', FALLBACK.roseText),
        negativeLine: readVar('--q-sky-text', FALLBACK.skyText),
      }, spec.label)
    }
    updateRef.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    const unTheme = watchThemeChange(draw)
    return () => {
      updateRef.current = null
      ro.disconnect()
      unTheme()
    }
  }, [mode])

  // ── WebGL scene ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'webgl') return
    const container = containerRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      // The probe passed but the real context was refused (GPU blocklist,
      // too many contexts). Degrade to the heat map rather than to an error.
      setMode('canvas')
      return
    }
    const reduceMotion = prefersReducedMotion()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    const canvasEl = renderer.domElement
    canvasEl.style.display = 'block'
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    canvasEl.style.touchAction = 'none'
    container.appendChild(canvasEl)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    const disposables: { dispose(): void }[] = []

    // Vertex colour already carries the value; lighting only has to give the
    // relief a little shading, so keep the total well under 1× to avoid
    // clipping the rose highlights to white.
    scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const key = new THREE.DirectionalLight(0xffffff, 0.8)
    key.position.set(2.5, 4, 3)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.3)
    fill.position.set(-3, 2, -2)
    scene.add(fill)

    // ── Surface (rebuilt when the grid size changes, refilled otherwise) ──
    let palette = readPalette()
    let linPalette = linearPalette(palette)
    let opts: SurfaceOptions = { halfWidth: HALF_WIDTH, heightScale: HEIGHT, scale: specRef.current.scale }

    const surfaceMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    const gridMat = new THREE.LineBasicMaterial({
      color: toThreeColor(parseHex(readVar('--ink', FALLBACK.ink)) ?? [1, 1, 1]),
      transparent: true,
      opacity: 0.18,
    })
    const posLineMat = new THREE.LineBasicMaterial({
      color: toThreeColor(parseHex(readVar('--q-rose-text', FALLBACK.roseText)) ?? [1, 0.5, 0.6]),
      transparent: true,
      opacity: 0.9,
    })
    const negLineMat = new THREE.LineBasicMaterial({
      color: toThreeColor(parseHex(readVar('--q-sky-text', FALLBACK.skyText)) ?? [0.5, 0.8, 1]),
      transparent: true,
      opacity: 0.95,
    })
    const frameMat = new THREE.LineBasicMaterial({
      color: toThreeColor(parseHex(readVar('--ink-muted', FALLBACK.inkMuted)) ?? [0.5, 0.55, 0.7]),
      transparent: true,
      opacity: 0.6,
    })
    const zeroMat = new THREE.MeshBasicMaterial({
      color: toThreeColor(parseHex(readVar('--ink-muted', FALLBACK.inkMuted)) ?? [0.5, 0.55, 0.7]),
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const floorMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, side: THREE.DoubleSide })
    disposables.push(surfaceMat, gridMat, posLineMat, negLineMat, frameMat, zeroMat, floorMat)

    let surfaceGeo: THREE.BufferGeometry | null = null
    let surfaceMesh: THREE.Mesh | null = null
    let gridGeo: THREE.BufferGeometry | null = null
    let gridLines: THREE.LineSegments | null = null
    let floorTex: THREE.DataTexture | null = null
    let posContourGeo: THREE.BufferGeometry | null = null
    let negContourGeo: THREE.BufferGeometry | null = null
    let posContours: THREE.LineSegments | null = null
    let negContours: THREE.LineSegments | null = null
    let builtN = -1

    // Static furniture: floor plate, zero plane outline + fill, axes, labels.
    const floorGeo = new THREE.PlaneGeometry(2 * HALF_WIDTH, 2 * HALF_WIDTH)
    // Rotating by +π/2 sends the plane's +v (top) edge to +Z, so with
    // flipY = false the texture's row 0 (p = −extent) lands at z = −HALF_WIDTH
    // and p increases towards +Z — the same direction the surface uses. The
    // material is double-sided, so the normal facing −Y does not matter.
    floorGeo.rotateX(Math.PI / 2)
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.position.y = FLOOR_Y
    disposables.push(floorGeo)
    scene.add(floor)

    const zeroGeo = new THREE.PlaneGeometry(2 * HALF_WIDTH, 2 * HALF_WIDTH)
    zeroGeo.rotateX(-Math.PI / 2)
    const zeroPlane = new THREE.Mesh(zeroGeo, zeroMat)
    zeroPlane.renderOrder = 1
    disposables.push(zeroGeo)
    scene.add(zeroPlane)

    const outline = (y: number) => {
      const h = HALF_WIDTH
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-h, y, -h),
        new THREE.Vector3(h, y, -h),
        new THREE.Vector3(h, y, h),
        new THREE.Vector3(-h, y, h),
        new THREE.Vector3(-h, y, -h),
      ])
      disposables.push(geo)
      return new THREE.Line(geo, frameMat)
    }
    scene.add(outline(0))
    scene.add(outline(FLOOR_Y + 0.002))

    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-HALF_WIDTH, FLOOR_Y + 0.003, 0),
      new THREE.Vector3(HALF_WIDTH * 1.12, FLOOR_Y + 0.003, 0),
      new THREE.Vector3(0, FLOOR_Y + 0.003, -HALF_WIDTH),
      new THREE.Vector3(0, FLOOR_Y + 0.003, HALF_WIDTH * 1.12),
      new THREE.Vector3(HALF_WIDTH, FLOOR_Y, HALF_WIDTH),
      new THREE.Vector3(HALF_WIDTH, HEIGHT * 1.1, HALF_WIDTH),
    ])
    disposables.push(axisGeo)
    scene.add(new THREE.LineSegments(axisGeo, frameMat))

    const labels: { canvas: HTMLCanvasElement; texture: THREE.Texture; text: () => string }[] = []
    const makeLabel = (text: () => string, position: THREE.Vector3) => {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      paintLabel(canvas, text(), readVar('--ink', FALLBACK.ink))
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.setScalar(0.42)
      sprite.position.copy(position)
      sprite.renderOrder = 20
      disposables.push(texture, mat)
      labels.push({ canvas, texture, text })
      scene.add(sprite)
    }
    makeLabel(() => 'x', new THREE.Vector3(HALF_WIDTH * 1.28, FLOOR_Y, 0))
    makeLabel(() => 'p', new THREE.Vector3(0, FLOOR_Y, HALF_WIDTH * 1.28))
    makeLabel(() => specRef.current.label, new THREE.Vector3(HALF_WIDTH, HEIGHT * 1.28, HALF_WIDTH))

    const rebuildContours = (spec: Spec) => {
      if (posContours) {
        scene.remove(posContours)
        posContours = null
      }
      if (negContours) {
        scene.remove(negContours)
        negContours = null
      }
      posContourGeo?.dispose()
      negContourGeo?.dispose()
      posContourGeo = null
      negContourGeo = null
      if (!spec.showContours) return
      const set = contourSet(spec.field, spec.scale)
      const y = FLOOR_Y + 0.004
      if (set.positive.length > 0) {
        posContourGeo = new THREE.BufferGeometry()
        posContourGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(contoursToWorld(set.positive, spec.field, HALF_WIDTH, y), 3)
        )
        posContours = new THREE.LineSegments(posContourGeo, posLineMat)
        scene.add(posContours)
      }
      if (set.negative.length > 0) {
        negContourGeo = new THREE.BufferGeometry()
        negContourGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(contoursToWorld(set.negative, spec.field, HALF_WIDTH, y), 3)
        )
        negContours = new THREE.LineSegments(negContourGeo, negLineMat)
        scene.add(negContours)
      }
    }

    const refreshFloor = (spec: Spec) => {
      const n = spec.field.n
      const data = floorTextureData(spec.field, spec.scale, palette)
      if (!floorTex || floorTex.image.width !== n) {
        floorTex?.dispose()
        floorTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
        floorTex.colorSpace = THREE.SRGBColorSpace
        floorTex.magFilter = THREE.LinearFilter
        floorTex.minFilter = THREE.LinearFilter
        floorTex.flipY = false
        floorMat.map = floorTex
        floorMat.needsUpdate = true
      } else {
        floorTex.image.data.set(data)
      }
      floorTex.needsUpdate = true
    }

    const applyField = (spec: Spec) => {
      const n = spec.field.n
      opts = { halfWidth: HALF_WIDTH, heightScale: HEIGHT, scale: spec.scale }
      if (n !== builtN || !surfaceGeo) {
        if (surfaceMesh) scene.remove(surfaceMesh)
        if (gridLines) scene.remove(gridLines)
        surfaceGeo?.dispose()
        gridGeo?.dispose()
        const mesh = buildSurfaceMesh(spec.field, opts, linPalette)
        surfaceGeo = new THREE.BufferGeometry()
        surfaceGeo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
        surfaceGeo.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3))
        surfaceGeo.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
        surfaceGeo.computeVertexNormals()
        surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat)
        surfaceMesh.renderOrder = 2
        scene.add(surfaceMesh)
        gridGeo = new THREE.BufferGeometry()
        gridGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(surfaceGridLines(mesh.positions, n, Math.max(2, Math.round(n / 12)), 0.004), 3)
        )
        gridLines = new THREE.LineSegments(gridGeo, gridMat)
        gridLines.renderOrder = 3
        scene.add(gridLines)
        builtN = n
      } else {
        const pos = surfaceGeo.getAttribute('position') as THREE.BufferAttribute
        const col = surfaceGeo.getAttribute('color') as THREE.BufferAttribute
        fillSurfaceMesh(spec.field, opts, linPalette, pos.array as Float32Array, col.array as Float32Array)
        pos.needsUpdate = true
        col.needsUpdate = true
        surfaceGeo.computeVertexNormals()
        surfaceGeo.computeBoundingSphere()
        if (gridGeo) {
          const g = gridGeo.getAttribute('position') as THREE.BufferAttribute
          ;(g.array as Float32Array).set(
            surfaceGridLines(pos.array as Float32Array, n, Math.max(2, Math.round(n / 12)), 0.004)
          )
          g.needsUpdate = true
          gridGeo.computeBoundingSphere()
        }
      }
      refreshFloor(spec)
      rebuildContours(spec)
      for (const l of labels) paintLabel(l.canvas, l.text(), readVar('--ink', FALLBACK.ink))
      for (const l of labels) l.texture.needsUpdate = true
    }

    // ── Camera ────────────────────────────────────────────────────────────
    let azimuth = Math.PI * 0.22
    let polar = Math.PI * 0.36
    let zoom = 1
    let interacted = false
    let firstFrame = -1
    const target = new THREE.Vector3(0, (FLOOR_Y + HEIGHT * 0.5) / 2, 0)

    const placeCamera = () => {
      const aspect = camera.aspect > 0 && Number.isFinite(camera.aspect) ? camera.aspect : 1
      const fit = aspect < 1 ? 1 / aspect : 1
      const dist = 7.4 * zoom * fit
      camera.position.set(
        target.x + dist * Math.sin(polar) * Math.sin(azimuth),
        target.y + dist * Math.cos(polar),
        target.z + dist * Math.sin(polar) * Math.cos(azimuth)
      )
      camera.lookAt(target)
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(container), (now) => {
      // A slow idle sway for the first 20 s, or until the reader takes the
      // controls, so the relief reads as 3-D before anyone touches it. None at
      // all under prefers-reduced-motion, and never for longer than that: an
      // unattended tab should not burn GPU frames on an unchanging picture.
      if (firstFrame < 0) firstFrame = now
      const spinning = !reduceMotion && !interacted && now - firstFrame < 20000
      if (spinning) {
        azimuth = Math.PI * 0.22 + Math.sin(now / 9000) * 0.35
        placeCamera()
      }
      renderer.render(scene, camera)
      return spinning
    })
    const kick = () => loop.start()

    const orbitBy = (dAz: number, dPolar: number) => {
      interacted = true
      azimuth -= dAz
      polar = Math.min(Math.PI * 0.49, Math.max(0.08, polar - dPolar))
      placeCamera()
      kick()
    }
    const zoomBy = (factor: number) => {
      interacted = true
      zoom = Math.min(2.6, Math.max(0.45, zoom * factor))
      placeCamera()
      kick()
    }

    // ── Pointer: one finger orbits, two pinch-zoom ────────────────────────
    const pointers = new Map<number, { x: number; y: number }>()
    let pinchDist = 0
    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      canvasEl.setPointerCapture(e.pointerId)
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values())
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const next = { x: e.clientX, y: e.clientY }
      pointers.set(e.pointerId, next)
      if (pointers.size === 1) {
        orbitBy((next.x - prev.x) * 0.008, (next.y - prev.y) * 0.008)
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values())
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0 && d > 0) zoomBy(pinchDist / d)
        pinchDist = d
      }
    }
    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      pinchDist = 0
      if (canvasEl.hasPointerCapture(e.pointerId)) canvasEl.releasePointerCapture(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(1 + e.deltaY * 0.0012)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 0.32 : 0.12
      switch (e.key) {
        case 'ArrowLeft':
          orbitBy(-step, 0)
          break
        case 'ArrowRight':
          orbitBy(step, 0)
          break
        case 'ArrowUp':
          orbitBy(0, step)
          break
        case 'ArrowDown':
          orbitBy(0, -step)
          break
        case '+':
        case '=':
          zoomBy(0.85)
          break
        case '-':
        case '_':
          zoomBy(1 / 0.85)
          break
        case 'Home':
          azimuth = Math.PI * 0.22
          polar = Math.PI * 0.36
          zoom = 1
          orbitBy(0, 0)
          break
        default:
          return
      }
      e.preventDefault()
    }
    canvasEl.addEventListener('pointerdown', onPointerDown)
    canvasEl.addEventListener('pointermove', onPointerMove)
    canvasEl.addEventListener('pointerup', endPointer)
    canvasEl.addEventListener('pointercancel', endPointer)
    canvasEl.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('keydown', onKeyDown)

    // ── Sizing: a 0 × 0 box is a legal state that draws nothing ───────────
    const resize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (!(w > 0 && h > 0)) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      placeCamera()
      kick()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    // ── Theme ─────────────────────────────────────────────────────────────
    const unTheme = watchThemeChange(() => {
      palette = readPalette()
      linPalette = linearPalette(palette)
      gridMat.color.copy(toThreeColor(parseHex(readVar('--ink', FALLBACK.ink)) ?? [1, 1, 1]))
      posLineMat.color.copy(toThreeColor(parseHex(readVar('--q-rose-text', FALLBACK.roseText)) ?? [1, 0.5, 0.6]))
      negLineMat.color.copy(toThreeColor(parseHex(readVar('--q-sky-text', FALLBACK.skyText)) ?? [0.5, 0.8, 1]))
      const muted = toThreeColor(parseHex(readVar('--ink-muted', FALLBACK.inkMuted)) ?? [0.5, 0.55, 0.7])
      frameMat.color.copy(muted)
      zeroMat.color.copy(muted)
      applyField(specRef.current)
      kick()
    })

    updateRef.current = (spec) => {
      applyField(spec)
      kick()
    }
    applyField(specRef.current)
    placeCamera()
    kick()

    return () => {
      updateRef.current = null
      loop.dispose()
      unTheme()
      ro.disconnect()
      canvasEl.removeEventListener('pointerdown', onPointerDown)
      canvasEl.removeEventListener('pointermove', onPointerMove)
      canvasEl.removeEventListener('pointerup', endPointer)
      canvasEl.removeEventListener('pointercancel', endPointer)
      canvasEl.removeEventListener('wheel', onWheel)
      container.removeEventListener('keydown', onKeyDown)
      if (surfaceMesh) scene.remove(surfaceMesh)
      if (gridLines) scene.remove(gridLines)
      if (posContours) scene.remove(posContours)
      if (negContours) scene.remove(negContours)
      surfaceGeo?.dispose()
      gridGeo?.dispose()
      posContourGeo?.dispose()
      negContourGeo?.dispose()
      floorTex?.dispose()
      for (const d of disposables) d.dispose()
      scene.clear()
      renderer.dispose()
      if (canvasEl.parentNode === container) container.removeChild(canvasEl)
    }
  }, [mode])

  // ── Push new fields into whichever renderer is live ───────────────────────
  useEffect(() => {
    updateRef.current?.({ field, scale, label, showContours })
  }, [field, scale, label, showContours])

  const help =
    mode === 'canvas'
      ? 'Shown as a flat top view because this browser did not provide a 3-D context.'
      : 'Drag or use the arrow keys to turn the view; scroll, pinch, or press plus and minus to zoom; Home resets.'

  return (
    <div
      ref={containerRef}
      role="img"
      tabIndex={0}
      aria-label={`${description ?? `${label} over phase space.`} ${help}`}
      className={`focus-ring relative w-full min-h-[440px] overflow-hidden rounded-lg ${className ?? ''}`}
    >
      {mode === 'canvas' ? (
        <canvas ref={fallbackCanvasRef} className="block h-full w-full" style={{ position: 'absolute', inset: 0 }} />
      ) : null}
    </div>
  )
}

export default WignerSurface
