'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { mountBlochFrame, placeOrbitCamera, readVar, toThree, FRAME_FALLBACKS } from './blochFrame'
import { createFrameLoop, domIntersectionWatcher, prefersReducedMotion, watchThemeChange } from './frameLoop'
import { drawMajoranaFallback } from './majoranaFallback'
import { readVizColors } from './theme'
import { convexHull, greatCircleArc, type Vec3 } from '@/lib/viz/majoranaGeometry'

/**
 * MajoranaSphere — the Bloch sphere with N points on it instead of one.
 *
 * Same globe as components/viz/BlochSphere.tsx (mounted from ./blochFrame.ts,
 * not copied), plus:
 *   • one star per entry of `stars`, eased toward its target unless the user
 *     prefers reduced motion, dimmed when it is on the far side of the sphere;
 *   • an optional trail per star (`trails[i]`, oldest → newest), drawn as
 *     great-circle arcs on the surface that fade with age;
 *   • the constellation's convex hull, faintly filled and edged, so a reader
 *     sees the SHAPE the stars make — a regular polygon for GHZ, a collapsed
 *     point for a coherent state, a stretched blob for a squeezed one;
 *   • an optional ⟨J⟩/j arrow, the "Bloch vector" of the big spin, whose
 *     shrinking is the honest measure of how non-classical the state is.
 *
 * PROP API (all Bloch coordinates: +z = |0⟩, unit vectors):
 *   stars      readonly Vec3[]            — required; keep the ORDER stable across
 *                                            renders (lib/viz/majoranaGeometry.matchStars)
 *                                            or the trails will jump between stars
 *   trails     readonly Vec3[][]          — optional, one array per star, same order
 *   showHull   boolean                    — default true
 *   meanSpin   Vec3 | null                — optional; length ≤ 1
 *   ariaLabel  string                     — optional; a default is composed from the stars
 *   className  string
 *
 * WebGL is feature-detected; when the context is refused (or three.js throws)
 * the same picture is drawn orthographically on a 2-D canvas by
 * ./majoranaFallback.ts, with drag-to-orbit intact. Load through LazyViz.
 */

export interface MajoranaSphereProps {
  stars: readonly Vec3[]
  trails?: readonly (readonly Vec3[])[]
  showHull?: boolean
  meanSpin?: Vec3 | null
  ariaLabel?: string
  className?: string
}

/** Longest trail kept per star, in stored points; each becomes ARC_SEGMENTS line segments. */
const MAX_TRAIL_POINTS = 90
const ARC_SEGMENTS = 5
const STAR_RADIUS = 0.06
const MAX_STARS = 8
/** Brute-force hull bounds: C(8,3) triangles, C(8,2) edges. */
const MAX_HULL_FACES = 56
const MAX_HULL_EDGES = 28

type Snapshot = {
  stars: readonly Vec3[]
  trails: readonly (readonly Vec3[])[]
  showHull: boolean
  meanSpin: Vec3 | null
}

function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

export function MajoranaSphere({ stars, trails, showHull = true, meanSpin = null, ariaLabel, className }: MajoranaSphereProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef<Snapshot>({ stars, trails: trails ?? [], showHull, meanSpin })
  snapshotRef.current = { stars, trails: trails ?? [], showHull, meanSpin }
  const updateRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const reduceMotion = prefersReducedMotion()

    // Camera orbit state shared by both renderers so a WebGL → 2-D swap (never
    // happens at runtime, but the code paths are symmetric) keeps the viewpoint.
    let azimuth = Math.PI * 0.75
    let polar = Math.PI * 0.42
    let radius = 4.05

    // ── Renderer selection ──────────────────────────────────────────────────
    let renderer: THREE.WebGLRenderer | null = null
    if (hasWebGL()) {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      } catch {
        renderer = null
      }
    }

    if (!renderer) {
      return mountFallback(container, snapshotRef, updateRef, () => ({ azimuth, polar }), (a, p) => {
        azimuth = a
        polar = p
      })
    }
    const gl: THREE.WebGLRenderer = renderer

    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    gl.setClearColor(0x000000, 0)
    const canvasEl = gl.domElement
    canvasEl.style.display = 'block'
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    canvasEl.style.touchAction = 'none'
    container.appendChild(canvasEl)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    const frame = mountBlochFrame(scene, { shellOpacity: 0.45 })

    const geometries: THREE.BufferGeometry[] = []
    const materials: THREE.Material[] = []

    // ── Stars: a fixed pool of meshes, shown as needed ──
    const starGeo = new THREE.SphereGeometry(STAR_RADIUS, 20, 14)
    geometries.push(starGeo)
    const starMeshes: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = []
    const starCurrent: THREE.Vector3[] = []
    const starTarget: THREE.Vector3[] = []
    for (let i = 0; i < MAX_STARS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(readVar('--q-amber', '#f2a96a')),
        transparent: true,
        opacity: 1,
      })
      materials.push(mat)
      const mesh = new THREE.Mesh(starGeo, mat)
      mesh.visible = false
      mesh.renderOrder = 5
      scene.add(mesh)
      starMeshes.push(mesh)
      starCurrent.push(new THREE.Vector3(0, 1, 0))
      starTarget.push(new THREE.Vector3(0, 1, 0))
    }

    // ── Trails: one line per star, vertex-coloured to fade with age ──
    const trailLines: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[] = []
    const trailCapacity = MAX_TRAIL_POINTS * ARC_SEGMENTS + 1
    for (let i = 0; i < MAX_STARS; i++) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trailCapacity * 3), 3))
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(trailCapacity * 3), 3))
      geo.setDrawRange(0, 0)
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
      geometries.push(geo)
      materials.push(mat)
      const line = new THREE.Line(geo, mat)
      line.visible = false
      line.renderOrder = 4
      scene.add(line)
      trailLines.push(line)
    }

    // ── Hull: faces + edges, rebuilt when the constellation changes ──
    const hullFaceGeo = new THREE.BufferGeometry()
    hullFaceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_HULL_FACES * 9), 3))
    hullFaceGeo.setDrawRange(0, 0)
    const hullFaceMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(readVar('--q-sky', FRAME_FALLBACKS.equator)),
      transparent: true,
      opacity: 0.09,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const hullEdgeGeo = new THREE.BufferGeometry()
    hullEdgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_HULL_EDGES * 6), 3))
    hullEdgeGeo.setDrawRange(0, 0)
    const hullEdgeMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(readVar('--q-sky', FRAME_FALLBACKS.equator)),
      transparent: true,
      opacity: 0.4,
    })
    geometries.push(hullFaceGeo, hullEdgeGeo)
    materials.push(hullFaceMat, hullEdgeMat)
    const hullFaces = new THREE.Mesh(hullFaceGeo, hullFaceMat)
    hullFaces.renderOrder = 3
    const hullEdges = new THREE.LineSegments(hullEdgeGeo, hullEdgeMat)
    hullEdges.renderOrder = 3
    scene.add(hullFaces, hullEdges)

    // ── ⟨J⟩ arrow: same proportions as the Bloch vector in BlochSphere.tsx ──
    const arrow = new THREE.Group()
    const SHAFT = 0.82
    const HEAD = 0.18
    const shaftGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 16)
    shaftGeo.translate(0, 0.5, 0)
    const arrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(readVar('--q-violet', FRAME_FALLBACKS.violet)) })
    const shaft = new THREE.Mesh(shaftGeo, arrowMat)
    const headGeo = new THREE.ConeGeometry(0.062, HEAD, 20)
    headGeo.translate(0, HEAD / 2, 0)
    const head = new THREE.Mesh(headGeo, arrowMat)
    geometries.push(shaftGeo, headGeo)
    materials.push(arrowMat)
    arrow.add(shaft, head)
    arrow.visible = false
    scene.add(arrow)

    const UP = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion()
    const trailColor = new THREE.Color()
    const fadeColor = new THREE.Color()

    // ── Hull: rebuilt from the EASED star positions, so it never leads the stars ──
    let hullWanted = true
    let starCount = 0
    const hullPoints: Vec3[] = []
    const updateHull = () => {
      if (!hullWanted || starCount < 2) {
        hullFaces.visible = false
        hullEdges.visible = false
        return
      }
      hullPoints.length = 0
      for (let i = 0; i < starCount; i++) {
        const c = starCurrent[i]
        hullPoints.push({ x: c.x, y: c.z, z: c.y }) // three (x, y, z) → Bloch (x, z, y)
      }
      const hull = convexHull(hullPoints)
      const fpos = hullFaceGeo.getAttribute('position') as THREE.BufferAttribute
      let fv = 0
      for (const [a, b, c] of hull.faces.slice(0, MAX_HULL_FACES)) {
        for (const idx of [a, b, c]) {
          const p = hullPoints[idx]
          fpos.setXYZ(fv++, p.x, p.z, p.y)
        }
      }
      fpos.needsUpdate = true
      hullFaceGeo.setDrawRange(0, fv)
      hullFaces.visible = fv > 0
      const epos = hullEdgeGeo.getAttribute('position') as THREE.BufferAttribute
      let ev = 0
      for (const [a, b] of hull.edges.slice(0, MAX_HULL_EDGES)) {
        const pa = hullPoints[a]
        const pb = hullPoints[b]
        epos.setXYZ(ev++, pa.x, pa.z, pa.y)
        epos.setXYZ(ev++, pb.x, pb.z, pb.y)
      }
      epos.needsUpdate = true
      hullEdgeGeo.setDrawRange(0, ev)
      hullEdges.visible = ev > 0
    }

    // ── Apply a snapshot of the props to the scene objects ──
    const applySnapshot = (snap: Snapshot, snapToTarget: boolean) => {
      const n = Math.min(snap.stars.length, MAX_STARS)
      const countChanged = n !== starCount
      starCount = n
      for (let i = 0; i < MAX_STARS; i++) {
        const mesh = starMeshes[i]
        if (i < n) {
          const s = snap.stars[i]
          starTarget[i].copy(toThree(s.x, s.y, s.z))
          if (snapToTarget || countChanged || !mesh.visible) starCurrent[i].copy(starTarget[i])
          mesh.visible = true
        } else {
          mesh.visible = false
        }
      }

      // Trails.
      trailColor.set(readVar('--q-amber', '#f2a96a'))
      fadeColor.set(readVar('--surface-2', FRAME_FALLBACKS.shell))
      for (let i = 0; i < MAX_STARS; i++) {
        const line = trailLines[i]
        const trail = snap.trails[i]
        if (i >= n || !trail || trail.length < 2) {
          line.visible = false
          continue
        }
        const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute
        const col = line.geometry.getAttribute('color') as THREE.BufferAttribute
        const pts = trail.slice(Math.max(0, trail.length - MAX_TRAIL_POINTS))
        let v = 0
        for (let k = 1; k < pts.length && v < trailCapacity; k++) {
          const arc = greatCircleArc(pts[k - 1], pts[k], ARC_SEGMENTS)
          const age = (pts.length - k) / pts.length
          for (let a = k === 1 ? 0 : 1; a < arc.length && v < trailCapacity; a++) {
            const p = arc[a]
            // Slightly above the surface so the line is never z-fought by the shell grid.
            pos.setXYZ(v, p.x * 1.012, p.z * 1.012, p.y * 1.012)
            const c = fadeColor.clone().lerp(trailColor, 1 - age)
            col.setXYZ(v, c.r, c.g, c.b)
            v++
          }
        }
        pos.needsUpdate = true
        col.needsUpdate = true
        line.geometry.setDrawRange(0, v)
        line.visible = v > 1
      }

      hullWanted = snap.showHull
      updateHull()

      // ⟨J⟩ arrow.
      if (snap.meanSpin) {
        const dir = toThree(snap.meanSpin.x, snap.meanSpin.y, snap.meanSpin.z)
        const len = Math.min(1, dir.length())
        if (len > 0.02) {
          dir.normalize()
          quat.setFromUnitVectors(UP, dir)
          arrow.quaternion.copy(quat)
          shaft.scale.set(1, SHAFT * len, 1)
          head.position.set(0, SHAFT * len, 0)
          arrow.visible = true
        } else {
          arrow.visible = false
        }
      } else {
        arrow.visible = false
      }
    }

    // ── Camera + input ──────────────────────────────────────────────────────
    const placeCamera = () => placeOrbitCamera(camera, radius, azimuth, polar)

    const cameraDir = new THREE.Vector3()
    const draw = (): boolean => {
      let moving = false
      camera.getWorldDirection(cameraDir)
      for (let i = 0; i < starCount; i++) {
        const cur = starCurrent[i]
        const tgt = starTarget[i]
        if (reduceMotion) {
          cur.copy(tgt)
        } else if (cur.distanceToSquared(tgt) > 1e-8) {
          cur.lerp(tgt, 0.22)
          // Keep eased positions on the sphere, not on the chord.
          if (cur.lengthSq() > 1e-6) cur.normalize()
          else cur.copy(tgt)
          moving = true
        } else {
          cur.copy(tgt)
        }
        const mesh = starMeshes[i]
        mesh.position.copy(cur)
        // Far-side stars dim so depth reads even though the shell is see-through.
        const facing = -cur.dot(cameraDir)
        mesh.material.opacity = facing >= 0 ? 1 : 0.35
      }
      if (moving) updateHull()
      gl.render(scene, camera)
      return moving
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(container), () => draw())
    const kick = () => loop.start()

    let dragging = false
    let lastX = 0
    let lastY = 0
    const orbitBy = (dAz: number, dPolar: number) => {
      azimuth -= dAz
      polar = Math.min(Math.PI - 0.05, Math.max(0.05, polar - dPolar))
      placeCamera()
      kick()
    }
    const zoomBy = (delta: number) => {
      radius = Math.min(7.5, Math.max(2.6, radius + delta))
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
      zoomBy(e.deltaY * 0.0022)
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
          zoomBy(-0.5)
          break
        case '-':
        case '_':
          zoomBy(0.5)
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

    // ── Sizing: a 0×0 box sets nothing up that could divide by zero ──
    const resize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (!(w > 0) || !(h > 0)) return
      gl.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      placeCamera()
      kick()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    // ── Theme ──
    const unwatchTheme = watchThemeChange(() => {
      frame.recolor()
      const amber = readVar('--q-amber', '#f2a96a')
      for (const m of starMeshes) m.material.color.set(amber)
      hullFaceMat.color.set(readVar('--q-sky', FRAME_FALLBACKS.equator))
      hullEdgeMat.color.set(readVar('--q-sky', FRAME_FALLBACKS.equator))
      arrowMat.color.set(readVar('--q-violet', FRAME_FALLBACKS.violet))
      applySnapshot(snapshotRef.current, true)
      kick()
    })

    updateRef.current = () => {
      applySnapshot(snapshotRef.current, false)
      kick()
    }
    applySnapshot(snapshotRef.current, true)
    placeCamera()
    kick()

    return () => {
      updateRef.current = null
      loop.dispose()
      unwatchTheme()
      resizeObserver.disconnect()
      canvasEl.removeEventListener('pointerdown', onPointerDown)
      canvasEl.removeEventListener('pointermove', onPointerMove)
      canvasEl.removeEventListener('pointerup', endDrag)
      canvasEl.removeEventListener('pointercancel', endDrag)
      canvasEl.removeEventListener('wheel', onWheel)
      container.removeEventListener('keydown', onKeyDown)
      frame.dispose()
      scene.clear()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      gl.dispose()
      if (canvasEl.parentNode === container) container.removeChild(canvasEl)
    }
  }, [])

  useEffect(() => {
    updateRef.current?.()
  }, [stars, trails, showHull, meanSpin])

  const label =
    ariaLabel ??
    `Bloch sphere with ${stars.length} Majorana star${stars.length === 1 ? '' : 's'}: ${stars
      .map((s) => {
        const theta = Math.acos(Math.max(-1, Math.min(1, s.z))) / Math.PI
        const phi = Math.atan2(s.y, s.x) / Math.PI
        return `theta ${theta.toFixed(2)} pi, phi ${phi.toFixed(2)} pi`
      })
      .join('; ')}. Drag or use the arrow keys to rotate the view; scroll or press plus and minus to zoom.`

  return (
    <div
      ref={containerRef}
      role="img"
      tabIndex={0}
      aria-label={label}
      className={`focus-ring w-full min-h-[420px] overflow-hidden rounded-lg ${className ?? ''}`}
    />
  )
}

/**
 * The no-WebGL path: a 2-D canvas driven by ./majoranaFallback.ts. Same orbit
 * gestures, same keyboard, redraws on prop, size and theme changes only (there
 * is no easing to animate, so no frame loop is needed).
 */

/**
 * Convert the 3-D orbit camera's (azimuth, polar) into the (yaw, pitch) the
 * 2-D fallback's `projectOrtho` expects, so the no-WebGL view matches the
 * WebGL scene instead of mirroring it left-right.
 *
 * Verified directly against three.js's own camera + `Vector3.project()`: for
 * 5 test stars at azimuth=1.1, polar=1.3, `yaw = azimuth` reproduces the true
 * 3-D screen-space x sign on all 5 points; a previous `π − azimuth` here
 * mismatched on 3 of 5 (a left-right mirror of the 3-D scene for any
 * constellation off the polar axis, i.e. anything but a pure |0⟩/|1⟩ state).
 * `pitch` was already correct. See majoranaCamera.test.ts.
 */
export function fallbackCameraAngles(azimuth: number, polar: number): { yaw: number; pitch: number } {
  return { yaw: azimuth, pitch: Math.PI / 2 - polar }
}

function mountFallback(
  container: HTMLDivElement,
  snapshotRef: { current: Snapshot },
  updateRef: { current: (() => void) | null },
  getOrbit: () => { azimuth: number; polar: number },
  setOrbit: (azimuth: number, polar: number) => void
): () => void {
  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const redraw = () => {
    if (!ctx) return
    const w = container.clientWidth
    const h = container.clientHeight
    if (!(w > 0) || !(h > 0)) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { azimuth, polar } = getOrbit()
    const snap = snapshotRef.current
    drawMajoranaFallback(ctx, w, h, readVizColors(container), {
      stars: snap.stars,
      trails: snap.trails,
      hull: snap.showHull ? convexHull(snap.stars) : { vertices: [], faces: [], edges: [] },
      meanSpin: snap.meanSpin,
      ...fallbackCameraAngles(azimuth, polar),
    })
  }

  let dragging = false
  let lastX = 0
  let lastY = 0
  const orbitBy = (dAz: number, dPolar: number) => {
    const { azimuth, polar } = getOrbit()
    setOrbit(azimuth - dAz, Math.min(Math.PI - 0.05, Math.max(0.05, polar - dPolar)))
    redraw()
  }
  const onPointerDown = (e: PointerEvent) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    canvas.setPointerCapture(e.pointerId)
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
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
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
      default:
        return
    }
    e.preventDefault()
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  container.addEventListener('keydown', onKeyDown)

  const resizeObserver = new ResizeObserver(redraw)
  resizeObserver.observe(container)
  const unwatchTheme = watchThemeChange(redraw)
  updateRef.current = redraw
  redraw()

  return () => {
    updateRef.current = null
    resizeObserver.disconnect()
    unwatchTheme()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', endDrag)
    canvas.removeEventListener('pointercancel', endDrag)
    container.removeEventListener('keydown', onKeyDown)
    if (canvas.parentNode === container) container.removeChild(canvas)
  }
}

export default MajoranaSphere
