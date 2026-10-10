'use client'

import { useEffect, useId, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  buildLattice3D,
  detectionEvents,
  matchingSegments,
  sceneRadius,
  stackCentreY,
  type Lattice3D,
  type MatchingEdge,
  type QubitError,
} from '@/lib/qec3d/layout'
import {
  SIZES,
  dataInstances,
  edgeInstances,
  layerCount,
  sliceOutline,
  stabiliserInstances,
  type EdgeInstance,
  type Instance,
  type InstanceStyle,
} from '@/lib/qec3d/instances'
import { createFrameLoop, domIntersectionWatcher, watchThemeChange } from './frameLoop'
import { mixColors, readVizColors, withAlpha, type VizColors } from './theme'
import { drawLatticeFallback, type FallbackPalette } from './qec3d/drawLatticeFallback'

/**
 * SurfaceCodeLattice3D — the rotated surface code as a 3-D lattice, with an
 * optional time axis that stacks syndrome rounds into the space-time volume a real
 * decoder works on.
 *
 * ── Prop API ────────────────────────────────────────────────────────────────────
 *
 *   d              odd integer ≥ 3. Data qubit (r, c) has index r·d + c; stabiliser
 *                  ids and `typeIndex` are exactly those of components/viz/surface/
 *                  code.ts (checked by lib/qec3d/layout.test.ts).
 *   errors         one 'I' | 'X' | 'Z' | 'Y' per data qubit. Use
 *                  `errorsFromChannels(errorsX, errorsZ)` from lib/qec3d/layout to
 *                  build it from the two per-channel arrays the 2-D lab keeps.
 *   syndrome       one boolean per stabiliser id: which fired this round. Omit it
 *                  and the syndrome of `errors` is drawn (perfect measurement).
 *   rounds         TIME AXIS. An array of syndromes, round 0 first. When given, the
 *                  rounds are stacked vertically (`syndrome` is ignored) and, by
 *                  default, what lights up is each DETECTION EVENT — a stabiliser
 *                  whose outcome differs from the round before — which is what a
 *                  decoder actually matches. Set `detection: false` to light the
 *                  raw outcomes instead.
 *   matching       edges to draw: `{ from: { stabiliser, round? }, to: { … } |
 *                  'boundary' }`. `edgesFromTypedMatching()` converts the 2-D lab's
 *                  per-channel `{ defects, pairs }` output; a space-time decoder
 *                  supplies rounds on its nodes and the edges are drawn diagonally
 *                  through the stack.
 *   roundSpacing   vertical distance between rounds, in qubit pitches. Default 0.8.
 *   onQubitActivate called with the qubit index when a data qubit is clicked or
 *                  tapped (raycast against the instanced mesh), and from the
 *                  keyboard: a hidden-until-focused button per data qubit sits
 *                  inside the component, so Tab + Enter injects an error without
 *                  a mouse. `activateLabel` is the verb those buttons announce.
 *   onRendererChange reports 'webgl' or 'canvas2d' once the component knows which
 *                  it is drawing with, so a page can adjust its copy.
 *
 * ── Rendering ───────────────────────────────────────────────────────────────────
 *
 * Three InstancedMesh pools (data qubits, stabilisers, matching edges as oriented
 * cylinders) plus one flat-shaded pool for lit stabilisers, so a distance-7 code
 * with a dozen rounds is a handful of draw calls. Everything that decides what
 * goes where is in lib/qec3d/{layout,instances}.ts, pure and tested; this file
 * copies numbers into buffers and handles input.
 *
 * Nothing animates on its own: the frame loop paints one frame per change or
 * interaction and goes idle, which also makes prefers-reduced-motion a no-op
 * (nothing was moving to begin with). Orbit by pointer drag, one-finger touch,
 * or the arrow keys; zoom by wheel, pinch, or + / −; Home resets the view.
 *
 * If WebGL is refused, the same instance lists are drawn by
 * qec3d/drawLatticeFallback.ts onto a 2-D canvas in oblique projection.
 */

export type { MatchingEdge, QubitError } from '@/lib/qec3d/layout'

export type SurfaceCodeLattice3DProps = {
  d: number
  errors?: ReadonlyArray<QubitError>
  syndrome?: ReadonlyArray<boolean>
  rounds?: ReadonlyArray<ReadonlyArray<boolean>>
  /** In stacked mode, light detection events (default) or raw outcomes. */
  detection?: boolean
  matching?: ReadonlyArray<MatchingEdge>
  roundSpacing?: number
  onQubitActivate?: (qubit: number) => void
  /** Verb announced by the keyboard buttons, e.g. "Toggle X error". */
  activateLabel?: string
  onRendererChange?: (renderer: 'webgl' | 'canvas2d') => void
  className?: string
  /** Height of the drawing box in CSS pixels. Default 440. */
  height?: number
}

type Frame = {
  lattice: Lattice3D
  data: Instance[]
  stabilisers: Instance[]
  edges: EdgeInstance[]
  layers: number
  roundSpacing: number
  rounds?: ReadonlyArray<ReadonlyArray<boolean>>
}

const DEFAULT_ROUND_SPACING = 0.8
const MAX_DPR = 2

function readVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Everything drawn, derived from props. Pure; also what the fallback paints. */
function buildFrame(props: SurfaceCodeLattice3DProps, cache: { lattice: Lattice3D | null }): Frame {
  if (!cache.lattice || cache.lattice.d !== props.d) cache.lattice = buildLattice3D(props.d)
  const lattice = cache.lattice
  const roundSpacing = props.roundSpacing ?? DEFAULT_ROUND_SPACING
  const stacked = props.rounds && props.rounds.length > 0 ? props.rounds : undefined
  return {
    lattice,
    data: dataInstances(lattice, props.errors),
    stabilisers: stabiliserInstances(lattice, {
      syndrome: props.syndrome,
      errors: props.errors,
      rounds: stacked,
      detection: props.detection,
      roundSpacing,
    }),
    edges: edgeInstances(matchingSegments(lattice, props.matching ?? [], roundSpacing)),
    layers: layerCount(stacked),
    roundSpacing,
    rounds: stacked,
  }
}

/** Theme colour per instance style. Unlit markers are blended toward the page surface. */
function styleColors(c: VizColors, surface: string): Record<InstanceStyle, string> {
  return {
    'data-clean': mixColors(c.surface2, c.inkMuted, 0.45),
    'data-X': c.amber,
    'data-Z': c.violet,
    'data-Y': c.rose,
    'stab-X': mixColors(c.teal, surface, 0.45),
    'stab-Z': mixColors(c.sky, surface, 0.45),
    'stab-X-ghost': mixColors(c.teal, surface, 0.78),
    'stab-Z-ghost': mixColors(c.sky, surface, 0.78),
    'stab-X-lit': c.tealText,
    'stab-Z-lit': c.skyText,
  }
}

/** Edge colour follows the 2-D lab: the X channel (Z stabilisers) is amber, the Z channel violet. */
function edgeColor(c: VizColors, type: 'X' | 'Z'): string {
  return type === 'Z' ? c.amber : c.violet
}

/**
 * An InstancedMesh whose capacity grows on demand. `set` writes every instance's
 * matrix and colour and trims `count`; a larger batch than the capacity replaces
 * the mesh (three cannot grow an instance buffer in place).
 */
class InstancePool {
  mesh: THREE.InstancedMesh
  private capacity: number
  constructor(
    private readonly parent: THREE.Object3D,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    initial = 64
  ) {
    this.capacity = Math.max(1, initial)
    this.mesh = this.make()
  }
  private make(): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geometry, this.material, this.capacity)
    m.count = 0
    m.frustumCulled = false
    this.parent.add(m)
    return m
  }
  set(n: number, write: (i: number, matrix: THREE.Matrix4, color: THREE.Color) => void): void {
    if (n > this.capacity) {
      this.parent.remove(this.mesh)
      this.mesh.dispose()
      this.capacity = Math.max(n, this.capacity * 2)
      this.mesh = this.make()
    }
    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    for (let i = 0; i < n; i++) {
      write(i, matrix, color)
      this.mesh.setMatrixAt(i, matrix)
      this.mesh.setColorAt(i, color)
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
  dispose(): void {
    this.parent.remove(this.mesh)
    this.mesh.dispose()
  }
}

function paintLabel(canvas: HTMLCanvasElement, text: string, color: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = color
  ctx.font = 'bold 40px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 8, canvas.height / 2)
}

/** True when the browser will hand out a WebGL context at all. */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

export default function SurfaceCodeLattice3D(props: SurfaceCodeLattice3DProps) {
  const {
    d,
    errors,
    syndrome,
    rounds,
    detection,
    matching,
    roundSpacing,
    onQubitActivate,
    activateLabel = 'Activate',
    onRendererChange,
    className = '',
    height = 440,
  } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<'pending' | 'webgl' | 'canvas2d'>('pending')

  const propsRef = useRef(props)
  propsRef.current = props
  const onActivateRef = useRef(onQubitActivate)
  onActivateRef.current = onQubitActivate
  const onRendererRef = useRef(onRendererChange)
  onRendererRef.current = onRendererChange

  /** Set by whichever renderer mounted: re-derive the frame from props and repaint. */
  const updateRef = useRef<(() => void) | null>(null)

  // ── Decide the renderer once, after mount ─────────────────────────────────
  useEffect(() => {
    const next = webglAvailable() ? 'webgl' : 'canvas2d'
    setMode(next)
  }, [])

  // ── WebGL scene ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'webgl') return
    const container = containerRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      // A context that probes fine but refuses to construct: the 2-D drawing takes over.
      setMode('canvas2d')
      return
    }
    onRendererRef.current?.('webgl')
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR))
    renderer.setClearColor(0x000000, 0)
    const canvasEl = renderer.domElement
    canvasEl.style.display = 'block'
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    canvasEl.style.touchAction = 'none'
    container.appendChild(canvasEl)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200)

    scene.add(new THREE.AmbientLight(0xffffff, 0.85))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(3, 6, 4)
    scene.add(key)

    // Shared geometries: unit shapes, scaled per instance.
    const sphereGeo = new THREE.SphereGeometry(1, 20, 14)
    const octaGeo = new THREE.OctahedronGeometry(1, 0)
    const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1)
    const shaded = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 })
    const flat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
    const axisMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })

    const dataPool = new InstancePool(scene, sphereGeo, shaded, 64)
    const stabPool = new InstancePool(scene, octaGeo, shaded, 128)
    const litPool = new InstancePool(scene, octaGeo, flat, 32)
    const edgePool = new InstancePool(scene, cylinderGeo, flat, 32)

    // Per-round outlines and the time-axis labels, rebuilt when the layer count changes.
    const guides = new THREE.Group()
    scene.add(guides)
    let guideGeometries: THREE.BufferGeometry[] = []
    let labels: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; texture: THREE.Texture; text: string }[] = []
    let guideKey = ''

    const clearGuides = () => {
      guides.clear()
      for (const g of guideGeometries) g.dispose()
      guideGeometries = []
      for (const l of labels) {
        l.texture.dispose()
        ;(l.sprite.material as THREE.Material).dispose()
      }
      labels = []
    }
    const makeLabel = (text: string, color: string, scale: number) => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 64
      paintLabel(canvas, text, color)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
      const sprite = new THREE.Sprite(material)
      sprite.scale.set(scale * 4, scale, 1)
      sprite.center.set(0, 0.5)
      sprite.renderOrder = 20
      labels.push({ sprite, canvas, texture, text })
      return sprite
    }
    const buildGuides = (frame: Frame, colors: VizColors) => {
      clearGuides()
      const { lattice, layers, roundSpacing: rs } = frame
      for (let t = 0; t < layers; t++) {
        const pts = sliceOutline(lattice, t, rs).map((p) => new THREE.Vector3(...p))
        const geo = new THREE.BufferGeometry().setFromPoints(pts)
        guideGeometries.push(geo)
        guides.add(new THREE.LineLoop(geo, outlineMat))
      }
      if (layers > 1) {
        const h = lattice.halfExtent
        const top = (layers - 1) * rs
        const axisGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(h, 0, h),
          new THREE.Vector3(h, top, h),
        ])
        guideGeometries.push(axisGeo)
        guides.add(new THREE.Line(axisGeo, axisMat))
        const l0 = makeLabel('round 0', colors.inkMuted, lattice.pitch * 0.32)
        l0.position.set(h + 0.1, 0, h)
        guides.add(l0)
        const l1 = makeLabel(`round ${layers - 1}`, colors.inkMuted, lattice.pitch * 0.32)
        l1.position.set(h + 0.1, top, h)
        guides.add(l1)
        const t = makeLabel('time ↑', colors.inkMuted, lattice.pitch * 0.32)
        t.position.set(h + 0.1, top / 2, h)
        guides.add(t)
      }
    }

    // ── Camera: spherical orbit about the stack's centre ──
    let azimuth = 0.55
    let polar = 0.95
    let zoom = 1
    let focusRadius = 3
    let focusY = 0
    const HOME = { azimuth, polar, zoom }
    const placeCamera = () => {
      const aspect = camera.aspect || 1
      const fit = aspect < 1 ? 1 / aspect : 1
      const halfFov = (camera.fov / 2) * (Math.PI / 180)
      const dist = Math.max(0.5, (focusRadius / Math.sin(halfFov)) * 1.08 * zoom * fit)
      camera.position.set(
        dist * Math.sin(polar) * Math.sin(azimuth),
        focusY + dist * Math.cos(polar),
        dist * Math.sin(polar) * Math.cos(azimuth)
      )
      camera.near = Math.max(0.01, dist / 200)
      camera.far = dist * 20
      camera.updateProjectionMatrix()
      camera.lookAt(0, focusY, 0)
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(container), () => {
      renderer.render(scene, camera)
      // Static picture: one frame per request, then idle. Under reduced motion this
      // is exactly the same — nothing here ever animated.
      return false
    })
    const kick = () => loop.start()

    // ── Writing the frame into the pools ──
    const cache = { lattice: null as Lattice3D | null }
    let colors = readVizColors(container)
    let palette = styleColors(colors, readVar('--surface', '#0d1120'))
    const UP = new THREE.Vector3(0, 1, 0)
    const dirV = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()

    const applyFrame = (frame: Frame) => {
      dataPool.set(frame.data.length, (i, m, c) => {
        const inst = frame.data[i]
        pos.set(...inst.position)
        scl.setScalar(inst.scale)
        m.compose(pos, quat.identity(), scl)
        c.set(palette[inst.style])
      })
      const unlit = frame.stabilisers.filter((s) => !s.style.endsWith('-lit'))
      const lit = frame.stabilisers.filter((s) => s.style.endsWith('-lit'))
      const writeStab = (list: Instance[]) => (i: number, m: THREE.Matrix4, c: THREE.Color) => {
        const inst = list[i]
        pos.set(...inst.position)
        scl.setScalar(inst.scale)
        m.compose(pos, quat.identity(), scl)
        c.set(palette[inst.style])
      }
      stabPool.set(unlit.length, writeStab(unlit))
      litPool.set(lit.length, writeStab(lit))
      edgePool.set(frame.edges.length, (i, m, c) => {
        const e = frame.edges[i]
        pos.set(...e.mid)
        dirV.set(...e.dir)
        quat.setFromUnitVectors(UP, dirV)
        const r = SIZES.edge * frame.lattice.pitch * (e.toBoundary ? 0.7 : 1)
        scl.set(r, e.length, r)
        m.compose(pos, quat, scl)
        c.set(edgeColor(colors, e.type))
      })

      const key = `${frame.lattice.d}:${frame.layers}:${frame.roundSpacing}`
      if (key !== guideKey) {
        guideKey = key
        buildGuides(frame, colors)
        focusRadius = sceneRadius(frame.lattice, frame.layers, frame.roundSpacing)
        focusY = stackCentreY(frame.layers, frame.roundSpacing)
        placeCamera()
      }
    }

    const update = () => {
      applyFrame(buildFrame(propsRef.current, cache))
      kick()
    }
    updateRef.current = update

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(container)
      palette = styleColors(colors, readVar('--surface', '#0d1120'))
      outlineMat.color.set(colors.inkMuted)
      axisMat.color.set(colors.inkMuted)
      for (const l of labels) {
        paintLabel(l.canvas, l.text, colors.inkMuted)
        l.texture.needsUpdate = true
      }
      update()
    })
    outlineMat.color.set(colors.inkMuted)
    axisMat.color.set(colors.inkMuted)

    // ── Input: orbit, zoom, pick ──
    const pointers = new Map<number, { x: number; y: number }>()
    let pinchDist = 0
    let downAt: { x: number; y: number; id: number } | null = null
    let moved = false

    const orbitBy = (dAz: number, dPolar: number) => {
      azimuth -= dAz
      polar = Math.min(Math.PI - 0.08, Math.max(0.08, polar - dPolar))
      placeCamera()
      kick()
    }
    const zoomBy = (factor: number) => {
      zoom = Math.min(3, Math.max(0.35, zoom * factor))
      placeCamera()
      kick()
    }
    const resetView = () => {
      azimuth = HOME.azimuth
      polar = HOME.polar
      zoom = HOME.zoom
      placeCamera()
      kick()
    }

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const pick = (clientX: number, clientY: number) => {
      const rect = canvasEl.getBoundingClientRect()
      if (!(rect.width > 0) || !(rect.height > 0)) return
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(dataPool.mesh, false)[0]
      if (hit && hit.instanceId !== undefined) onActivateRef.current?.(hit.instanceId)
    }

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      canvasEl.setPointerCapture(e.pointerId)
      if (pointers.size === 1) {
        downAt = { x: e.clientX, y: e.clientY, id: e.pointerId }
        moved = false
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        downAt = null
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const cur = { x: e.clientX, y: e.clientY }
      pointers.set(e.pointerId, cur)
      if (pointers.size === 1) {
        const dx = cur.x - prev.x
        const dy = cur.y - prev.y
        if (Math.abs(cur.x - (downAt?.x ?? cur.x)) + Math.abs(cur.y - (downAt?.y ?? cur.y)) > 4) moved = true
        orbitBy(dx * 0.008, dy * 0.008)
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0 && dist > 0) zoomBy(pinchDist / dist)
        pinchDist = dist
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      if (canvasEl.hasPointerCapture(e.pointerId)) canvasEl.releasePointerCapture(e.pointerId)
      const wasTap = downAt && downAt.id === e.pointerId && !moved && pointers.size === 1
      pointers.delete(e.pointerId)
      if (wasTap && e.type === 'pointerup') pick(e.clientX, e.clientY)
      downAt = null
      pinchDist = 0
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(1 + e.deltaY * 0.0012)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Only when the container itself is focused — the keyboard qubit buttons
      // inside it must keep their own arrow-key behaviour.
      if (e.target !== container) return
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
          resetView()
          break
        default:
          return
      }
      e.preventDefault()
    }

    canvasEl.addEventListener('pointerdown', onPointerDown)
    canvasEl.addEventListener('pointermove', onPointerMove)
    canvasEl.addEventListener('pointerup', onPointerUp)
    canvasEl.addEventListener('pointercancel', onPointerUp)
    canvasEl.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('keydown', onKeyDown)

    // ── Sizing: a 0×0 container paints a 1×1 canvas and nothing else ──
    const resize = () => {
      const w = Math.max(1, Math.floor(container.clientWidth || 0))
      const h = Math.max(1, Math.floor(container.clientHeight || 0))
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      placeCamera()
      kick()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    update()

    return () => {
      updateRef.current = null
      loop.dispose()
      stopTheme()
      resizeObserver.disconnect()
      canvasEl.removeEventListener('pointerdown', onPointerDown)
      canvasEl.removeEventListener('pointermove', onPointerMove)
      canvasEl.removeEventListener('pointerup', onPointerUp)
      canvasEl.removeEventListener('pointercancel', onPointerUp)
      canvasEl.removeEventListener('wheel', onWheel)
      container.removeEventListener('keydown', onKeyDown)
      clearGuides()
      dataPool.dispose()
      stabPool.dispose()
      litPool.dispose()
      edgePool.dispose()
      sphereGeo.dispose()
      octaGeo.dispose()
      cylinderGeo.dispose()
      shaded.dispose()
      flat.dispose()
      outlineMat.dispose()
      axisMat.dispose()
      scene.clear()
      renderer.dispose()
      if (canvasEl.parentNode === container) container.removeChild(canvasEl)
    }
  }, [mode])

  // ── 2-D fallback ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'canvas2d') return
    const container = containerRef.current
    const canvas = fallbackCanvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    onRendererRef.current?.('canvas2d')

    const cache = { lattice: null as Lattice3D | null }
    let colors = readVizColors(container)
    let size = { w: 0, h: 0 }

    const paletteFor = (c: VizColors): FallbackPalette => {
      const fills = styleColors(c, readVar('--surface', '#0d1120'))
      return {
        styleFill: (style) => fills[style],
        edgeStroke: (type) => withAlpha(edgeColor(c, type), 0.9),
        outline: withAlpha(c.inkMuted, 0.4),
        label: c.inkMuted,
      }
    }
    let palette = paletteFor(colors)

    const draw = () => {
      const { w, h } = size
      if (!(w > 0) || !(h > 0)) return
      const frame = buildFrame(propsRef.current, cache)
      drawLatticeFallback(ctx, w, h, frame, palette)
    }
    updateRef.current = draw

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const w = Math.max(0, Math.round(rect.width))
      const h = Math.max(0, Math.round(rect.height))
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      size = { w, h }
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(container)
      palette = paletteFor(colors)
      draw()
    })

    return () => {
      updateRef.current = null
      observer.disconnect()
      stopTheme()
    }
  }, [mode])

  // ── Repaint when the lattice state changes ────────────────────────────────
  useEffect(() => {
    updateRef.current?.()
  }, [d, errors, syndrome, rounds, detection, matching, roundSpacing])

  // ── Accessible description ────────────────────────────────────────────────
  const groupId = useId()
  const description = describeLattice(props)

  return (
    <div className={`relative w-full ${className}`} style={{ height }}>
      <div
        ref={containerRef}
        role="img"
        tabIndex={0}
        aria-label={`${description} Drag or use the arrow keys to rotate the view; scroll, pinch or press plus and minus to zoom; Home resets it.`}
        className="focus-ring h-full w-full overflow-hidden rounded-lg"
      >
        {mode === 'canvas2d' ? <canvas ref={fallbackCanvasRef} className="block h-full w-full" /> : null}
      </div>

      {/* Keyboard path for injecting errors. Each button is visually hidden until it
          receives focus, when it appears as a chip in the corner naming the qubit it
          stands for — a sighted keyboard user sees where focus is; a screen reader
          user hears it either way. Pointer users hit the qubit itself via raycast. */}
      {onQubitActivate ? (
        <div
          role="group"
          aria-labelledby={groupId}
          className="absolute left-2 top-2"
        >
          <span id={groupId} className="sr-only">{`Data qubits, ${d} by ${d}. ${activateLabel}.`}</span>
          {Array.from({ length: d * d }, (_, q) => {
            const r = Math.floor(q / d)
            const c = q % d
            const e = errors?.[q] ?? 'I'
            const state = e === 'I' ? 'clean' : e === 'Y' ? 'X and Z error' : `${e} error`
            return (
              <button
                key={q}
                type="button"
                onClick={() => onQubitActivate(q)}
                className="sr-only rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink focus:not-sr-only focus:absolute focus:left-0 focus:top-0 focus:z-10 focus-ring"
              >
                {`Qubit row ${r + 1}, column ${c + 1}: ${state}. ${activateLabel}.`}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** The whole picture in words, for the accessible name. */
export function describeLattice(props: SurfaceCodeLattice3DProps): string {
  const { d } = props
  const numData = d * d
  const numStab = d * d - 1
  const head = `Distance-${d} surface code as a 3-D lattice: ${numData} data qubits and ${numStab} stabilisers.`
  const counts = { X: 0, Z: 0, Y: 0 }
  for (const e of props.errors ?? []) if (e !== 'I') counts[e] += 1
  const placed = counts.X + counts.Y + counts.Z
  const errorText =
    placed === 0
      ? 'No errors placed.'
      : `${placed} error${placed === 1 ? '' : 's'} placed: ${counts.X} X, ${counts.Z} Z, ${counts.Y} Y.`
  let timeText: string
  if (props.rounds && props.rounds.length > 0) {
    const events = detectionEvents(props.rounds).length
    timeText = `${props.rounds.length} rounds of syndrome measurement stacked along the vertical time axis, with ${events} detection event${events === 1 ? '' : 's'} lit.`
  } else {
    const lit = props.syndrome ? props.syndrome.filter(Boolean).length : null
    timeText =
      lit === null ? 'One round, showing the syndrome of the placed errors.' : `One round; ${lit} stabiliser${lit === 1 ? '' : 's'} lit.`
  }
  const edges = props.matching?.length ?? 0
  const matchText = edges === 0 ? '' : ` The decoder's matching is drawn as ${edges} edge${edges === 1 ? '' : 's'}.`
  return `${head} ${errorText} ${timeText}${matchText}`
}
