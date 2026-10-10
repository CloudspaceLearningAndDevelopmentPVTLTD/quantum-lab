'use client'

import { useEffect, useRef } from 'react'
import {
  addShot,
  axisLabel,
  axisVector,
  blochVector,
  beamStateBefore,
  chainPlusProbabilities,
  emptyCounts,
  incidentAngle,
  malus,
  runChain,
  type Analyser,
  type ChainCounts,
  type ChainShot,
  type Source,
} from '@/lib/viz/sternGerlach'
import { mulberry32 } from '@/lib/quantum'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'

/**
 * SternGerlachLab — a beamline of two or three Stern-Gerlach analysers, drawn
 * on canvas, with silver atoms streaming through it one at a time.
 *
 * Nothing here is scripted. Every atom's route is decided by `runChain` in
 * lib/viz/sternGerlach.ts, which applies the Born rule at each magnet and
 * replaces the spin state with that magnet's eigenstate — so the 50/50 the
 * reader sees at the third analyser in the z → x → z setup is the physics
 * arriving at that answer, not a number typed into this file. The exact
 * probabilities are drawn alongside as beam thickness, so the sampled counts
 * can be watched converging onto them.
 *
 * Two canvases share one frame loop: the apparatus, and a cos²(Δ/2) plot with
 * the measured fraction at each angle the reader has visited scattered on top
 * of the analytic curve.
 *
 * ACCESSIBILITY: this component has no pointer interaction at all — every
 * control lives in the page's control rail as a real form control — so there
 * is no keyboard path to lose. Both canvases carry a description of what they
 * currently show, and the page prints the same counts as a table.
 */

export const APPARATUS_HEIGHT = 340
export const CURVE_HEIGHT = 150

/** Atoms per second in the live stream, and how fast a dot crosses the bench. */
const ATOMS_PER_SECOND = 60
const SPEED_PX_PER_S = 230
/** Atoms tallied per frame when the reader has asked for reduced motion. */
const REDUCED_BATCH = 600
const EMIT_MS = 120
/** Blocked atoms linger this long at the beam stop while they fade out. */
const FADE_S = 0.22
/** A measured point only joins the curve once it has this many atoms behind it. */
const MIN_SAMPLES_FOR_POINT = 40

type Pt = { x: number; y: number }

export type Route = {
  pts: Pt[]
  cum: number[]
  total: number
  blocked: boolean
}

type Particle = {
  route: Route
  /** Arc length travelled. */
  s: number
  /** Seconds spent fading at a beam stop. */
  dead: number
}

export type Layout = {
  w: number
  h: number
  n: number
  ovenX: number
  ovenW: number
  ovenH: number
  baseY: number
  boxW: number
  boxH: number
  /** Left edge and centre-line of each analyser box. */
  boxX: number[]
  boxY: number[]
  /** x where each analyser's two output beams have finished separating. */
  portX: number[]
  /** Half-separation of analyser i's two output beams. */
  dy: number[]
  /** Straight run between one analyser's fan-out and the next analyser. */
  run: number
  /** x of the final detector faces. */
  detX: number
  detW: number
  /** Exact P(+) at each analyser, conditioned on the earlier ports. */
  pPlus: number[]
  /** Fraction of the emitted beam entering each analyser. */
  flux: number[]
}

type Props = {
  chain: readonly Analyser[]
  source: Source
  /** True while the stream is emitting. */
  running: boolean
  /** Bump to clear every accumulated count and the measured points. */
  resetKey: number
  /** Bump `id` to tally `n` atoms instantly, without animating them. */
  burst: { id: number; n: number }
  onCounts?: (counts: ChainCounts) => void
  className?: string
}

/** Stable key for "the setup whose counts these are". */
function configKey(chain: readonly Analyser[]): string {
  return chain.map((a) => `${a.axis.theta.toFixed(6)}/${a.axis.phi.toFixed(6)}/${a.port}`).join('|')
}

/**
 * Stable key for everything EXCEPT the last analyser's axis. Rotating the last
 * analyser is the whole point of the cos² plot, so its measured points have to
 * survive that; changing anything upstream makes them describe a different
 * experiment and they are discarded.
 */
function malusKey(chain: readonly Analyser[]): string {
  return configKey(chain.slice(0, -1)) + `|n=${chain.length}`
}

export default function SternGerlachLab({
  chain,
  source,
  running,
  resetKey,
  burst,
  onCounts,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const benchRef = useRef<HTMLCanvasElement | null>(null)
  const curveRef = useRef<HTMLCanvasElement | null>(null)
  const loopRef = useRef<FrameLoop | null>(null)

  const propsRef = useRef({ chain, source, running, burst })
  propsRef.current = { chain, source, running, burst }
  const onCountsRef = useRef(onCounts)
  onCountsRef.current = onCounts

  // Generation counters: bumping one tells the frame loop to throw away the
  // matching accumulated state on its next tick, without tearing down the loop.
  const countsGenRef = useRef(0)
  const malusGenRef = useRef(0)

  const cfg = configKey(chain)
  const mk = malusKey(chain)

  useEffect(() => {
    countsGenRef.current += 1
    loopRef.current?.start()
  }, [cfg, resetKey])

  useEffect(() => {
    malusGenRef.current += 1
    loopRef.current?.start()
  }, [mk, resetKey])

  useEffect(() => {
    loopRef.current?.start()
  }, [running, burst])

  useEffect(() => {
    const wrap = wrapRef.current
    const bench = benchRef.current
    const curve = curveRef.current
    if (!wrap || !bench || !curve) return
    const benchCtx = bench.getContext('2d')
    const curveCtx = curve.getContext('2d')
    if (!benchCtx || !curveCtx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let size = { w: 0, benchH: APPARATUS_HEIGHT, curveH: CURVE_HEIGHT }

    let rand = mulberry32(0x9e3779b9)
    let counts: ChainCounts = emptyCounts(propsRef.current.chain.length)
    let particles: Particle[] = []
    let routeCache = new Map<string, Route>()
    let layout: Layout | null = null
    // Measured fraction at the final analyser, bucketed by the incident angle
    // in whole degrees. This is what turns the cos² plot into a measurement.
    let malusPoints = new Map<number, { n: number; plus: number }>()

    let builtCounts = -1
    let builtMalus = -1
    let lastBurstId = propsRef.current.burst.id
    let lastNow = 0
    let lastBatch = 0
    let pending = 0
    let lastEmit = 0

    const rebuildLayout = (): void => {
      const live = propsRef.current
      layout =
        size.w > 0 ? buildLayout(size.w, size.benchH, live.chain, live.source) : null
      routeCache = new Map()
      particles = []
    }

    const resetCounts = (): void => {
      counts = emptyCounts(propsRef.current.chain.length)
      particles = []
      rand = mulberry32(0x2545f491 ^ (countsGenRef.current * 2246822519))
      pending = 0
      builtCounts = countsGenRef.current
      lastEmit = 0
      rebuildLayout()
    }

    const resetMalus = (): void => {
      malusPoints = new Map()
      builtMalus = malusGenRef.current
    }

    /** The polyline an atom with these outcomes travels, memoised per layout. */
    const routeFor = (shot: ChainShot): Route | null => {
      if (!layout) return null
      const key = shot.outcomes.join(',')
      const cached = routeCache.get(key)
      if (cached) return cached
      const built = buildRoute(layout, shot)
      routeCache.set(key, built)
      return built
    }

    /** Fold one atom into the tallies (and the cos² scatter). */
    const tally = (shot: ChainShot): void => {
      counts = addShot(counts, shot)
      const live = propsRef.current
      const last = live.chain.length - 1
      if (shot.blockedAt === -1 && shot.outcomes.length === live.chain.length) {
        const delta = incidentAngle(live.source, live.chain, last)
        if (delta !== null) {
          const bucket = Math.round((delta * 180) / Math.PI)
          const cell = malusPoints.get(bucket) ?? { n: 0, plus: 0 }
          cell.n += 1
          if (shot.outcomes[last] === 1) cell.plus += 1
          malusPoints.set(bucket, cell)
        }
      }
    }

    const onFrame = (now: number): boolean => {
      if (builtCounts !== countsGenRef.current) resetCounts()
      if (builtMalus !== malusGenRef.current) resetMalus()
      const live = propsRef.current
      if (!layout) rebuildLayout()

      const dt = lastNow === 0 ? 0 : Math.min(0.05, (now - lastNow) / 1000)
      lastNow = now

      let needsPaint = false

      // ── Instant burst, however the page asked for it ──
      if (live.burst.id !== lastBurstId) {
        lastBurstId = live.burst.id
        for (let i = 0; i < live.burst.n; i++) tally(runChain(rand, live.source, live.chain))
        needsPaint = true
      }

      let more = false

      if (reduceMotion) {
        // The counts ARE the content, so a reduced-motion reader still gets
        // them — but as a figure that settles a few times a second, not as a
        // stream of moving dots and not as a counter churning at 60 Hz.
        particles = []
        if (live.running) {
          if (now - lastBatch > 400) {
            lastBatch = now
            for (let i = 0; i < REDUCED_BATCH; i++) tally(runChain(rand, live.source, live.chain))
            needsPaint = true
          }
          more = true
        }
      } else {
        needsPaint = true
        if (live.running) {
          pending += ATOMS_PER_SECOND * dt
          const emit = Math.min(24, Math.floor(pending))
          pending -= emit
          for (let i = 0; i < emit; i++) {
            const shot = runChain(rand, live.source, live.chain)
            tally(shot)
            const route = routeFor(shot)
            if (route) particles.push({ route, s: 0, dead: 0 })
          }
          more = true
        }
        // Advance and retire.
        const keep: Particle[] = []
        for (const p of particles) {
          if (p.s >= p.route.total) {
            if (p.route.blocked) {
              p.dead += dt
              if (p.dead < FADE_S) keep.push(p)
            }
            // Atoms that reached a detector have been counted; they leave.
          } else {
            p.s = Math.min(p.route.total, p.s + SPEED_PX_PER_S * dt)
            keep.push(p)
          }
        }
        particles = keep
        if (particles.length > 0) more = true
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        onCountsRef.current?.(counts)
      }

      if (needsPaint) paint()
      return more
    }

    const paint = (): void => {
      const live = propsRef.current
      // A theme toggle repaints even while the loop is parked, so the layout
      // can still describe the previous chain length. Rebuild rather than
      // index past the end of it.
      if (layout && layout.n !== live.chain.length) rebuildLayout()
      if (!layout || size.w <= 0) return
      drawBench(benchCtx, layout, live.chain, counts, particles, colors)
      drawCurve(
        curveCtx,
        size.w,
        size.curveH,
        live.source,
        live.chain,
        malusPoints,
        colors
      )
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      paint()
    })

    const setupCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      // A 0-width wrapper (not laid out yet, hidden tab, collapsed parent)
      // must not build a layout: every x-coordinate lands past the right
      // edge and the detector width goes negative. Wait for the observer.
      if (rect.width < 2) return
      const w = Math.round(rect.width)
      size = { w, benchH: APPARATUS_HEIGHT, curveH: CURVE_HEIGHT }
      setupCanvas(bench, benchCtx, w, size.benchH)
      setupCanvas(curve, curveCtx, w, size.curveH)
      rebuildLayout()
      if (builtCounts !== countsGenRef.current) resetCounts()
      if (builtMalus !== malusGenRef.current) resetMalus()
      paint()
      loop.start()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()

    return () => {
      observer.disconnect()
      stopTheme()
      loop.dispose()
      loopRef.current = null
    }
    // The loop reads live props through propsRef; it is built once and torn
    // down only on unmount, exactly like the other labs on this site.
  }, [])

  return (
    <div ref={wrapRef} className={`w-full ${className}`}>
      <canvas
        ref={benchRef}
        className="block w-full"
        style={{ height: APPARATUS_HEIGHT }}
        role="img"
        aria-label={describeBench(source, chain)}
      />
      <canvas
        ref={curveRef}
        className="block w-full"
        style={{ height: CURVE_HEIGHT }}
        role="img"
        aria-label={describeCurve(source, chain)}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Geometry
// ────────────────────────────────────────────────────────────

export function buildLayout(
  w: number,
  h: number,
  chain: readonly Analyser[],
  source: Source
): Layout {
  const n = chain.length
  const left = 10
  const right = 8
  const ovenW = clamp(w * 0.075, 34, 54)
  const ovenH = clamp(h * 0.13, 30, 46)
  const lead = clamp(w * 0.035, 14, 34)
  const boxW = clamp(w * 0.05, 22, 38)
  const boxH = clamp(h * 0.15, 34, 54)
  const detW = clamp(w * 0.13, 54, 92)

  // Whatever is left over is shared between the fan-outs (where the beam
  // separates) and the straight runs between analysers.
  const rest = Math.max(60, w - left - ovenW - lead - n * boxW - detW - right)
  const unit = rest / (n + (n - 1) * 0.55)
  const fan = unit
  const run = unit * 0.55

  const spreadScale = [0.16, 0.115, 0.085]
  const dy = Array.from({ length: n }, (_, i) => h * (spreadScale[i] ?? 0.075))

  const baseY = h * 0.5
  const boxX: number[] = []
  const boxY: number[] = []
  const portX: number[] = []
  let x = left + ovenW + lead
  let y = baseY
  for (let i = 0; i < n; i++) {
    boxX.push(x)
    boxY.push(y)
    x += boxW
    portX.push(x + fan)
    if (i < n - 1) {
      y += chain[i].port === 1 ? -dy[i] : dy[i]
      x = portX[i] + run
    }
  }

  const pPlus = chainPlusProbabilities(source, chain)
  const flux: number[] = []
  let f = 1
  for (let i = 0; i < n; i++) {
    flux.push(f)
    f = f * (chain[i].port === 1 ? pPlus[i] : 1 - pPlus[i])
  }

  return {
    w,
    h,
    n,
    ovenX: left,
    ovenW,
    ovenH,
    baseY,
    boxW,
    boxH,
    boxX,
    boxY,
    portX,
    dy,
    run,
    detX: portX[n - 1] + clamp(w * 0.02, 8, 20),
    detW,
    pPlus,
    flux,
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** y of analyser i's `outcome` output port. */
export function portY(layout: Layout, i: number, outcome: 1 | -1): number {
  return layout.boxY[i] + (outcome === 1 ? -layout.dy[i] : layout.dy[i])
}

/**
 * Where a blocked beam runs into its stop. Capped by the straight run to the
 * next analyser as well as by the beam separation, so a narrow phone layout
 * cannot push the stop bar through the following magnet.
 */
export function stopX(layout: Layout, i: number): number {
  return layout.portX[i] + Math.min(22, layout.dy[i] * 0.35, layout.run * 0.45)
}

export function buildRoute(layout: Layout, shot: ChainShot): Route {
  const pts: Pt[] = [{ x: layout.ovenX + layout.ovenW, y: layout.baseY }]
  let blocked = false
  for (let i = 0; i < shot.outcomes.length; i++) {
    const o = shot.outcomes[i]
    pts.push({ x: layout.boxX[i], y: layout.boxY[i] })
    pts.push({ x: layout.boxX[i] + layout.boxW, y: layout.boxY[i] })
    pts.push({ x: layout.portX[i], y: portY(layout, i, o) })
    if (i === shot.blockedAt) {
      pts.push({ x: stopX(layout, i), y: portY(layout, i, o) })
      blocked = true
      break
    }
    if (i === layout.n - 1) {
      pts.push({ x: layout.detX, y: portY(layout, i, o) })
    }
  }
  const cum = [0]
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    cum.push(total)
  }
  return { pts, cum, total, blocked }
}

export function pointAt(route: Route, s: number): Pt {
  const { pts, cum } = route
  if (s <= 0) return pts[0]
  if (s >= route.total) return pts[pts.length - 1]
  let i = 1
  while (i < cum.length - 1 && cum[i] < s) i++
  const seg = cum[i] - cum[i - 1]
  const t = seg <= 0 ? 0 : (s - cum[i - 1]) / seg
  return {
    x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
    y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
  }
}

// ────────────────────────────────────────────────────────────
// Painting
// ────────────────────────────────────────────────────────────

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

function drawBench(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  chain: readonly Analyser[],
  counts: ChainCounts,
  particles: readonly Particle[],
  c: VizColors
): void {
  ctx.clearRect(0, 0, L.w, L.h)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  drawOven(ctx, L, c)

  const beam = (from: Pt, to: Pt, intensity: number, dead: boolean): void => {
    const i = clamp(intensity, 0, 1)
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.strokeStyle = withAlpha(dead ? c.rose : c.violet, 0.2 + 0.55 * i)
    ctx.lineWidth = 1.2 + 4.2 * i
    ctx.stroke()
  }

  // The beam entering analyser 0.
  beam(
    { x: L.ovenX + L.ovenW, y: L.baseY },
    { x: L.boxX[0], y: L.boxY[0] },
    L.flux[0],
    false
  )

  for (let i = 0; i < L.n; i++) {
    const exit = { x: L.boxX[i] + L.boxW, y: L.boxY[i] }
    const last = i === L.n - 1
    for (const o of [1, -1] as const) {
      const py = portY(L, i, o)
      const branchFlux = L.flux[i] * (o === 1 ? L.pPlus[i] : 1 - L.pPlus[i])
      const stopped = !last && o !== chain[i].port
      beam(exit, { x: L.portX[i], y: py }, branchFlux, stopped)
      if (stopped) {
        beam({ x: L.portX[i], y: py }, { x: stopX(L, i), y: py }, branchFlux, true)
        drawStop(ctx, stopX(L, i), py, c)
      } else if (last) {
        beam({ x: L.portX[i], y: py }, { x: L.detX, y: py }, branchFlux, false)
      } else {
        beam({ x: L.portX[i], y: py }, { x: L.boxX[i + 1], y: L.boxY[i + 1] }, branchFlux, false)
      }
    }
  }

  // ── Atoms in flight, drawn over the beams ──
  for (const p of particles) {
    const at = pointAt(p.route, p.s)
    const fading = p.dead > 0
    const k = fading ? 1 - p.dead / FADE_S : 1
    ctx.beginPath()
    ctx.arc(at.x, at.y, fading ? 2 + 3 * (1 - k) : 2.4, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(fading ? c.rose : c.violetText, Math.max(0, k))
    ctx.fill()
  }

  // ── Magnets, on top of everything ──
  for (let i = 0; i < L.n; i++) drawMagnet(ctx, L, i, chain[i], c)

  // ── Counters ──
  for (let i = 0; i < L.n; i++) {
    const last = i === L.n - 1
    const up = counts.plus[i] ?? 0
    const down = counts.minus[i] ?? 0
    const reached = up + down
    for (const o of [1, -1] as const) {
      const py = portY(L, i, o)
      const n = o === 1 ? up : down
      const share = reached > 0 ? n / reached : 0
      if (last) {
        drawDetector(ctx, L, py, o, n, share, c)
      } else {
        const stopped = o !== chain[i].port
        drawPortTag(
          ctx,
          stopped ? stopX(L, i) + 6 : L.portX[i] + 6,
          py,
          o,
          n,
          share,
          stopped,
          c
        )
      }
    }
  }

  drawLegend(ctx, L, counts, c)
}

function drawOven(ctx: CanvasRenderingContext2D, L: Layout, c: VizColors): void {
  const x = L.ovenX
  const y = L.baseY - L.ovenH / 2
  roundRect(ctx, x, y, L.ovenW, L.ovenH, 6)
  ctx.fillStyle = withAlpha(c.amber, 0.14)
  ctx.fill()
  ctx.strokeStyle = withAlpha(c.amber, 0.6)
  ctx.lineWidth = 1.25
  ctx.stroke()
  ctx.font = `600 9px ${MONO}`
  ctx.fillStyle = c.amberText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('OVEN', x + L.ovenW / 2, L.baseY)
  ctx.font = `8px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.fillText('unpolarised', x + L.ovenW / 2, y + L.ovenH + 9)
}

/**
 * An analyser: a box with an arrow through it showing which way its field
 * gradient points. Straight up is z, horizontal is x, and the arrow rotates
 * continuously between them — so the picture of the apparatus changes when the
 * reader moves the angle slider, not just the numbers.
 */
function drawMagnet(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  i: number,
  a: Analyser,
  c: VizColors
): void {
  const x = L.boxX[i]
  const y = L.boxY[i] - L.boxH / 2
  roundRect(ctx, x, y, L.boxW, L.boxH, 5)
  ctx.fillStyle = withAlpha(c.surface2, 0.96)
  ctx.fill()
  ctx.strokeStyle = withAlpha(c.violet, 0.75)
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Screen coordinates put +z up and +x right, so an axis at polar angle theta
  // (from +z, in the x–z plane) points along (sin θ, −cos θ).
  const cx = x + L.boxW / 2
  const cy = L.boxY[i]
  const r = Math.min(L.boxW, L.boxH) * 0.34
  const ux = Math.sin(a.axis.theta) * Math.cos(a.axis.phi)
  const uy = -Math.cos(a.axis.theta)
  ctx.beginPath()
  ctx.moveTo(cx - ux * r, cy - uy * r)
  ctx.lineTo(cx + ux * r, cy + uy * r)
  ctx.strokeStyle = c.violetText
  ctx.lineWidth = 2
  ctx.stroke()
  // Arrowhead on the + end.
  const hx = cx + ux * r
  const hy = cy + uy * r
  ctx.beginPath()
  ctx.moveTo(hx, hy)
  ctx.lineTo(hx - ux * 5 - uy * 3.5, hy - uy * 5 + ux * 3.5)
  ctx.lineTo(hx - ux * 5 + uy * 3.5, hy - uy * 5 - ux * 3.5)
  ctx.closePath()
  ctx.fillStyle = c.violetText
  ctx.fill()

  ctx.font = `600 9px ${MONO}`
  ctx.fillStyle = c.inkSecondary
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(`SG-${axisLabel((a.axis.theta * 180) / Math.PI)}`, cx, y + L.boxH + 5)
}

function drawStop(ctx: CanvasRenderingContext2D, x: number, y: number, c: VizColors): void {
  ctx.beginPath()
  ctx.moveTo(x, y - 11)
  ctx.lineTo(x, y + 11)
  ctx.strokeStyle = c.rose
  ctx.lineWidth = 4
  ctx.stroke()
}

function drawPortTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outcome: 1 | -1,
  n: number,
  share: number,
  stopped: boolean,
  c: VizColors
): void {
  ctx.font = `9px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = stopped ? c.roseText : c.inkSecondary
  const pct = n > 0 || share > 0 ? ` (${(share * 100).toFixed(0)}%)` : ''
  ctx.fillText(`${outcome === 1 ? '↑' : '↓'} ${format(n)}${pct}`, x, y - 5)
  if (stopped) {
    ctx.fillStyle = withAlpha(c.rose, 0.85)
    ctx.textBaseline = 'top'
    ctx.fillText('blocked', x, y + 5)
  }
}

function drawDetector(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  y: number,
  outcome: 1 | -1,
  n: number,
  share: number,
  c: VizColors
): void {
  const base = outcome === 1 ? c.teal : c.sky
  const text = outcome === 1 ? c.tealText : c.skyText
  const h = 34
  const x = L.detX
  const w = Math.min(L.detW, L.w - x - 6)
  if (w <= 0) return
  roundRect(ctx, x, y - h / 2, w, h, 6)
  ctx.fillStyle = withAlpha(base, 0.16)
  ctx.fill()
  ctx.strokeStyle = withAlpha(base, 0.65)
  ctx.lineWidth = 1.25
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 13px ${MONO}`
  ctx.fillStyle = text
  ctx.fillText(`${(share * 100).toFixed(1)}%`, x + w / 2, y - 5)
  ctx.font = `9px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.fillText(`${outcome === 1 ? '↑' : '↓'} ${format(n)}`, x + w / 2, y + 9)
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  counts: ChainCounts,
  c: VizColors
): void {
  ctx.font = `9px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = c.inkMuted
  ctx.fillText(`${format(counts.emitted)} atoms fired`, 10, L.h - 8)
}

/**
 * The cos²(Δ/2) plot: the analytic curve, the reader's current angle, and the
 * measured fraction at every angle they have already run.
 */
function drawCurve(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  source: Source,
  chain: readonly Analyser[],
  points: ReadonlyMap<number, { n: number; plus: number }>,
  c: VizColors
): void {
  ctx.clearRect(0, 0, w, h)
  const padL = 40
  const padR = 12
  const padT = 14
  const padB = 24
  const plotW = Math.max(10, w - padL - padR)
  const plotH = Math.max(10, h - padT - padB)
  const X = (deg: number) => padL + (deg / 180) * plotW
  const Y = (p: number) => padT + (1 - p) * plotH

  // Frame and gridlines.
  ctx.strokeStyle = withAlpha(c.inkMuted, 0.25)
  ctx.lineWidth = 1
  ctx.font = `9px ${MONO}`
  ctx.fillStyle = c.inkMuted
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const p of [0, 0.5, 1]) {
    ctx.beginPath()
    ctx.moveTo(padL, Y(p))
    ctx.lineTo(padL + plotW, Y(p))
    ctx.stroke()
    ctx.fillText(p === 0.5 ? '½' : `${p}`, padL - 6, Y(p))
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const deg of [0, 45, 90, 135, 180]) {
    ctx.fillText(`${deg}°`, X(deg), padT + plotH + 5)
  }

  // The analytic curve.
  ctx.beginPath()
  for (let deg = 0; deg <= 180; deg += 1.5) {
    const px = X(deg)
    const py = Y(malus((deg * Math.PI) / 180))
    if (deg === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = withAlpha(c.violet, 0.9)
  ctx.lineWidth = 2
  ctx.stroke()

  // Measured fractions.
  for (const [deg, cell] of points) {
    if (cell.n < MIN_SAMPLES_FOR_POINT || deg < 0 || deg > 180) continue
    const r = clamp(2 + Math.log10(cell.n) * 1.4, 2.2, 6)
    ctx.beginPath()
    ctx.arc(X(deg), Y(cell.plus / cell.n), r, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(c.teal, 0.75)
    ctx.fill()
    ctx.strokeStyle = withAlpha(c.tealText, 0.9)
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Where the last analyser sits right now.
  const last = chain.length - 1
  const delta = incidentAngle(source, chain, last)
  if (delta !== null) {
    const deg = clamp((delta * 180) / Math.PI, 0, 180)
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(X(deg), padT)
    ctx.lineTo(X(deg), padT + plotH)
    ctx.strokeStyle = withAlpha(c.amber, 0.8)
    ctx.lineWidth = 1.25
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(X(deg), Y(malus(delta)), 4, 0, Math.PI * 2)
    ctx.fillStyle = c.amberText
    ctx.fill()
  }

  ctx.font = `9px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = c.inkMuted
  ctx.fillText('P(↑) = cos²(Δ/2)  ·  Δ = angle between the arriving spin and the last analyser', padL + 2, 2)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  // A degenerate box (the wrapper measured 0-1px on the first paint, or a
  // detector pushed past the right edge) must draw nothing, not throw:
  // arcTo rejects a negative radius with an IndexSizeError, and that error
  // escapes the frame loop straight into the route's error boundary. Clamp
  // the radius and bail on non-positive sizes; the ResizeObserver repaints
  // as soon as the real width arrives.
  ctx.beginPath()
  if (!(w > 0 && h > 0)) return
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function format(n: number): string {
  return n < 100000 ? n.toLocaleString('en-US') : n.toExponential(1)
}

// ────────────────────────────────────────────────────────────
// Accessible descriptions
// ────────────────────────────────────────────────────────────

function chainWords(chain: readonly Analyser[]): string {
  return chain
    .map((a, i) => {
      const name = axisLabel((a.axis.theta * 180) / Math.PI)
      const port = i < chain.length - 1 ? `, ${a.port === 1 ? 'up' : 'down'} port continues` : ''
      return `analyser ${i + 1} along ${name}${port}`
    })
    .join('; ')
}

export function describeBench(source: Source, chain: readonly Analyser[]): string {
  const p = chainPlusProbabilities(source, chain)
  const predicted = p
    .map((v, i) => `analyser ${i + 1}: ${(v * 100).toFixed(1)}% up`)
    .join(', ')
  return (
    `A beamline: an ${source === null ? 'unpolarised' : 'polarised'} source followed by ` +
    `${chain.length} Stern-Gerlach analysers. ${chainWords(chain)}. ` +
    `Exact predicted split at each analyser, given the beam reached it — ${predicted}. ` +
    `Running counts are given in the table below this figure.`
  )
}

export function describeCurve(source: Source, chain: readonly Analyser[]): string {
  const last = chain.length - 1
  const delta = incidentAngle(source, chain, last)
  if (delta === null) return 'A plot of cosine-squared of half the angle between two axes.'
  const deg = (delta * 180) / Math.PI
  const state = beamStateBefore(source, chain, last)
  const aligned =
    state === null
      ? ''
      : ` The spin arriving at it points along ${describeVector(blochVector(state))}, and that analyser measures along ${describeVector(axisVector(chain[last].axis))}.`
  return (
    `The curve P equals cosine squared of half the angle. The last analyser currently sits ` +
    `${deg.toFixed(0)} degrees from the spin arriving at it, so it should pass ` +
    `${(malus(delta) * 100).toFixed(1)} percent of that beam through its up port.${aligned} ` +
    `Measured fractions from angles already run are plotted as points on the same axes.`
  )
}

function describeVector(v: readonly [number, number, number]): string {
  return `x ${v[0].toFixed(2)}, y ${v[1].toFixed(2)}, z ${v[2].toFixed(2)}`
}
