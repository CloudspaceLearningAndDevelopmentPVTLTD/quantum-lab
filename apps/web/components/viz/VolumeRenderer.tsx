'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Volume } from '@/lib/quantum/schrodinger3d'
import { createFrameLoop, domIntersectionWatcher, watchThemeChange } from './frameLoop'
import {
  type Axis3,
  type ClipSpec,
  type Rgb,
  type VolumePalette,
  axisVectorThree,
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
} from './volumeLayout'
import { VOLUME_FRAGMENT_SHADER, VOLUME_VERTEX_SHADER } from './volumeShaders'

/**
 * VolumeRenderer — a probability density drawn as the cloud it is.
 *
 * Ray-marches a 3-D texture of |ψ|² (any `Volume` from lib/quantum/schrodinger3d.ts)
 * with an emission–absorption model: every voxel glows and absorbs in proportion to
 * its density, front to back, so what reaches the eye is the accumulated
 * probability along each line of sight. No isosurface is ever extracted, because a
 * wavefunction has no edge to extract — the 90% surface in a textbook is a choice,
 * and the cloud is not.
 *
 * ── Prop API ────────────────────────────────────────────────────────────────────
 *   volume        Volume            the density + phase grid to draw (required)
 *   threshold     0..1  (0.02)      normalised density below which voxels are clear
 *   opacity       >0    (1)         multiplies every voxel's absorption; 0.2 is a
 *                                   thin haze, 3 is nearly solid
 *   colorMode     'density'|'phase' 'density' ramps low → high; 'phase' colours by
 *                                   arg ψ (two colours for a real state, a full hue
 *                                   wheel for a complex one)
 *   clip          ClipSpec          { axis: 'x'|'y'|'z', offset: 0..1, enabled }
 *                                   removes the +axis side beyond `offset`
 *   onClipChange  (offset) => void  fires while the reader drags the plane in
 *                                   the 3-D view, or moves it with [ and ]
 *   mode          'auto'|'volume'|'slice'  'auto' (default) uses WebGL2 when the
 *                                   browser offers it and the slice viewer otherwise
 *   steps         int (128)         ray-march samples per ray; lower on weak GPUs
 *   axisLabels    [x, y, z]         labels for the three physics axes
 *   ariaLabel     string            spoken description of what is on screen
 *   className, minHeight
 *
 * The component is controlled: it never owns the clip offset, it reports drags
 * through `onClipChange`, so the same slider on the page moves the plane and the
 * same keyboard shortcut works in the 3-D view and in the fallback.
 *
 * ── Interaction ─────────────────────────────────────────────────────────────────
 *   drag              orbit          wheel / + −     zoom
 *   drag on the plane move the clip  [ ]             move the clip plane
 *   arrow keys        orbit          (all keyboard controls need focus: Tab to it)
 *
 * ── Fallback ────────────────────────────────────────────────────────────────────
 * WebGL2 is required for 3-D textures (three r163+ is WebGL2-only). When the
 * probe context is refused, or the renderer throws, the same props drive a 2-D
 * slice viewer on a plain canvas: one plane through the cloud at the clip
 * offset, with the same transfer function and colours. It teaches the nodal
 * structure even without a GPU.
 *
 * ── House rules honoured ────────────────────────────────────────────────────────
 * Colours are read from the CSS tokens at mount and on every theme flip; the
 * frame loop is gated by createFrameLoop (off-screen and hidden-tab pause) and
 * only draws on demand — there is no idle animation, so prefers-reduced-motion
 * changes nothing except the lack of easing, which this component never had.
 * Everything three.js allocates is disposed on unmount; devicePixelRatio is
 * capped at 2; a zero-size container draws nothing and throws nothing.
 */

export type VolumeColorMode = 'density' | 'phase'
export type VolumeRenderMode = 'auto' | 'volume' | 'slice'

export interface VolumeRendererProps {
  volume: Volume
  threshold?: number
  opacity?: number
  colorMode?: VolumeColorMode
  clip?: ClipSpec
  onClipChange?: (offset: number) => void
  mode?: VolumeRenderMode
  steps?: number
  axisLabels?: [string, string, string]
  ariaLabel?: string
  className?: string
  minHeight?: number
}

export type { ClipSpec, Axis3 } from './volumeLayout'

let probeResult: boolean | null = null

/**
 * True when this browser can create a WebGL2 context (3-D textures are core
 * there). Probed once per page load and cached: every probe is a real GL
 * context, and browsers cap those at around sixteen.
 */
export function supportsVolumeRendering(): boolean {
  if (typeof document === 'undefined') return false
  if (probeResult !== null) return probeResult
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2')
    probeResult = Boolean(gl)
    // Hand the probe context back straight away.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    probeResult = false
  }
  return probeResult
}

const FALLBACK = {
  violet: '#a99dff',
  ink: '#eef2ff',
  inkMuted: '#7d8cb0',
  rose: '#e57969',
  amber: '#f2a96a',
  sky: '#6283c8',
  teal: '#4edbca',
  surface: '#0d1120',
} as const

function readVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function readPalette(): VolumePalette & { muted: Rgb; surface: Rgb } {
  return {
    low: parseHex(readVar('--q-violet', FALLBACK.violet), parseHex(FALLBACK.violet, [0.5, 0.4, 1])),
    high: parseHex(readVar('--ink', FALLBACK.ink), parseHex(FALLBACK.ink, [1, 1, 1])),
    phase: [
      parseHex(readVar('--q-rose', FALLBACK.rose), parseHex(FALLBACK.rose, [1, 0.3, 0.5])),
      parseHex(readVar('--q-amber', FALLBACK.amber), parseHex(FALLBACK.amber, [1, 0.7, 0.2])),
      parseHex(readVar('--q-sky', FALLBACK.sky), parseHex(FALLBACK.sky, [0.4, 0.7, 1])),
      parseHex(readVar('--q-teal', FALLBACK.teal), parseHex(FALLBACK.teal, [0.2, 0.8, 0.7])),
    ],
    muted: parseHex(readVar('--ink-muted', FALLBACK.inkMuted), parseHex(FALLBACK.inkMuted, [0.5, 0.55, 0.7])),
    surface: parseHex(readVar('--surface', FALLBACK.surface), parseHex(FALLBACK.surface, [0.05, 0.07, 0.12])),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

type Applied = {
  volume: Volume
  threshold: number
  opacity: number
  colorMode: VolumeColorMode
  clip: ClipSpec | undefined
  steps: number
}

export function VolumeRenderer({
  volume,
  threshold = 0.02,
  opacity = 1,
  colorMode = 'density',
  clip,
  onClipChange,
  mode = 'auto',
  steps = 128,
  axisLabels = ['x', 'y', 'z'],
  ariaLabel,
  className,
  minHeight = 440,
}: VolumeRendererProps) {
  // Decided once on the client: the server never knows, and flipping modes
  // after mount would tear down a live context for nothing.
  const [useVolume, setUseVolume] = useState<boolean | null>(null)
  useEffect(() => {
    if (mode === 'slice') setUseVolume(false)
    else if (mode === 'volume') setUseVolume(true)
    else setUseVolume(supportsVolumeRendering())
  }, [mode])

  const clipLabel = clip?.enabled
    ? ` A clip plane perpendicular to ${axisLabels[clip.axis === 'x' ? 0 : clip.axis === 'y' ? 1 : 2]} at ${Math.round(
        clampOffset(clip.offset) * 100
      )}% removes the near side.`
    : ''
  const label =
    (ariaLabel ?? `Probability density of ${volume.label} drawn as a translucent cloud.`) +
    clipLabel +
    (useVolume
      ? ' Drag or use the arrow keys to rotate; scroll or press plus and minus to zoom; press [ or ] to move the clip plane.'
      : ' Showing a single slice through the cloud. Press [ or ] to move the slice.')

  if (useVolume === null) {
    return <div className={`w-full ${className ?? ''}`} style={{ minHeight }} aria-busy="true" />
  }
  if (!useVolume) {
    return (
      <SliceViewer
        volume={volume}
        threshold={threshold}
        colorMode={colorMode}
        clip={clip}
        onClipChange={onClipChange}
        axisLabels={axisLabels}
        label={label}
        className={className}
        minHeight={minHeight}
      />
    )
  }
  return (
    <VolumeScene
      volume={volume}
      threshold={threshold}
      opacity={opacity}
      colorMode={colorMode}
      clip={clip}
      onClipChange={onClipChange}
      steps={steps}
      axisLabels={axisLabels}
      label={label}
      className={className}
      minHeight={minHeight}
      onContextFailure={() => setUseVolume(false)}
    />
  )
}

export default VolumeRenderer

// ─────────────────────────────────────────────────────────────────────────────
// The WebGL scene
// ─────────────────────────────────────────────────────────────────────────────

function VolumeScene({
  volume,
  threshold,
  opacity,
  colorMode,
  clip,
  onClipChange,
  steps,
  axisLabels,
  label,
  className,
  minHeight,
  onContextFailure,
}: Required<Pick<VolumeRendererProps, 'volume' | 'threshold' | 'opacity' | 'colorMode' | 'steps' | 'axisLabels'>> & {
  clip: ClipSpec | undefined
  onClipChange?: (offset: number) => void
  label: string
  className?: string
  minHeight: number
  onContextFailure: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const applyRef = useRef<((a: Applied) => void) | null>(null)
  const propsRef = useRef<Applied>({ volume, threshold, opacity, colorMode, clip, steps })
  propsRef.current = { volume, threshold, opacity, colorMode, clip, steps }
  const onClipRef = useRef(onClipChange)
  onClipRef.current = onClipChange
  const labelsRef = useRef(axisLabels)
  labelsRef.current = axisLabels

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    } catch {
      onContextFailure()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    const canvasEl = renderer.domElement
    // Absolutely positioned so the canvas's intrinsic size can never feed back
    // into the container's layout. (An in-flow canvas with height:100% in an
    // auto-height parent takes its aspect from its own width/height
    // attributes; after a 0-width paint that ratio is 1:300, and the box grew
    // to 90,000 px tall in a headless check before this was fixed.)
    canvasEl.style.position = 'absolute'
    canvasEl.style.inset = '0'
    canvasEl.style.display = 'block'
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    canvasEl.style.touchAction = 'none'
    container.appendChild(canvasEl)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100)
    // prefers-reduced-motion: nothing to switch off — the loop only draws on
    // demand and there is no auto-rotation or easing anywhere in this scene.

    const disposables: { dispose(): void }[] = []
    let palette = readPalette()

    // ── Volume cube ─────────────────────────────────────────────────────────
    const cubeGeo = new THREE.BoxGeometry(1, 1, 1)
    const uniforms = {
      uVolume: { value: null as THREE.Data3DTexture | null },
      uCameraObj: { value: new THREE.Vector3() },
      uThreshold: { value: threshold },
      uOpacity: { value: opacity },
      uSteps: { value: steps },
      uColorMode: { value: colorMode === 'phase' ? 1 : 0 },
      uLow: { value: new THREE.Vector3(...palette.low) },
      uHigh: { value: new THREE.Vector3(...palette.high) },
      uPhase0: { value: new THREE.Vector3(...palette.phase[0]) },
      uPhase1: { value: new THREE.Vector3(...palette.phase[1]) },
      uPhase2: { value: new THREE.Vector3(...palette.phase[2]) },
      uPhase3: { value: new THREE.Vector3(...palette.phase[3]) },
      uClip: { value: new THREE.Vector4(1, 0, 0, 1e9) },
    }
    const cubeMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VOLUME_VERTEX_SHADER,
      fragmentShader: VOLUME_FRAGMENT_SHADER,
      uniforms,
      side: THREE.BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
    })
    disposables.push(cubeGeo, cubeMat)
    const cube = new THREE.Mesh(cubeGeo, cubeMat)
    cube.renderOrder = 10
    cube.frustumCulled = false
    scene.add(cube)

    // ── Box edges ───────────────────────────────────────────────────────────
    const edgesGeo = new THREE.EdgesGeometry(cubeGeo)
    const edgesMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(...palette.muted),
      transparent: true,
      opacity: 0.5,
    })
    disposables.push(edgesGeo, edgesMat)
    const edges = new THREE.LineSegments(edgesGeo, edgesMat)
    scene.add(edges)

    // ── Axis labels ─────────────────────────────────────────────────────────
    const labelSprites: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; index: number }[] = []
    const paintLabel = (canvas: HTMLCanvasElement, text: string) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const [r, g, b] = palette.muted
      ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
      ctx.font = 'bold 56px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    }
    for (let k = 0; k < 3; k++) {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      paintLabel(canvas, axisLabels[k])
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.setScalar(0.22)
      sprite.renderOrder = 20
      disposables.push(tex, mat)
      labelSprites.push({ sprite, canvas, index: k })
      scene.add(sprite)
    }

    // ── Clip plane handle ───────────────────────────────────────────────────
    const planeGeo = new THREE.PlaneGeometry(1, 1)
    const planeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(...palette.low),
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    const planeEdgeGeo = new THREE.EdgesGeometry(planeGeo)
    const planeEdgeMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(...palette.low),
      transparent: true,
      opacity: 0.9,
    })
    disposables.push(planeGeo, planeMat, planeEdgeGeo, planeEdgeMat)
    const plane = new THREE.Mesh(planeGeo, planeMat)
    plane.renderOrder = 5
    const planeEdge = new THREE.LineSegments(planeEdgeGeo, planeEdgeMat)
    planeEdge.renderOrder = 6
    plane.add(planeEdge)
    plane.visible = false
    scene.add(plane)

    // ── State ───────────────────────────────────────────────────────────────
    let texture: THREE.Data3DTexture | null = null
    let textureVolume: Volume | null = null
    let boxScale: [number, number, number] = [1, 1, 1]
    let azimuth = Math.PI * 0.32
    let polar = Math.PI * 0.36
    let zoom = 1
    let clipNormal: [number, number, number] = [1, 0, 0]
    let clipLength = 1
    let currentClip: ClipSpec | undefined

    const placeCamera = () => {
      const dist = fitDistance(boxScale, camera.fov, camera.aspect) * zoom
      const [x, y, z] = orbitPosition(dist, azimuth, polar)
      camera.position.set(x, y, z)
      camera.near = Math.max(0.01, dist / 100)
      camera.far = dist * 10
      camera.updateProjectionMatrix()
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      cube.updateMatrixWorld()
      uniforms.uCameraObj.value.copy(cube.worldToLocal(camera.position.clone()))
    }

    let width = 0
    let height = 0
    const renderOnce = () => {
      // A 0 × 0 container is a legal first paint: draw nothing.
      if (width < 2 || height < 2) return
      renderer.render(scene, camera)
    }
    const loop = createFrameLoop(window, document, domIntersectionWatcher(container), () => {
      renderOnce()
      return false // on-demand: no idle frames, ever
    })
    const kick = () => loop.start()

    const placePlane = () => {
      const c = currentClip
      if (!c || !c.enabled) {
        plane.visible = false
        return
      }
      const { center, normal } = clipPlanePlacement(c, boxScale)
      const { rotation, size, length } = clipPlaneTransform(c.axis, boxScale)
      plane.visible = true
      plane.position.set(center[0], center[1], center[2])
      plane.rotation.set(rotation[0], rotation[1], rotation[2])
      plane.scale.set(size[0], size[1], 1)
      clipNormal = normal
      clipLength = length
    }

    const placeLabels = () => {
      // Labels sit just past the +x, +y, +z faces (physics axes).
      for (const { sprite, index } of labelSprites) {
        const axis: Axis3 = index === 0 ? 'x' : index === 1 ? 'y' : 'z'
        const dir = axisVectorThree(axis)
        const k = dir.findIndex((c) => c !== 0)
        const half = boxScale[k] / 2 + 0.14
        sprite.position.set(dir[0] * half, dir[1] * half, dir[2] * half)
      }
    }

    const apply = (a: Applied) => {
      if (textureVolume !== a.volume) {
        texture?.dispose()
        const data = encodeVolumeRgba(a.volume)
        texture = new THREE.Data3DTexture(data, a.volume.nx, a.volume.ny, a.volume.nz)
        texture.format = THREE.RGBAFormat
        texture.type = THREE.UnsignedByteType
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping
        texture.needsUpdate = true
        textureVolume = a.volume
        uniforms.uVolume.value = texture
        boxScale = boxWorldScale(a.volume)
        cube.scale.set(boxScale[0], boxScale[1], boxScale[2])
        edges.scale.set(boxScale[0], boxScale[1], boxScale[2])
        placeLabels()
      }
      uniforms.uThreshold.value = Math.min(0.999, Math.max(0, a.threshold))
      uniforms.uOpacity.value = Math.max(0, a.opacity)
      uniforms.uSteps.value = Math.max(8, Math.min(512, Math.round(a.steps)))
      uniforms.uColorMode.value = a.colorMode === 'phase' ? 1 : 0
      const cu = clipUniform(a.clip)
      uniforms.uClip.value.set(cu[0], cu[1], cu[2], cu[3])
      currentClip = a.clip
      placePlane()
      placeCamera()
      kick()
    }
    applyRef.current = apply

    // ── Theme ───────────────────────────────────────────────────────────────
    const recolor = () => {
      palette = readPalette()
      uniforms.uLow.value.set(...palette.low)
      uniforms.uHigh.value.set(...palette.high)
      uniforms.uPhase0.value.set(...palette.phase[0])
      uniforms.uPhase1.value.set(...palette.phase[1])
      uniforms.uPhase2.value.set(...palette.phase[2])
      uniforms.uPhase3.value.set(...palette.phase[3])
      edgesMat.color.set(...palette.muted)
      planeMat.color.set(...palette.low)
      planeEdgeMat.color.set(...palette.low)
      for (const { canvas, index, sprite } of labelSprites) {
        paintLabel(canvas, labelsRef.current[index])
        const m = sprite.material as THREE.SpriteMaterial
        if (m.map) m.map.needsUpdate = true
      }
      kick()
    }
    const unwatchTheme = watchThemeChange(recolor)

    // ── Pointer: orbit, or drag the clip plane when the press lands on it ──
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let dragging: 'orbit' | 'clip' | null = null
    let lastX = 0
    let lastY = 0

    const project = (p: [number, number, number]): [number, number] => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera)
      return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height]
    }

    const orbitBy = (dAz: number, dPolar: number) => {
      azimuth -= dAz
      polar = Math.min(Math.PI - 0.06, Math.max(0.06, polar - dPolar))
      placeCamera()
      kick()
    }
    const zoomBy = (factor: number) => {
      zoom = Math.min(3, Math.max(0.45, zoom * factor))
      placeCamera()
      kick()
    }
    const nudgeClip = (delta: number) => {
      const c = propsRef.current.clip
      if (!c || !c.enabled) return
      onClipRef.current?.(clampOffset(c.offset + delta))
    }

    const onPointerDown = (e: PointerEvent) => {
      lastX = e.clientX
      lastY = e.clientY
      dragging = 'orbit'
      if (plane.visible && width > 0 && height > 0) {
        const rect = canvasEl.getBoundingClientRect()
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        if (raycaster.intersectObject(plane, false).length > 0) dragging = 'clip'
      }
      canvasEl.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      if (dragging === 'clip') {
        const delta = dragToOffsetDelta([dx, dy], clipNormal, clipLength, project)
        if (delta !== 0) nudgeClip(delta)
      } else {
        orbitBy(dx * 0.008, dy * 0.008)
      }
    }
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return
      dragging = null
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
        case '[':
          nudgeClip(e.shiftKey ? -0.1 : -0.02)
          break
        case ']':
          nudgeClip(e.shiftKey ? 0.1 : 0.02)
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

    // ── Context loss: fall back rather than show a blank box ────────────────
    const onContextLost = (e: Event) => {
      e.preventDefault()
      onContextFailure()
    }
    canvasEl.addEventListener('webglcontextlost', onContextLost)

    // ── Sizing ──────────────────────────────────────────────────────────────
    const resize = () => {
      width = container.clientWidth
      height = container.clientHeight
      // A collapsed box gets a 1 × 1 buffer, never 1 × N: renderOnce() skips
      // drawing below 2 px anyway, and a square buffer has no aspect to leak.
      if (width < 2 || height < 2) renderer.setSize(1, 1, false)
      else renderer.setSize(width, height, false)
      camera.aspect = height >= 2 && width >= 2 ? width / height : 1
      placeCamera()
      kick()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    apply(propsRef.current)

    return () => {
      applyRef.current = null
      loop.dispose()
      unwatchTheme()
      resizeObserver.disconnect()
      canvasEl.removeEventListener('pointerdown', onPointerDown)
      canvasEl.removeEventListener('pointermove', onPointerMove)
      canvasEl.removeEventListener('pointerup', endDrag)
      canvasEl.removeEventListener('pointercancel', endDrag)
      canvasEl.removeEventListener('wheel', onWheel)
      canvasEl.removeEventListener('webglcontextlost', onContextLost)
      container.removeEventListener('keydown', onKeyDown)
      scene.clear()
      texture?.dispose()
      for (const d of disposables) d.dispose()
      renderer.dispose()
      if (canvasEl.parentNode === container) container.removeChild(canvasEl)
    }
    // The scene is built once; prop changes flow through applyRef below.
  }, [])

  useEffect(() => {
    applyRef.current?.({ volume, threshold, opacity, colorMode, clip, steps })
  }, [volume, threshold, opacity, colorMode, clip, steps])

  return (
    <div
      ref={containerRef}
      role="img"
      tabIndex={0}
      aria-label={label}
      className={`focus-ring relative w-full max-w-full overflow-hidden rounded-lg ${className ?? ''}`}
      // position inline as well as via the utility class: the absolutely
      // positioned canvas must never escape this box, whatever CSS is loaded.
      style={{ minHeight, position: 'relative' }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The 2-D slice fallback
// ─────────────────────────────────────────────────────────────────────────────

function SliceViewer({
  volume,
  threshold,
  colorMode,
  clip,
  onClipChange,
  axisLabels,
  label,
  className,
  minHeight,
}: {
  volume: Volume
  threshold: number
  colorMode: VolumeColorMode
  clip: ClipSpec | undefined
  onClipChange?: (offset: number) => void
  axisLabels: [string, string, string]
  label: string
  className?: string
  minHeight: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const axis: Axis3 = clip?.axis ?? 'x'
  const offset = clampOffset(clip?.offset ?? 0.5)
  const onClipRef = useRef(onClipChange)
  onClipRef.current = onClipChange

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const palette = readPalette()
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (w < 2 || h < 2) return

      const slice = paintSlice(volume, {
        axis,
        offset,
        threshold,
        colorMode,
        palette,
        background: palette.surface,
      })
      const pad = 28
      const rect = fitRect(slice.width, slice.height, w - pad * 2, h - pad * 2)
      if (rect.width <= 0 || rect.height <= 0) return
      const image = new ImageData(slice.rgba, slice.width, slice.height)
      // Draw at native resolution then scale with smoothing: bilinear over the
      // voxel grid, the same interpolation the 3-D texture would get.
      const off = document.createElement('canvas')
      off.width = slice.width
      off.height = slice.height
      off.getContext('2d')?.putImageData(image, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, rect.x + pad, rect.y + pad, rect.width, rect.height)

      const [mr, mg, mb] = palette.muted
      const muted = `rgb(${Math.round(mr * 255)}, ${Math.round(mg * 255)}, ${Math.round(mb * 255)})`
      ctx.strokeStyle = muted
      ctx.lineWidth = 1
      ctx.strokeRect(rect.x + pad + 0.5, rect.y + pad + 0.5, rect.width - 1, rect.height - 1)
      ctx.fillStyle = muted
      ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const hi = slice.horizontal === 'x' ? 0 : slice.horizontal === 'y' ? 1 : 2
      const vi = slice.vertical === 'x' ? 0 : slice.vertical === 'y' ? 1 : 2
      ctx.fillText(axisLabels[hi], rect.x + pad + rect.width / 2, rect.y + pad + rect.height + 6)
      ctx.save()
      ctx.translate(rect.x + pad - 8, rect.y + pad + rect.height / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textBaseline = 'bottom'
      ctx.fillText(axisLabels[vi], 0, 0)
      ctx.restore()
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      // Short enough to fit a 300 px canvas; the full explanation is in the aria-label.
      ctx.fillText(`slice at ${axisLabels[ai]} = ${Math.round(offset * 100)}% · flat view`, pad, 8)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    const unwatch = watchThemeChange(draw)
    return () => {
      ro.disconnect()
      unwatch()
    }
  }, [volume, threshold, colorMode, axis, offset, axisLabels])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '[') onClipRef.current?.(clampOffset(offset - (e.shiftKey ? 0.1 : 0.02)))
    else if (e.key === ']') onClipRef.current?.(clampOffset(offset + (e.shiftKey ? 0.1 : 0.02)))
    else return
    e.preventDefault()
  }

  return (
    <div
      role="img"
      tabIndex={0}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`focus-ring relative w-full max-w-full overflow-hidden rounded-lg ${className ?? ''}`}
      style={{ minHeight, position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  )
}
