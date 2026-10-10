'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  bohrRadiusOfOrbit,
  expectedRadius,
  orbitalName,
  sampleOrbitalCloud,
} from '@/lib/quantum/hydrogen'
import { createFrameLoop, domIntersectionWatcher, prefersReducedMotion } from './frameLoop'
import { hydrogenVolume } from '@/lib/quantum/schrodinger3d'
import { VolumeRenderer, supportsVolumeRendering } from './VolumeRenderer'

/**
 * HydrogenAtom — one three.js scene that can draw the same atom two ways.
 *
 * `model: 'bohr'` gives Bohr's 1913 picture: the electron on a circular orbit
 * of radius n²a₀, one orbit per allowed energy. `model: 'schrodinger'` throws
 * the orbit away and draws a point cloud sampled from |ψ_{n,l,m}|², computed
 * analytically in lib/quantum/hydrogen.ts. Both are drawn to the same length
 * scale in Bohr radii, so switching between them is a fair comparison rather
 * than a change of zoom.
 *
 * WHY A POINT CLOUD AND NOT AN ISOSURFACE. The textbook "orbital" shape is a
 * surface enclosing some arbitrary fraction of the probability — 90%, usually —
 * and its hard edge is the single most misleading thing about the standard
 * picture. A cloud of independent samples from |ψ|² has no edge, because the
 * wavefunction has none: density is what varies. Every dot is one hypothetical
 * position measurement.
 *
 * Structure follows BlochSphere.tsx: no OrbitControls (three/examples is not
 * available here), so the orbit is implemented directly on pointer and key
 * events. The renderer is created once and the *contents* are rebuilt when the
 * quantum numbers change, so the camera the reader positioned survives a change
 * of state — remounting the whole WebGL context on every slider tick would both
 * lose their viewpoint and churn GPU contexts.
 */

export type AtomModel = 'bohr' | 'schrodinger'

/**
 * How the Schrödinger picture is drawn. `points` is the sampled cloud below;
 * `cloud` ray-marches |ψ|² on a 3-D texture through VolumeRenderer.tsx, which
 * needs WebGL2 — where that is missing, `cloud` silently falls back to points.
 * Ignored for the Bohr model, which has no density to draw.
 */
export type AtomRender = 'points' | 'cloud'

export type HydrogenAtomProps = {
  model: AtomModel
  n: number
  l: number
  m: number
  /** Number of |ψ|² samples to draw. */
  detail: number
  /** Clip the near half of the cloud so the interior nodes are visible. */
  cutaway: boolean
  /** Point cloud (default) or ray-marched density cloud. */
  render?: AtomRender
  className?: string
}

const FALLBACK = {
  rose: '#ef4a6b',
  sky: '#6283c8',
  amber: '#f2a96a',
  ink: '#eef2ff',
  inkMuted: '#7d8cb0',
  violetText: '#c1bbfe',
} as const

function readVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** (Re)paint a sprite label's canvas in place, so a theme flip can recolour it. */
function paintLabel(canvas: HTMLCanvasElement, text: string, color: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = color
  ctx.font = 'bold 56px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
}

/** A circle of radius `r` in the xz plane (the plane that reads as "the orbit"). */
function orbitGeometry(r: number, segments = 192): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(t) * r, 0, Math.sin(t) * r))
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

type BuildSpec = Omit<HydrogenAtomProps, 'render'>

/**
 * The public component: routes to the density cloud when asked for it and the
 * browser can do it, and to the point cloud otherwise. Keyed so switching
 * modes remounts cleanly instead of trying to share one WebGL context.
 */
export function HydrogenAtom({ render = 'points', ...props }: HydrogenAtomProps) {
  // Decided once per mount. This component only ever loads client-side (see
  // LazyViz), so the probe runs in a real browser.
  const [canVolume] = useState(() => supportsVolumeRendering())
  if (render === 'cloud' && props.model === 'schrodinger' && canVolume) {
    return <HydrogenCloud key="cloud" {...props} />
  }
  return <HydrogenAtomPoints key="points" {...props} />
}

/** Voxels per axis for a given point-count "detail" setting. */
function cloudResolution(detail: number): number {
  return detail >= 60000 ? 64 : detail >= 30000 ? 52 : 40
}

/**
 * The ray-marched density for one orbital. Same framing (98% radius) and the
 * same sign colours as the point cloud, so the toggle compares two renderings
 * of one function rather than two functions.
 */
function HydrogenCloud({ n, l, m, detail, cutaway, className }: BuildSpec) {
  const resolution = cloudResolution(detail)
  const volume = useMemo(() => hydrogenVolume({ n, l, m, resolution }), [n, l, m, resolution])
  const clip = useMemo(() => ({ axis: 'x' as const, offset: 0.5, enabled: cutaway }), [cutaway])
  const { shell, sub } = orbitalName(n, l, m)
  return (
    <VolumeRenderer
      volume={volume}
      colorMode="phase"
      threshold={0.02}
      opacity={1}
      clip={clip}
      minHeight={440}
      className={className}
      ariaLabel={`Probability density of the ${shell}${sub ? ` ${sub}` : ''} orbital, ray-marched as a translucent cloud of ${resolution} cubed voxels. Rose marks where the wavefunction is positive, sky where it is negative.`}
    />
  )
}

function HydrogenAtomPoints({
  model,
  n,
  l,
  m,
  detail,
  cutaway,
  className,
}: BuildSpec) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rebuildRef = useRef<((spec: BuildSpec) => void) | null>(null)
  const specRef = useRef<BuildSpec>({ model, n, l, m, detail, cutaway })
  specRef.current = { model, n, l, m, detail, cutaway }

  // ── One-time scene, camera, renderer, input and frame loop ────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reduceMotion = prefersReducedMotion()

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    const canvasEl = renderer.domElement
    canvasEl.style.display = 'block'
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    canvasEl.style.touchAction = 'none'
    container.appendChild(canvasEl)

    // Everything the current build owns, disposed before the next build.
    let disposables: { dispose(): void }[] = []
    let content: THREE.Group | null = null
    let labelCanvases: { canvas: HTMLCanvasElement; text: string; token: string }[] = []
    let labelTextures: THREE.Texture[] = []
    /** Set by the builder: advances the Bohr electron. Null in the cloud model. */
    let animate: ((elapsedMs: number) => void) | null = null
    /** Re-reads CSS tokens for the current build. */
    let recolor: (() => void) | null = null

    // Camera orbit state, in the viewer's hands and preserved across rebuilds.
    let azimuth = Math.PI * 0.35
    let polar = Math.PI * 0.34
    let zoom = 1
    /** World-space radius the camera frames; set per build. */
    let focus = 5

    const placeCamera = () => {
      const aspect = camera.aspect || 1
      const fit = aspect < 1 ? 1 / aspect : 1
      const dist = focus * 3.1 * zoom * fit
      camera.position.set(
        dist * Math.sin(polar) * Math.sin(azimuth),
        dist * Math.cos(polar),
        dist * Math.sin(polar) * Math.cos(azimuth)
      )
      camera.near = Math.max(0.001, dist / 500)
      camera.far = dist * 20
      camera.updateProjectionMatrix()
      camera.lookAt(0, 0, 0)
    }

    const renderOnce = () => renderer.render(scene, camera)

    // ── Frame loop: only the Bohr electron actually needs frames ─────────────
    const loop = createFrameLoop(
      window,
      document,
      domIntersectionWatcher(container),
      (now) => {
        if (animate) animate(now)
        renderOnce()
        // `animate` is null for the static cloud, and for the Bohr model under
        // prefers-reduced-motion, so the loop paints one frame and goes idle
        // instead of burning a WebGL frame on an unchanging picture.
        return animate !== null
      }
    )

    /** Ask for a frame. Gated by the loop's visibility/on-screen checks. */
    const kick = () => loop.start()

    // ── Builder ─────────────────────────────────────────────────────────────
    const clearContent = () => {
      if (content) {
        scene.remove(content)
        content = null
      }
      for (const d of disposables) d.dispose()
      disposables = []
      labelCanvases = []
      labelTextures = []
      animate = null
      recolor = null
    }

    const makeLabel = (text: string, token: string, fallback: string, scale: number) => {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      paintLabel(canvas, text, readVar(token, fallback))
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      })
      const sprite = new THREE.Sprite(material)
      sprite.scale.setScalar(scale)
      sprite.renderOrder = 20
      disposables.push(texture, material)
      labelCanvases.push({ canvas, text, token })
      labelTextures.push(texture)
      return sprite
    }

    const buildBohr = (spec: BuildSpec, group: THREE.Group) => {
      const orbitRadius = bohrRadiusOfOrbit(spec.n)
      focus = orbitRadius

      const dim = new THREE.LineBasicMaterial({
        color: new THREE.Color(readVar('--ink-muted', FALLBACK.inkMuted)),
        transparent: true,
        opacity: 0.35,
      })
      const bright = new THREE.LineBasicMaterial({
        color: new THREE.Color(readVar('--q-rose', FALLBACK.rose)),
        transparent: true,
        opacity: 0.95,
      })
      disposables.push(dim, bright)

      for (let k = 1; k <= 6; k++) {
        const geo = orbitGeometry(bohrRadiusOfOrbit(k))
        disposables.push(geo)
        group.add(new THREE.Line(geo, k === spec.n ? bright : dim))
        if (bohrRadiusOfOrbit(k) < orbitRadius * 3.2) {
          const label = makeLabel(
            `n=${k}`,
            k === spec.n ? '--q-rose-text' : '--ink-muted',
            k === spec.n ? '#f5a193' : FALLBACK.inkMuted,
            orbitRadius * 0.16
          )
          label.position.set(bohrRadiusOfOrbit(k) * 0.72, orbitRadius * 0.1, bohrRadiusOfOrbit(k) * 0.72)
          group.add(label)
        }
      }

      const nucleusGeo = new THREE.SphereGeometry(Math.max(orbitRadius * 0.035, 0.05), 20, 14)
      const nucleusMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(readVar('--q-amber', FALLBACK.amber)),
      })
      disposables.push(nucleusGeo, nucleusMat)
      group.add(new THREE.Mesh(nucleusGeo, nucleusMat))

      const electronGeo = new THREE.SphereGeometry(orbitRadius * 0.05, 20, 14)
      const electronMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(readVar('--q-sky', FALLBACK.sky)),
      })
      disposables.push(electronGeo, electronMat)
      const electron = new THREE.Mesh(electronGeo, electronMat)
      group.add(electron)

      // Bohr's own kinematics: v_n ∝ 1/n and r_n ∝ n², so the orbital PERIOD
      // goes as n³. The n = 1 electron laps the n = 6 electron 216 times.
      const omega = 1.6 / (spec.n * spec.n * spec.n)
      const setPhase = (angle: number) => {
        electron.position.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius)
      }
      setPhase(0)
      animate = reduceMotion
        ? null
        : (nowMs: number) => setPhase((nowMs / 1000) * omega * Math.PI * 2)

      recolor = () => {
        dim.color.set(readVar('--ink-muted', FALLBACK.inkMuted))
        bright.color.set(readVar('--q-rose', FALLBACK.rose))
        nucleusMat.color.set(readVar('--q-amber', FALLBACK.amber))
        electronMat.color.set(readVar('--q-sky', FALLBACK.sky))
      }
    }

    const buildCloud = (spec: BuildSpec, group: THREE.Group) => {
      const cloud = sampleOrbitalCloud(spec.n, spec.l, spec.m, spec.detail, 20240915)
      focus = cloud.extent

      const positive = new THREE.Color(readVar('--q-rose', FALLBACK.rose))
      const negative = new THREE.Color(readVar('--q-sky', FALLBACK.sky))

      // The cutaway drops the half of the samples nearest the default camera,
      // so the nodal shells inside a 3s or 4s orbital become visible instead of
      // being hidden behind their own outer shell.
      const keep: number[] = []
      for (let i = 0; i < cloud.count; i++) {
        if (spec.cutaway && cloud.positions[i * 3] > 0) continue
        keep.push(i)
      }
      const positions = new Float32Array(keep.length * 3)
      const colors = new Float32Array(keep.length * 3)
      keep.forEach((src, dst) => {
        positions[dst * 3] = cloud.positions[src * 3]
        positions[dst * 3 + 1] = cloud.positions[src * 3 + 2] // z_physics → y_three (up)
        // y_physics → −z_three: the same house convention as physicsToThree()
        // in volumeLayout.ts / toThree() in blochFrame.ts (physics (x,y,z) →
        // three (x, z, −y), a proper rotation). Without the sign this is a
        // mirror-image embedding instead of a rotation; for most real orbitals
        // that is not by itself visible (no drawn x/y axes, no phase colour to
        // reveal handedness), but this same (n, l, m) can also be drawn by
        // HydrogenCloud below via VolumeRenderer/volumeLayout.ts, which DOES
        // apply the sign — leaving it off here would make the 'points' and
        // 'cloud' render modes disagree on where the sin(mφ)-type real
        // orbitals' lobes fall (p_y, d_xy, d_yz, …), which is observable by
        // toggling the `render` prop between them.
        positions[dst * 3 + 2] = -cloud.positions[src * 3 + 1]
        const c = cloud.signs[src] >= 0 ? positive : negative
        colors[dst * 3] = c.r
        colors[dst * 3 + 1] = c.g
        colors[dst * 3 + 2] = c.b
      })

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const mat = new THREE.PointsMaterial({
        size: Math.max(cloud.extent * 0.011, 0.012),
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        // Low per-point alpha with depthWrite off: density on screen then reads
        // as accumulated probability rather than as whichever dot won the depth
        // test, which is the whole point of drawing |ψ|² this way.
        opacity: 0.45,
        depthWrite: false,
      })
      disposables.push(geo, mat)
      group.add(new THREE.Points(geo, mat))

      const nucleusGeo = new THREE.SphereGeometry(cloud.extent * 0.012, 16, 12)
      const nucleusMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(readVar('--q-amber', FALLBACK.amber)),
      })
      disposables.push(nucleusGeo, nucleusMat)
      group.add(new THREE.Mesh(nucleusGeo, nucleusMat))

      // A faint ring at ⟨r⟩ — the same number the controls report, so the
      // abstract expectation value has somewhere to land on screen.
      const meanGeo = orbitGeometry(expectedRadius(spec.n, spec.l))
      const meanMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(readVar('--ink-muted', FALLBACK.inkMuted)),
        transparent: true,
        opacity: 0.4,
      })
      disposables.push(meanGeo, meanMat)
      group.add(new THREE.Line(meanGeo, meanMat))

      const axisMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(readVar('--ink-muted', FALLBACK.inkMuted)),
        transparent: true,
        opacity: 0.3,
      })
      disposables.push(axisMat)
      const zAxisGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -cloud.extent * 1.25, 0),
        new THREE.Vector3(0, cloud.extent * 1.25, 0),
      ])
      disposables.push(zAxisGeo)
      group.add(new THREE.Line(zAxisGeo, axisMat))

      const zLabel = makeLabel('z', '--ink-muted', FALLBACK.inkMuted, cloud.extent * 0.13)
      zLabel.position.set(0, cloud.extent * 1.38, 0)
      group.add(zLabel)

      recolor = () => {
        const p = new THREE.Color(readVar('--q-rose', FALLBACK.rose))
        const q = new THREE.Color(readVar('--q-sky', FALLBACK.sky))
        for (let i = 0; i < keep.length; i++) {
          const c = cloud.signs[keep[i]] >= 0 ? p : q
          colors[i * 3] = c.r
          colors[i * 3 + 1] = c.g
          colors[i * 3 + 2] = c.b
        }
        geo.getAttribute('color').needsUpdate = true
        nucleusMat.color.set(readVar('--q-amber', FALLBACK.amber))
        meanMat.color.set(readVar('--ink-muted', FALLBACK.inkMuted))
        axisMat.color.set(readVar('--ink-muted', FALLBACK.inkMuted))
      }
    }

    const rebuild = (spec: BuildSpec) => {
      clearContent()
      const group = new THREE.Group()
      if (spec.model === 'bohr') buildBohr(spec, group)
      else buildCloud(spec, group)
      content = group
      scene.add(group)
      placeCamera()
      loop.stop()
      kick()
    }
    rebuildRef.current = rebuild

    // ── Theme ───────────────────────────────────────────────────────────────
    const themeObserver = new MutationObserver(() => {
      recolor?.()
      for (const { canvas, text, token } of labelCanvases) {
        paintLabel(canvas, text, readVar(token, FALLBACK.ink))
      }
      for (const t of labelTextures) t.needsUpdate = true
      kick()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    // ── Pointer + keyboard orbit ────────────────────────────────────────────
    let dragging = false
    let lastX = 0
    let lastY = 0

    const orbitBy = (dAz: number, dPolar: number) => {
      azimuth -= dAz
      polar = Math.min(Math.PI - 0.06, Math.max(0.06, polar - dPolar))
      placeCamera()
      kick()
    }
    const zoomBy = (factor: number) => {
      zoom = Math.min(3.5, Math.max(0.3, zoom * factor))
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
    // A11Y: the view is a real control, so it is reachable by Tab and driven by
    // the arrow keys. Without this the 3D scene is mouse-only.
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

    // ── Sizing ──────────────────────────────────────────────────────────────
    const resize = () => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
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
      themeObserver.disconnect()
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

  // ── Rebuild when the state on show changes ────────────────────────────────
  useEffect(() => {
    rebuildRef.current?.({ model, n, l, m, detail, cutaway })
  }, [model, n, l, m, detail, cutaway])

  const { shell, sub } = orbitalName(n, l, m)
  const description =
    model === 'bohr'
      ? `Bohr model of hydrogen. The electron orbits at radius ${n * n} Bohr radii on the n equals ${n} orbit; all six allowed orbits are drawn.`
      : `Probability cloud of the ${shell}${sub ? ` ${sub}` : ''} orbital, ${detail.toLocaleString('en-US')} points sampled from the square of the wavefunction. Rose marks where the wavefunction is positive, sky where it is negative.`

  return (
    <div
      ref={containerRef}
      role="img"
      tabIndex={0}
      aria-label={`${description} Drag or use the arrow keys to rotate the view; scroll or press plus and minus to zoom.`}
      className={`focus-ring w-full min-h-[440px] rounded-lg ${className ?? ''}`}
    />
  )
}

export default HydrogenAtom
