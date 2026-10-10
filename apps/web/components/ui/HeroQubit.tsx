'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BLOCH_GATES, normalize, probabilityOfOne, rotate, type Vec3 } from '@/lib/viz/blochGates'

/**
 * HeroQubit — a real qubit on the home page, above the fold, in 3D.
 *
 * WHY IT EXISTS (the psychology, briefly): the headline promises "learn by
 * playing with it" and the old hero offered nothing to play with — two
 * buttons and a paragraph. The strongest predictor of a first-time visitor
 * continuing is touching the product inside the first few seconds, before
 * any decision to commit (Brilliant built a company on this). So the hero
 * now IS the product: a Bloch sphere you can spin, four gates you can apply,
 * and a measurement whose outcome is genuinely random. Each gate press pays
 * off a small curiosity gap ("what does H do?" → the arrow swings to the
 * equator and the odds go 100/0 → 50/50), which is the exact first lesson of
 * the course, taught by the visitor's own hand.
 *
 * WHY NO three.js: the /visualizations/bloch-sphere page uses it, but the
 * home route's First Load JS budget is the shared chunk alone (105.5 kB) and
 * three would add ~150 kB gzipped to the single page whose LCP matters most.
 * A sphere is three great circles and an arrow; orthographic projection of
 * ~200 points onto a 2D canvas is a few hundred lines and a few kB.
 *
 * WHAT IS REAL: the state is a unit Bloch vector; gates are the actual
 * rotations (X, Z, Y: π about their axis; H: π about (x+z)/√2; S: π/2 about
 * z), animated along the true arc via Rodrigues' formula; P(1) = (1 − z)/2
 * and Measure samples it. Nothing here is a canned animation.
 *
 * ACCESSIBILITY / MOTION: the canvas is role="img" with a live description;
 * every interaction has a real <button>; drag-to-orbit is a bonus, not the
 * only way in. The idle orbit stops under prefers-reduced-motion and after
 * the visitor has taken control. Colours are read from the theme's custom
 * properties at runtime, the same way GroverLab does, so it follows the
 * light/dark toggle.
 */

interface Gate {
  id: 'H' | 'X' | 'Z' | 'S'
  label: string
  axis: Vec3
  angle: number
  /** One sentence the visitor reads after pressing it. */
  says: string
}

const gate = (id: Gate['id'], says: string): Gate => ({
  id,
  label: id,
  axis: BLOCH_GATES[id].axis,
  angle: BLOCH_GATES[id].angle,
  says,
})

const GATES: readonly Gate[] = [
  gate('H', 'Hadamard: half a turn about a tilted axis. A pole becomes the equator — certainty becomes a coin flip.'),
  gate('X', 'X is the quantum NOT: half a turn about the x-axis swaps |0⟩ and |1⟩. On the equator it barely shows — watch the phase, not the odds.'),
  gate('Z', 'Z spins the arrow half a turn around the vertical. The odds do not change at all — only the phase did. That is the part with no classical analogue.'),
  gate('S', 'S is a quarter turn of phase. Two of them make a Z. Phase is invisible to a single measurement and decisive for interference.'),
]

const IDLE_SAYS = 'This is one qubit. The arrow is its state. Press a gate — every move is the real rotation, not an animation.'

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

const FALLBACK = {
  violet: '#a99dff',
  teal: '#4edbca',
  amber: '#f2a96a',
  ink: '#eef2ff',
  inkMuted: '#7d8cb0',
  line: 'rgba(255,255,255,0.13)',
}

function readColors(el: HTMLElement) {
  const css = getComputedStyle(el)
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    violet: get('--q-violet', FALLBACK.violet),
    teal: get('--q-teal', FALLBACK.teal),
    amber: get('--q-amber', FALLBACK.amber),
    ink: get('--ink', FALLBACK.ink),
    inkMuted: get('--ink-muted', FALLBACK.inkMuted),
    line: get('--line-strong', FALLBACK.line),
    /*
     * The five hues alone do not tell the WebGL scene how to LIGHT itself —
     * see SceneColors.mode in heroQubitScene.ts. ThemeScript always writes an
     * explicit .light or .dark onto <html> before first paint, so reading the
     * class is exact rather than a guess, and the MutationObserver below
     * already rebuilds the scene whenever that class changes.
     */
    mode: (document.documentElement.classList.contains('light') ? 'light' : 'dark') as 'light' | 'dark',
    /*
     * The 2D fallback's glow was hardcoded rgba(124,106,249,·) — the DARK
     * theme's violet — so on the light theme it painted a dark-violet haze
     * that belonged to the other palette. Derived from the live token instead.
     */
    glow: get('--q-violet-rgb', '124 106 249'),
  }
}

type Anim =
  | { kind: 'gate'; from: Vec3; axis: Vec3; angle: number; start: number; ms: number }
  | { kind: 'collapse'; from: Vec3; to: Vec3; start: number; ms: number }
  | null

const CIRCLE_STEPS = 72

export default function HeroQubit() {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<import('./heroQubitScene').HeroScene | null>(null)
  const zeroLabelRef = useRef<HTMLSpanElement | null>(null)
  const oneLabelRef = useRef<HTMLSpanElement | null>(null)
  const [gl, setGl] = useState(false)

  // Mutable simulation state lives in refs: the draw loop reads it every
  // frame and React must not re-render 60 times a second.
  const stateRef = useRef<Vec3>([0, 0, 1]) // |0⟩: north pole
  const animRef = useRef<Anim>(null)
  const viewRef = useRef({ yaw: -0.6, pitch: 0.42, idle: true })
  /** When the visitor last interacted; the slow orbit resumes a few seconds later. */
  const lastTouchRef = useRef(0)
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  const rafRef = useRef<number | null>(null)
  const reduceMotionRef = useRef(false)

  // The few things the DOM needs: the caption and the live odds.
  const [says, setSays] = useState(IDLE_SAYS)
  const [odds, setOdds] = useState<{ p0: number; p1: number }>({ p0: 1, p1: 0 })
  const [touched, setTouched] = useState(false)
  const [lastOutcome, setLastOutcome] = useState<0 | 1 | null>(null)

  const publishOdds = useCallback((v: Vec3) => {
    const p1 = probabilityOfOne(v)
    setOdds({ p0: 1 - p1, p1 })
  }, [])

  const applyGate = useCallback(
    (gate: Gate) => {
      // Resolve any in-flight animation to its end state first so rapid
      // presses compose correctly instead of interrupting each other.
      const a = animRef.current
      if (a?.kind === 'gate') stateRef.current = rotate(a.from, a.axis, a.angle)
      if (a?.kind === 'collapse') stateRef.current = a.to
      animRef.current = {
        kind: 'gate',
        from: stateRef.current,
        axis: gate.axis,
        angle: gate.angle,
        start: performance.now(),
        ms: reduceMotionRef.current ? 0 : 650,
      }
      const end = rotate(stateRef.current, gate.axis, gate.angle)
      publishOdds(end)
      setSays(gate.says)
      setLastOutcome(null)
      setTouched(true)
      viewRef.current.idle = false
      lastTouchRef.current = performance.now()
    },
    [publishOdds],
  )

  const measure = useCallback(() => {
    const a = animRef.current
    if (a?.kind === 'gate') stateRef.current = rotate(a.from, a.axis, a.angle)
    if (a?.kind === 'collapse') stateRef.current = a.to
    const v = stateRef.current
    const p1 = probabilityOfOne(v)
    const outcome: 0 | 1 = Math.random() < p1 ? 1 : 0
    const to: Vec3 = outcome === 1 ? [0, 0, -1] : [0, 0, 1]
    animRef.current = {
      kind: 'collapse',
      from: v,
      to,
      start: performance.now(),
      ms: reduceMotionRef.current ? 0 : 260,
    }
    publishOdds(to)
    setLastOutcome(outcome)
    setSays(
      p1 > 0.01 && p1 < 0.99
        ? `Measured ${outcome}. The state had P(1) = ${(p1 * 100).toFixed(0)}% and has now collapsed to |${outcome}⟩. Press Measure again from here and you will get ${outcome} every time — the superposition is gone.`
        : `Measured ${outcome}, as it had to. A state at a pole is not a superposition; only a gate can make it one again.`,
    )
    setTouched(true)
    viewRef.current.idle = false
    lastTouchRef.current = performance.now()
  }, [publishOdds])

  const reset = useCallback(() => {
    animRef.current = null
    stateRef.current = [0, 0, 1]
    publishOdds([0, 0, 1])
    setSays(IDLE_SAYS)
    setLastOutcome(null)
  }, [publishOdds])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    reduceMotionRef.current =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let colors = readColors(wrap)
    let size = 0
    let lastT = 0
    let visible = true

    // Pre-compute the three great circles in Bloch space: equator, and the
    // x–z and y–z meridians. Rotating 216 points per frame is nothing.
    const circles: Vec3[][] = [[], [], []]
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const t = (i / CIRCLE_STEPS) * Math.PI * 2
      circles[0].push([Math.cos(t), Math.sin(t), 0])
      circles[1].push([Math.cos(t), 0, Math.sin(t)])
      circles[2].push([0, Math.cos(t), Math.sin(t)])
    }

    /** Bloch (x, y, z-up) → screen. Returns [sx, sy, depth]; depth > 0 is away. */
    const project = (v: Vec3, r: number, cx: number, cy: number): Vec3 => {
      const { yaw, pitch } = viewRef.current
      // yaw about the vertical axis
      const x1 = v[0] * Math.cos(yaw) - v[1] * Math.sin(yaw)
      const y1 = v[0] * Math.sin(yaw) + v[1] * Math.cos(yaw)
      const z1 = v[2]
      // pitch: tilt the top toward the viewer
      const y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch)
      const z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch)
      return [cx + x1 * r, cy - z2 * r, y2]
    }

    const strokeCircle = (pts: Vec3[], r: number, cx: number, cy: number, color: string) => {
      // Two passes: the back half faint, the front half solid, so the sphere
      // reads as a volume instead of a wireframe soup.
      for (const front of [false, true]) {
        ctx.beginPath()
        let pen = false
        for (const p of pts) {
          const [sx, sy, d] = project(p, r, cx, cy)
          const isFront = d <= 0
          if (isFront !== front) {
            pen = false
            continue
          }
          if (!pen) {
            ctx.moveTo(sx, sy)
            pen = true
          } else ctx.lineTo(sx, sy)
        }
        ctx.strokeStyle = color
        ctx.globalAlpha = front ? 0.9 : 0.28
        ctx.lineWidth = front ? 1.25 : 1
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    const currentState = (now: number): Vec3 => {
      const a = animRef.current
      if (!a) return stateRef.current
      const t = a.ms === 0 ? 1 : Math.min(1, (now - a.start) / a.ms)
      const e = easeInOut(t)
      let v: Vec3
      if (a.kind === 'gate') v = rotate(a.from, a.axis, a.angle * e)
      else
        v = normalize([
          a.from[0] + (a.to[0] - a.from[0]) * e,
          a.from[1] + (a.to[1] - a.from[1]) * e,
          a.from[2] + (a.to[2] - a.from[2]) * e,
        ])
      if (t >= 1) {
        stateRef.current = a.kind === 'gate' ? rotate(a.from, a.axis, a.angle) : a.to
        animRef.current = null
      }
      return v
    }

    const draw = (now: number) => {
      rafRef.current = null
      if (size <= 0) return
      const dt = lastT ? Math.min(now - lastT, 100) : 16
      lastT = now

      // The slow orbit: on until the visitor takes control, and back on
      // ~4s after they let go, so the sphere is never a still picture.
      if (!viewRef.current.idle && !dragRef.current && now - lastTouchRef.current > 4000) {
        viewRef.current.idle = true
      }
      if (viewRef.current.idle && !reduceMotionRef.current) {
        viewRef.current.yaw += dt * 0.00018
      }

      // WebGL path, once the scene has loaded: same state, same view, drawn
      // with lights and glass. The 2D code below is then skipped entirely.
      const glScene = sceneRef.current
      if (glScene) {
        const v = currentState(now)
        glScene.render({ state: v, yaw: viewRef.current.yaw, pitch: viewRef.current.pitch })
        const { zero, one } = glScene.poles()
        const z = zeroLabelRef.current
        const o = oneLabelRef.current
        if (z) z.style.transform = `translate(calc(${zero[0]}px - 50%), calc(${zero[1]}px - 50%))`
        if (o) o.style.transform = `translate(calc(${one[0]}px - 50%), calc(${one[1]}px - 50%))`
        if (visible && (animRef.current || (viewRef.current.idle && !reduceMotionRef.current) || dragRef.current)) {
          rafRef.current = requestAnimationFrame(draw)
        } else {
          lastT = 0
        }
        return
      }

      const cx = size / 2
      const cy = size / 2
      const r = size * 0.36
      ctx.clearRect(0, 0, size, size)

      // Soft glow behind the sphere: the one purely decorative stroke.
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.5)
      g.addColorStop(0, `rgb(${colors.glow} / 0.20)`)
      g.addColorStop(1, `rgb(${colors.glow} / 0)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)

      // Silhouette
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = colors.line
      ctx.lineWidth = 1
      ctx.stroke()

      strokeCircle(circles[0], r, cx, cy, colors.teal)
      strokeCircle(circles[1], r, cx, cy, colors.inkMuted)
      strokeCircle(circles[2], r, cx, cy, colors.inkMuted)

      // Poles
      ctx.font = `600 ${Math.max(11, size * 0.05)}px ui-sans-serif, system-ui, sans-serif`
      ctx.fillStyle = colors.ink
      ctx.textAlign = 'center'
      const [nx, ny] = project([0, 0, 1], r, cx, cy)
      const [sx, sy] = project([0, 0, -1], r, cx, cy)
      ctx.textBaseline = 'bottom'
      ctx.fillText('|0⟩', nx, ny - 8)
      ctx.textBaseline = 'top'
      ctx.fillText('|1⟩', sx, sy + 8)

      // State vector
      const v = currentState(now)
      const [tx, ty, td] = project(v, r, cx, cy)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(tx, ty)
      ctx.strokeStyle = colors.violet
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.globalAlpha = td > 0 ? 0.55 : 1
      ctx.stroke()
      // Tip
      ctx.beginPath()
      ctx.arc(tx, ty, Math.max(5, size * 0.022), 0, Math.PI * 2)
      ctx.fillStyle = colors.amber
      ctx.fill()
      ctx.globalAlpha = 1
      // Drop line to the equator plane: makes the latitude (the odds) legible.
      const [fx, fy] = project([v[0], v[1], 0], r, cx, cy)
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(fx, fy)
      ctx.strokeStyle = colors.amber
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.6
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      if (visible && (animRef.current || (viewRef.current.idle && !reduceMotionRef.current) || dragRef.current)) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        lastT = 0
      }
    }

    const kick = () => {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(draw)
    }
    ;(wrap as HTMLDivElement & { __kick?: () => void }).__kick = kick

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      size = Math.max(1, Math.round(Math.min(rect.width, rect.height)))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(size * dpr)
      canvas.height = Math.round(size * dpr)
      canvas.style.width = `${size}px`
      canvas.style.height = `${size}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const glc = glCanvasRef.current
      if (glc) {
        glc.style.width = `${size}px`
        glc.style.height = `${size}px`
      }
      sceneRef.current?.resize(size)
      kick()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting)
            if (visible) kick()
          })
        : null
    io?.observe(wrap)

    // ── Progressive upgrade to WebGL. The 2D sphere has already painted;
    // three.js loads in a separate chunk once the browser is idle, and only
    // if WebGL is actually available. Failure of any kind leaves the 2D
    // version in place — nobody sees a blank box.
    let disposed = false
    const mountGl = async () => {
      const glc = glCanvasRef.current
      if (!glc || disposed) return
      const probe = document.createElement('canvas')
      const hasGl = Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
      if (!hasGl) return
      try {
        const mod = await import('./heroQubitScene')
        if (disposed) return
        const scene = mod.mountHeroScene(glc, colors)
        if (!scene) return
        scene.resize(size)
        sceneRef.current = scene
        setGl(true)
        kick()
      } catch {
        // Keep the 2D renderer.
      }
    }
    // Upgrade right after the first 2D frame has painted — two animation
    // frames in — rather than waiting for idle: the 2D frame protects LCP,
    // and nothing else on the page needs the main thread more than this.
    const hasIdle = false as boolean
    const idleHandle = window.setTimeout(() => void mountGl(), 32)

    const mo =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            colors = readColors(wrap)
            // The GL scene bakes colours into materials: rebuild it.
            if (sceneRef.current) {
              sceneRef.current.dispose()
              sceneRef.current = null
              setGl(false)
              void mountGl()
            }
            kick()
          })
        : null
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    // Drag to orbit. Pointer events cover mouse, pen and touch.
    const onDown = (e: PointerEvent) => {
      dragRef.current = { x: e.clientX, y: e.clientY, yaw: viewRef.current.yaw, pitch: viewRef.current.pitch }
      viewRef.current.idle = false
      canvas.setPointerCapture(e.pointerId)
      kick()
    }
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      viewRef.current.yaw = d.yaw + (e.clientX - d.x) * 0.01
      viewRef.current.pitch = Math.max(-1.2, Math.min(1.2, d.pitch + (e.clientY - d.y) * 0.01))
      kick()
    }
    const onUp = (e: PointerEvent) => {
      dragRef.current = null
      lastTouchRef.current = performance.now()
      kick()
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)

    return () => {
      ro.disconnect()
      io?.disconnect()
      mo?.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      /**
       * Resetting the ref to null is load-bearing, not tidiness. `kick()` is
       * guarded by `rafRef.current === null` so that a burst of state changes
       * cannot schedule several concurrent loops. If cleanup cancels the frame
       * but leaves the stale id in the ref, that guard is permanently true for
       * the NEXT mount and kick() becomes a silent no-op forever: the loop
       * never starts, render() is never called, the pole labels never get a
       * transform, and — because `gl` is still set to true — the 2D fallback
       * is held at opacity-0 on top of a never-painted WebGL canvas. The hero
       * renders as an empty box. React StrictMode's mount/cleanup/mount made
       * that the guaranteed outcome in development, and any remount (a
       * client-side navigation back to the home route) reproduced it in
       * production.
       */
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      disposed = true
      if (hasIdle) window.cancelIdleCallback(idleHandle)
      else window.clearTimeout(idleHandle)
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [])

  // Any state change from a button must wake the frame loop.
  useEffect(() => {
    const w = wrapRef.current as (HTMLDivElement & { __kick?: () => void }) | null
    w?.__kick?.()
  }, [says, odds, lastOutcome])

  const pct = (p: number) => `${Math.round(p * 100)}%`

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div
        ref={wrapRef}
        className="relative aspect-square w-full max-w-[340px] touch-none select-none"
      >
        {/* WebGL layer underneath; the 2D canvas above it goes transparent once
            GL is live but keeps receiving the pointer events, so drag-to-orbit
            is one code path. */}
        <canvas ref={glCanvasRef} aria-hidden="true" className="absolute inset-0 block" />
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`A qubit on the Bloch sphere. Probability of reading 0: ${pct(odds.p0)}; of reading 1: ${pct(odds.p1)}. ${says}`}
          className={`relative block cursor-grab active:cursor-grabbing ${gl ? 'opacity-0' : ''}`}
        />
        {gl ? (
          <>
            <span ref={zeroLabelRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 font-semibold text-ink will-change-transform">
              |0⟩
            </span>
            <span ref={oneLabelRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 font-semibold text-ink will-change-transform">
              |1⟩
            </span>
          </>
        ) : null}
        {!touched ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-surface/80 px-2.5 py-0.5 text-[11px] text-ink-muted backdrop-blur"
          >
            drag to spin · press a gate
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Apply a gate to the qubit">
        {GATES.map((g, i) => (
          <button
            key={g.id}
            type="button"
            onClick={() => applyGate(g)}
            className={`focus-ring relative h-10 w-10 rounded-lg border font-mono text-base font-bold transition-colors ${
              !touched && i === 0
                ? 'border-q-violet bg-q-violet/20 text-q-violet-text hero-pulse'
                : 'border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3'
            }`}
            aria-label={`Apply ${g.id} gate`}
          >
            {g.label}
          </button>
        ))}
        <button
          type="button"
          onClick={measure}
          className="focus-ring h-10 rounded-lg border border-q-amber/40 bg-q-amber/15 px-3 text-sm font-semibold text-q-amber-text transition-colors hover:bg-q-amber/25"
        >
          Measure
        </button>
      </div>

      <div className="w-full max-w-[380px] text-center">
        <p className="font-mono text-sm tabular-nums text-ink">
          <span className="text-q-teal-text">P(0) {pct(odds.p0)}</span>
          <span className="mx-2 text-ink-muted">·</span>
          <span className="text-q-amber-text">P(1) {pct(odds.p1)}</span>
          {lastOutcome !== null ? (
            <span className="ml-2 rounded-full border border-q-amber/40 px-2 py-0.5 text-[11px] text-q-amber-text">
              read {lastOutcome}
            </span>
          ) : null}
          {touched ? (
            <button
              type="button"
              onClick={reset}
              className="focus-ring ml-3 rounded text-[11px] font-sans text-ink-muted underline underline-offset-2 hover:text-ink"
              aria-label="Reset the qubit to zero"
            >
              reset
            </button>
          ) : null}
        </p>
        <p className="mt-2 min-h-[3.5rem] text-[13px] leading-relaxed text-ink-secondary" aria-live="polite">
          {says}
        </p>
      </div>
    </div>
  )
}
