'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { basisLabels } from '@/lib/quantum/densityMatrixView'
import type { ComplexMatrix } from '@/lib/quantum/densityMatrixView'
import {
  BAR_MAX_HEIGHT,
  barGrid,
  barHeight,
  columnCount,
  describeMatrix,
  isRealMatrix,
  labelFor,
  labelStride,
  matrixEntries,
  phaseRgb,
  resolveScale,
} from './matrixLayout'
import { HintonDiagram } from './HintonDiagram'
import { PhaseLegend } from './PhaseLegend'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
} from './frameLoop'

/**
 * MatrixHistogram3D — a complex matrix as a 3-D bar chart you can walk around:
 * bar height = |m_ij|, bar colour = arg(m_ij), rows and columns labelled in the
 * computational basis (QuTiP's `matrix_histogram`). Built for density matrices,
 * where the third dimension earns its place: a pure state's coherences stand as
 * tall as its populations, and tracing out a partner knocks them flat while the
 * diagonal stays — something a printed 4×4 does not make you *feel*.
 *
 * Props:
 *   matrix    ComplexMatrix — rows of {re, im}. Any shape up to ~32×32.
 *   labels    row/column labels; default |00…⟩ kets when rows is a power of 2.
 *   scale     magnitude drawn at full height. Pass 1 for a density matrix so a
 *             bar of ½ is always half height; default = the largest |m_ij|.
 *   title     short name for the accessible description ("ρ of the pair").
 *   height    canvas height in px (default 360). Width follows the container.
 *   className extra classes on the wrapper.
 *
 * Usage (always through LazyViz, so three.js stays out of First Load JS):
 *   const MatrixHistogram3D = lazyViz(() => import('@/components/viz/MatrixHistogram3D'), { minHeight: 360 })
 *   <MatrixHistogram3D matrix={rho} scale={1} title="ρ_AB" />
 *
 * Behaviour:
 *   - WebGL is feature-detected; when the context is refused the same matrix is
 *     drawn as a HintonDiagram with a one-line note, never an error.
 *   - Bars ease to new heights when the matrix changes (snap under
 *     prefers-reduced-motion). No idle animation, no auto-rotate.
 *   - Orbit by drag or touch, zoom by wheel; the canvas is focusable and the
 *     arrow keys orbit, + / − zoom. The loop is on demand and pauses off-screen.
 *   - Colours re-read from CSS variables on theme change; the phase ring is
 *     fixed (matrixLayout.ts) so a phase means the same thing in both themes.
 *   - A 0-width or 0-height container draws nothing and waits for the observer.
 *
 * Geometry and colour are computed in matrixLayout.ts (pure, unit-tested); this
 * file owns pixels only. Structure follows HydrogenAtom.tsx: one renderer for
 * the component's life, contents rebuilt when the matrix changes so the reader's
 * viewpoint survives.
 */

export type MatrixHistogram3DProps = {
  matrix: ComplexMatrix
  labels?: readonly string[]
  scale?: number
  title?: string
  height?: number
  className?: string
}

const FALLBACK = {
  ink: '#eef2ff',
  inkSecondary: '#8fa3c8',
  inkMuted: '#7d8cb0',
  surface2: '#141a2c',
  lineStrong: 'rgba(255, 255, 255, 0.13)',
} as const

function readVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * THREE.Color cannot parse `rgba(...)` tokens like --line-strong (it drops the
 * alpha and warns). Borrow the browser's parser through a 1×1 canvas, the same
 * trick components/circuit/qsphereScene.ts uses for oklch().
 */
let swatch: CanvasRenderingContext2D | null = null
function cssColor(css: string, fallback: string): THREE.Color {
  try {
    if (!swatch) {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      swatch = c.getContext('2d', { willReadFrequently: true })
    }
    if (!swatch) return new THREE.Color(fallback)
    swatch.clearRect(0, 0, 1, 1)
    swatch.fillStyle = css
    swatch.fillRect(0, 0, 1, 1)
    const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data
    return new THREE.Color(r / 255, g / 255, b / 255)
  } catch {
    return new THREE.Color(fallback)
  }
}

function paintLabel(canvas: HTMLCanvasElement, text: string, color: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = color
  ctx.font = 'bold 44px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
}

/** Probe for a WebGL context without paying for a renderer. */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

type BuildSpec = { matrix: ComplexMatrix; labels?: readonly string[]; scale?: number }

function defaultLabels(rows: number): string[] | undefined {
  const n = Math.log2(rows)
  return rows > 0 && Number.isInteger(n) ? basisLabels(n) : undefined
}

export function MatrixHistogram3D({
  matrix,
  labels,
  scale,
  title,
  height = 360,
  className,
}: MatrixHistogram3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rebuildRef = useRef<((spec: BuildSpec) => void) | null>(null)
  const specRef = useRef<BuildSpec>({ matrix, labels, scale })
  specRef.current = { matrix, labels, scale }
  // 'probe' until the effect has looked; the fallback renders for 'none'.
  const [gl, setGl] = useState<'probe' | 'ok' | 'none'>('probe')

  const rows = matrix.length
  const cols = columnCount(matrix)
  const names = labels ?? defaultLabels(rows)
  const fullScale = resolveScale(matrix, scale)
  const description = `${title ? `${title}: ` : ''}3-D bar chart, bar height is magnitude and colour is phase. ${describeMatrix(matrix, names)} Drag or use the arrow keys to rotate the view; scroll or press plus and minus to zoom.`

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (!webglAvailable()) {
      setGl('none')
      return
    }

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      setGl('none')
      return
    }
    setGl('ok')

    const reduceMotion = prefersReducedMotion()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    const canvasEl = renderer.domElement
    canvasEl.style.display = 'block'
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    canvasEl.style.touchAction = 'none'
    container.appendChild(canvasEl)

    // Lights: flat ambient plus one key light so the bar faces read as three
    // faces. The bar colour itself is the phase; lighting only shades it.
    const ambient = new THREE.AmbientLight(0xffffff, 1.4)
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(3, 6, 4)
    scene.add(ambient, key)

    // ── Everything the current build owns ────────────────────────────────────
    let disposables: { dispose(): void }[] = []
    let content: THREE.Group | null = null
    let labelCanvases: { canvas: HTMLCanvasElement; text: string; token: string; fallback: string }[] = []
    let labelTextures: THREE.Texture[] = []
    let recolor: (() => void) | null = null
    /** Per-bar animation state; null when nothing is built. */
    let bars: {
      mesh: THREE.InstancedMesh
      current: Float32Array
      target: Float32Array
      x: number[]
      z: number[]
      width: number
    } | null = null
    let focus = 3

    // ── Camera orbit, in the reader's hands and kept across rebuilds ─────────
    let azimuth = -0.62
    let polar = 1.02
    let zoom = 1
    let hasSize = false

    const placeCamera = () => {
      const aspect = camera.aspect || 1
      const fit = aspect < 1 ? 1 / aspect : 1
      const dist = focus * 2.8 * zoom * fit
      camera.position.set(
        dist * Math.sin(polar) * Math.sin(azimuth),
        dist * Math.cos(polar),
        dist * Math.sin(polar) * Math.cos(azimuth)
      )
      camera.near = Math.max(0.01, dist / 200)
      camera.far = dist * 10
      camera.updateProjectionMatrix()
      // Look slightly above the ground so tall bars do not crowd the top edge.
      camera.lookAt(0, BAR_MAX_HEIGHT * 0.22, 0)
    }

    const tmpMatrix = new THREE.Matrix4()
    const tmpPos = new THREE.Vector3()
    const tmpQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3()

    /** Write instance transforms from `current` heights. Returns true if still easing. */
    const applyHeights = (): boolean => {
      if (!bars) return false
      let moving = false
      const n = bars.current.length
      for (let k = 0; k < n; k++) {
        const target = bars.target[k]
        let h = bars.current[k]
        if (reduceMotion) {
          h = target
        } else {
          const d = target - h
          if (Math.abs(d) > 1e-3) {
            h += d * 0.18
            moving = true
          } else {
            h = target
          }
        }
        bars.current[k] = h
        const col = k % bars.x.length
        const row = Math.floor(k / bars.x.length)
        tmpPos.set(bars.x[col], 0, bars.z[row])
        // A zero-height bar is scaled to a hair rather than 0 so the instance
        // matrix stays invertible for lighting normals.
        tmpScale.set(bars.width, Math.max(h, 1e-4), bars.width)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        bars.mesh.setMatrixAt(k, tmpMatrix)
      }
      bars.mesh.instanceMatrix.needsUpdate = true
      return moving
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(container), () => {
      if (!hasSize) return false
      const moving = applyHeights()
      renderer.render(scene, camera)
      return moving
    })
    const kick = () => loop.start()

    // ── Builder ──────────────────────────────────────────────────────────────
    const clearContent = () => {
      if (content) {
        scene.remove(content)
        content = null
      }
      for (const d of disposables) d.dispose()
      disposables = []
      labelCanvases = []
      labelTextures = []
      recolor = null
      bars = null
    }

    const makeLabel = (text: string, token: string, fallback: string, size: number) => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 64
      paintLabel(canvas, text, readVar(token, fallback))
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
      const sprite = new THREE.Sprite(material)
      sprite.scale.set(size * 4, size, 1)
      sprite.renderOrder = 20
      disposables.push(texture, material)
      labelCanvases.push({ canvas, text, token, fallback })
      labelTextures.push(texture)
      return sprite
    }

    /** Heights of the last build, so the next one can ease from them. */
    let previous: Float32Array | null = null

    const build = (spec: BuildSpec, group: THREE.Group) => {
      const r = spec.matrix.length
      const c = columnCount(spec.matrix)
      const grid = barGrid(r, c)
      focus = grid.focus
      if (r === 0 || c === 0) return

      const fullScaleNow = resolveScale(spec.matrix, spec.scale)
      const entries = matrixEntries(spec.matrix)
      const axisNames = spec.labels ?? defaultLabels(r)

      // ── Bars: one InstancedMesh, base of each box on the ground ──
      const box = new THREE.BoxGeometry(1, 1, 1)
      box.translate(0, 0.5, 0)
      const barMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
      disposables.push(box, barMat)
      const count = r * c
      const mesh = new THREE.InstancedMesh(box, barMat, count)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      const current = new Float32Array(count)
      const target = new Float32Array(count)
      const colour = new THREE.Color()
      for (const e of entries) {
        const k = e.row * c + e.col
        if (k >= count) continue
        target[k] = barHeight(e.magnitude, fullScaleNow, grid.maxHeight)
        const [cr, cg, cb] = phaseRgb(e.phase)
        // Colours are sRGB; the renderer works in linear, so convert once here.
        colour.setRGB(cr, cg, cb, THREE.SRGBColorSpace)
        mesh.setColorAt(k, colour)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // Start each bar at its previous height when the shape is unchanged, so
      // a change of matrix reads as bars growing and shrinking in place.
      if (previous && previous.length === count) current.set(previous)
      else if (reduceMotion) current.set(target)
      previous = target
      bars = { mesh, current, target, x: grid.x, z: grid.z, width: grid.barWidth }
      group.add(mesh)

      // ── Ground plane and cell hairlines ──
      const groundGeo = new THREE.PlaneGeometry(grid.extentX * 2, grid.extentZ * 2)
      groundGeo.rotateX(-Math.PI / 2)
      const groundMat = new THREE.MeshBasicMaterial({
        color: cssColor(readVar('--surface-2', FALLBACK.surface2), FALLBACK.surface2),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
      disposables.push(groundGeo, groundMat)
      const ground = new THREE.Mesh(groundGeo, groundMat)
      ground.position.y = -0.002
      group.add(ground)

      const linePts: THREE.Vector3[] = []
      for (let j = 0; j <= c; j++) {
        const x = -grid.extentX + j
        linePts.push(new THREE.Vector3(x, 0, -grid.extentZ), new THREE.Vector3(x, 0, grid.extentZ))
      }
      for (let i = 0; i <= r; i++) {
        const zz = -grid.extentZ + i
        linePts.push(new THREE.Vector3(-grid.extentX, 0, zz), new THREE.Vector3(grid.extentX, 0, zz))
      }
      const linesGeo = new THREE.BufferGeometry().setFromPoints(linePts)
      const linesMat = new THREE.LineBasicMaterial({
        color: cssColor(readVar('--ink-muted', FALLBACK.inkMuted), FALLBACK.inkMuted),
        transparent: true,
        opacity: 0.35,
      })
      disposables.push(linesGeo, linesMat)
      group.add(new THREE.LineSegments(linesGeo, linesMat))

      // ── Height axis at the back-left corner, ticked at 0, ½ and full scale ──
      const ax = -grid.extentX - 0.35
      const az = -grid.extentZ - 0.35
      const axisGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ax, 0, az),
        new THREE.Vector3(ax, grid.maxHeight, az),
        new THREE.Vector3(ax - 0.15, grid.maxHeight / 2, az),
        new THREE.Vector3(ax, grid.maxHeight / 2, az),
        new THREE.Vector3(ax - 0.15, grid.maxHeight, az),
        new THREE.Vector3(ax, grid.maxHeight, az),
      ])
      disposables.push(axisGeo)
      group.add(new THREE.LineSegments(axisGeo, linesMat))
      const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))
      const labelSize = Math.max(0.22, Math.min(0.42, 1.6 / Math.max(r, c)))
      const topTick = makeLabel(fmt(fullScaleNow), '--ink-secondary', FALLBACK.inkSecondary, labelSize)
      topTick.position.set(ax - 0.55, grid.maxHeight, az)
      group.add(topTick)
      const midTick = makeLabel(fmt(fullScaleNow / 2), '--ink-muted', FALLBACK.inkMuted, labelSize * 0.9)
      midTick.position.set(ax - 0.55, grid.maxHeight / 2, az)
      group.add(midTick)

      // ── Basis labels: columns along the front edge, rows along the left ──
      const stride = labelStride(Math.max(r, c))
      for (let j = 0; j < c; j += stride) {
        const s = makeLabel(labelFor(axisNames, j), '--ink-secondary', FALLBACK.inkSecondary, labelSize)
        s.position.set(grid.x[j], 0.02, grid.extentZ + 0.45)
        group.add(s)
      }
      for (let i = 0; i < r; i += stride) {
        const s = makeLabel(labelFor(axisNames, i), '--ink-secondary', FALLBACK.inkSecondary, labelSize)
        s.position.set(-grid.extentX - 0.7, 0.02, grid.z[i])
        group.add(s)
      }

      recolor = () => {
        groundMat.color.copy(cssColor(readVar('--surface-2', FALLBACK.surface2), FALLBACK.surface2))
        linesMat.color.copy(cssColor(readVar('--ink-muted', FALLBACK.inkMuted), FALLBACK.inkMuted))
      }
    }

    const rebuild = (spec: BuildSpec) => {
      clearContent()
      const group = new THREE.Group()
      build(spec, group)
      content = group
      scene.add(group)
      placeCamera()
      applyHeights()
      kick()
    }
    rebuildRef.current = rebuild

    // ── Theme ────────────────────────────────────────────────────────────────
    const stopTheme = watchThemeChange(() => {
      recolor?.()
      for (const { canvas, text, token, fallback } of labelCanvases) {
        paintLabel(canvas, text, readVar(token, fallback))
      }
      for (const t of labelTextures) t.needsUpdate = true
      kick()
    })

    // ── Pointer, wheel and keyboard orbit ────────────────────────────────────
    let dragging = false
    let lastX = 0
    let lastY = 0
    const orbitBy = (dAz: number, dPolar: number) => {
      azimuth -= dAz
      polar = Math.min(Math.PI / 2 - 0.04, Math.max(0.12, polar - dPolar))
      placeCamera()
      kick()
    }
    const zoomBy = (factor: number) => {
      zoom = Math.min(3, Math.max(0.45, zoom * factor))
      placeCamera()
      kick()
    }
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
      orbitBy(dx * 0.008, dy * 0.008)
    }
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
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
        default:
          return
      }
      e.preventDefault()
    }
    canvasEl.addEventListener('pointerdown', onPointerDown)
    canvasEl.addEventListener('pointermove', onPointerMove)
    canvasEl.addEventListener('pointerup', endDrag)
    canvasEl.addEventListener('pointercancel', endDrag)
    canvasEl.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('keydown', onKeyDown)

    // ── Sizing ───────────────────────────────────────────────────────────────
    const resize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      // A container that has not been laid out yet (hidden tab, collapsed
      // parent, first paint) has no size; drawing into it would divide by zero
      // in the projection. Wait for the ResizeObserver instead.
      if (w < 2 || h < 2) {
        hasSize = false
        return
      }
      hasSize = true
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      placeCamera()
      kick()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    rebuild(specRef.current)

    return () => {
      rebuildRef.current = null
      loop.dispose()
      stopTheme()
      resizeObserver.disconnect()
      canvasEl.removeEventListener('pointerdown', onPointerDown)
      canvasEl.removeEventListener('pointermove', onPointerMove)
      canvasEl.removeEventListener('pointerup', endDrag)
      canvasEl.removeEventListener('pointercancel', endDrag)
      canvasEl.removeEventListener('wheel', onWheel)
      container.removeEventListener('keydown', onKeyDown)
      clearContent()
      scene.clear()
      renderer.dispose()
      if (canvasEl.parentNode === container) container.removeChild(canvasEl)
    }
  }, [])

  // Rebuild when the matrix (or its labels/scale) changes.
  useEffect(() => {
    rebuildRef.current?.({ matrix, labels, scale })
  }, [matrix, labels, scale])

  if (gl === 'none') {
    return (
      <div className={className}>
        <HintonDiagram matrix={matrix} labels={labels} scale={scale} title={title} />
        <p className="mt-2 text-[11px] text-ink-muted">
          3-D view unavailable on this device; the same matrix is shown flat. Square size is
          magnitude, colour is phase.
        </p>
      </div>
    )
  }

  return (
    <div className={`w-full ${className ?? ''}`}>
      <div
        ref={containerRef}
        role="img"
        tabIndex={0}
        aria-label={description}
        className="focus-ring w-full overflow-hidden rounded-lg"
        style={{ height, maxWidth: '100%' }}
      />
      <PhaseLegend mode={isRealMatrix(matrix) ? 'sign' : 'phase'} className="mt-2" />
      <p className="sr-only">Full scale is {fullScale.toFixed(2)}.</p>
    </div>
  )
}

export default MatrixHistogram3D
