'use client'

/**
 * QSphere — the whole-state companion to PhaseDiskStrip, IBM Composer style.
 *
 * One sphere for the full statevector: basis states sit on latitude rings by
 * Hamming weight (|0...0⟩ north pole, |1...1⟩ south), node radius ∝ |amplitude|,
 * node hue = amplitude phase on a perceptually-even OKLCH wheel, and a thin
 * meridian ray connects each non-zero node to the centre. All positions and
 * the phase→hue mapping come from lib/qsphere-layout.ts (pure math, tested
 * there); this file only projects and draws.
 *
 * SVG first, three.js as a progressive upgrade — same shape as
 * components/ui/HeroQubit.tsx + heroQubitScene.ts. The SVG below paints
 * immediately (it is ~32 dots and lines, effectively free) and stays the
 * interactive surface: it keeps the pointer/keyboard handlers and the
 * role="img" aria-label, so nothing about drag-to-rotate or a screen reader's
 * experience changes. A few hundred ms after mount, if WebGL is available,
 * components/circuit/qsphereScene.ts loads in its own chunk, renders the same
 * nodes with real perspective, lighting and depth underneath, and the SVG
 * goes transparent (but keeps receiving events) so the two never disagree —
 * one is drawing, the other is still what a keyboard or screen-reader user
 * operates. Failure of any kind (no WebGL, import fails) leaves the flat SVG
 * in place; nobody sees a blank box. Rotation is a simple yaw/pitch
 * orthographic projection for the SVG, orthographic so equal magnitudes stay
 * equal radii anywhere on the sphere; the WebGL layer uses the same yaw/pitch
 * with a real perspective camera, matching heroQubitScene's orbit formula so
 * a drag feels identical whichever layer is on top.
 *
 * Structural colours (outline, rays, labels) resolve from CSS custom
 * properties at runtime and repaint on theme change — per ADR-0007, using the
 * shared components/viz/theme.ts reader like PhaseDiskStrip does. Node hue is
 * NOT a theme token: it encodes phase, and a phase wheel that changed between
 * themes would change the data's meaning. See the note in qsphere-layout.ts.
 *
 * Above QSPHERE_MAX_QUBITS the sphere renders a plain-language note instead:
 * an equatorial ring of C(6,3) = 20 overlapping nodes at this size is a wrong-
 * looking widget, and that teaches worse than none (same call as the phase
 * disks' cutoff).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { readVizColors, withAlpha, type VizColors } from '@/components/viz/theme'
import { formatKet, type StateVector } from '@/lib/quantum'
import {
  QSPHERE_EPS,
  QSPHERE_MAX_QUBITS,
  phaseColor,
  qsphereNodes,
  rotateProject,
} from '@/lib/qsphere-layout'

const SIZE = 280
const CX = SIZE / 2
/** Sphere radius; leaves room for the largest node at the rim. */
const R = SIZE / 2 - 24
/** Node radius at |amplitude| = 1. */
const MAX_NODE_R = 13
/** Keyboard rotation step per arrow press, radians. */
const KEY_STEP = Math.PI / 24

const fmtPhase = (phase: number) => `${(phase / Math.PI).toFixed(2)}π`

export default function QSphere({ state }: { state: StateVector }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<import('./qsphereScene').QSphereSceneHandle | null>(null)
  const [colors, setColors] = useState<VizColors | null>(null)
  const [gl, setGl] = useState(false)
  // Slight initial pitch so both poles are visible instead of edge-on rings.
  const [rot, setRot] = useState({ yaw: 0.5, pitch: -0.35 })
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null)

  // ADR-0007: resolve tokens off a mounted element, re-resolve when the theme
  // class on <html> flips — SVG attributes set from JS do not follow CSS.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    setColors(readVizColors(el))
    const observer = new MutationObserver(() => setColors(readVizColors(el)))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const nodes = useMemo(
    () => (state.numQubits <= QSPHERE_MAX_QUBITS ? qsphereNodes(state) : []),
    [state]
  )

  const label = useMemo(() => {
    if (state.numQubits > QSPHERE_MAX_QUBITS) return ''
    const top = [...nodes]
      .filter((n) => n.probability >= QSPHERE_EPS)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 3)
      .map(
        (n) =>
          `${formatKet(n.index, state.numQubits)} ${(n.probability * 100).toFixed(1)}% at phase ${fmtPhase(n.phase)}`
      )
    return `Q-sphere of a ${state.numQubits}-qubit state. Largest components: ${top.join(', ')}. Drag or use arrow keys to rotate.`
  }, [nodes, state])

  // ── Progressive upgrade to WebGL. Runs once colours are known; a probe
  // context confirms WebGL is actually available before the chunk loads, so a
  // browser without it never pays for three.js. See the file header.
  useEffect(() => {
    if (!colors || state.numQubits > QSPHERE_MAX_QUBITS) return
    const glc = glCanvasRef.current
    const box = boxRef.current
    if (!glc || !box) return
    let disposed = false
    const probe = document.createElement('canvas')
    const hasGl = Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
    if (!hasGl) return

    const timer = window.setTimeout(async () => {
      try {
        const mod = await import('./qsphereScene')
        if (disposed) return
        const scene = mod.mountQSphereScene(glc, {
          violet: colors.violet,
          ink: colors.ink,
          inkMuted: colors.inkMuted,
          line: colors.lineStrong,
        })
        if (!scene || disposed) {
          scene?.dispose()
          return
        }
        const size = box.clientWidth || SIZE
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        glc.width = Math.round(size * dpr)
        glc.height = Math.round(size * dpr)
        glc.style.width = `${size}px`
        glc.style.height = `${size}px`
        scene.resize(glc.width)
        sceneRef.current = scene
        setGl(true)
      } catch {
        // Keep the SVG. Nothing to clean up — mountQSphereScene never partially
        // constructed anything visible before throwing.
      }
    }, 32)

    return () => {
      disposed = true
      window.clearTimeout(timer)
      sceneRef.current?.dispose()
      sceneRef.current = null
      setGl(false)
    }
    // Rebuild on a colour change (theme flip): the GL materials bake colours
    // in, same as heroQubitScene. `nodes` is deliberately excluded — that is
    // handled by the render effect below without a full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, state.numQubits])

  // Repaint the GL layer whenever the drag angle or the statevector changes.
  // No animation loop: nothing here moves on its own, only in response to a
  // pointer drag (which already calls setRot) or a new gate having run.
  useEffect(() => {
    if (!gl) return
    sceneRef.current?.render({ nodes, yaw: rot.yaw, pitch: rot.pitch })
  }, [gl, nodes, rot])

  if (state.numQubits > QSPHERE_MAX_QUBITS) {
    return (
      <p className="rounded-lg border border-line px-3 py-4 text-center text-xs text-ink-muted">
        The Q-sphere is legible up to {QSPHERE_MAX_QUBITS} qubits — at {state.numQubits} qubits its
        rings overlap into noise. The amplitude list stays exact at any size.
      </p>
    )
  }

  // SSR / pre-effect fallbacks are the dark-theme values, per theme.ts.
  const ink = colors?.inkSecondary ?? '#8fa3c8'
  const line = colors?.lineStrong ?? 'rgba(255, 255, 255, 0.13)'
  const violet = colors?.violet ?? '#a99dff'

  // Project every node, then paint far-side first so near nodes overdraw.
  const projected = nodes
    .map((n) => ({ n, p: rotateProject(n, rot.yaw, rot.pitch) }))
    .sort((a, b) => b.p.depth - a.p.depth)

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const k = Math.PI / SIZE // full width of drag ≈ half a turn
    setRot((r) => ({ yaw: r.yaw + (e.clientX - d.x) * k, pitch: r.pitch + (e.clientY - d.y) * k }))
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null
  }
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    }
    const s = step[e.key]
    if (!s) return
    e.preventDefault()
    setRot((r) => ({ yaw: r.yaw + s[0], pitch: r.pitch + s[1] }))
  }

  return (
    <div ref={rootRef} className="flex flex-col items-center">
      {/* GL layer underneath, same relationship as HeroQubit + heroQubitScene:
          the SVG on top keeps every pointer/keyboard handler and its
          role="img" label, and just goes transparent once GL is live so the
          perspective picture shows through where the flat one used to be. */}
      <div ref={boxRef} className="relative" style={{ width: SIZE, height: SIZE, maxWidth: '100%', aspectRatio: '1 / 1' }}>
        <canvas ref={glCanvasRef} aria-hidden="true" className="absolute inset-0 block h-full w-full" />
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={label}
          tabIndex={0}
          className={`relative block max-w-full cursor-grab touch-none rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:cursor-grabbing ${gl ? 'opacity-0' : ''}`}
          style={{ outlineColor: violet }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <title>{label}</title>
        {/* sphere silhouette + faint ground */}
        <circle cx={CX} cy={CX} r={R} fill={withAlpha(violet, 0.05)} stroke={line} strokeWidth={1} />
        {projected.map(({ n, p }) => {
          if (n.magnitude < QSPHERE_EPS) {
            // Empty basis state: a bare pinprick keeps the lattice readable
            // without pretending amplitude is there.
            return (
              <circle
                key={n.index}
                cx={CX + p.sx * R}
                cy={CX + p.sy * R}
                r={1}
                fill={ink}
                opacity={p.depth > 0 ? 0.25 : 0.5}
              />
            )
          }
          const x = CX + p.sx * R
          const y = CX + p.sy * R
          const far = p.depth > 0
          const hue = phaseColor(n.phase)
          return (
            <g key={n.index} opacity={far ? 0.45 : 1}>
              {/* thin connecting meridian: centre → node */}
              <line x1={CX} y1={CX} x2={x} y2={y} stroke={ink} strokeWidth={0.75} opacity={0.6} />
              <circle
                cx={x}
                cy={y}
                r={Math.max(2, MAX_NODE_R * n.magnitude)}
                fill={hue}
                stroke={line}
                strokeWidth={1}
              >
                <title>
                  {`${formatKet(n.index, state.numQubits)}: |a| ${n.magnitude.toFixed(3)}, phase ${fmtPhase(n.phase)}`}
                </title>
              </circle>
            </g>
          )
        })}
        {/* pole markers, drawn last so they stay findable mid-drag */}
        {(
          [
            { z: 1, text: formatKet(0, state.numQubits) },
            { z: -1, text: formatKet(state.dim - 1, state.numQubits) },
          ] as const
        ).map(({ z, text }) => {
          const p = rotateProject({ x: 0, y: 0, z }, rot.yaw, rot.pitch)
          return (
            <text
              key={z}
              x={CX + p.sx * (R + 12)}
              y={CX + p.sy * (R + 12)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={ink}
              fontSize={10}
              fontFamily="monospace"
              opacity={p.depth > 0 ? 0.5 : 1}
              aria-hidden="true"
            >
              {text}
            </text>
          )
        })}
        </svg>
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        Each dot is one basis state — rings by number of 1s, dot size is the amplitude&apos;s
        magnitude, colour is its phase. Drag or use arrow keys to rotate.
      </p>
    </div>
  )
}
