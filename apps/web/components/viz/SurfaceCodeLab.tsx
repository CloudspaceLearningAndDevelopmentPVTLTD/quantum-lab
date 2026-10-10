'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  evaluateErrors,
  runShot,
  type ShotResult,
  type SurfaceCode,
} from './surface/code'
import { readVizColors, withAlpha, type VizColors } from './theme'
import {
  createFrameLoop,
  domIntersectionWatcher,
  prefersReducedMotion,
  watchThemeChange,
  type FrameLoop,
} from './frameLoop'
import { mulberry32 } from '@/lib/quantum'

/**
 * SurfaceCodeLab — a rotated surface code lattice you can break by hand.
 *
 * Data qubits are circles on a d × d grid. Stabilisers are the diamonds between them:
 * X-type in teal, Z-type in sky. A diamond lights up when its parity flipped — that
 * is the only thing a real machine ever learns, and the point of the picture is how
 * little that is. The decoder's matching is drawn as chains through the data qubits
 * it proposes to flip.
 *
 * Everything drawn is computed in surface/code.ts on the actual lattice: the syndrome
 * is a parity over each stabiliser's support, the matching is minimum-weight over BFS
 * distances in the real syndrome graph, and the logical-error banner is the parity of
 * the residual chain against the logical operator. Nothing here is scripted.
 *
 * Interaction is NOT mouse-only: an invisible grid of buttons sits over the canvas,
 * one per data qubit, each labelled with its position and current error. Tab to a
 * qubit and press Enter to inject an error. The canvas itself carries a description
 * of the whole current state, and the page prints the syndrome as a table.
 */

/** Shots per frame in Monte Carlo mode. Enough to move the estimate visibly. */
const SHOTS_PER_FRAME = 12
const EMIT_MS = 200

export type MonteCarloStats = {
  shots: number
  failures: number
  /** Failures attributable to each channel; a shot can fail in both. */
  failuresX: number
  failuresZ: number
}

const ZERO_MC: MonteCarloStats = { shots: 0, failures: 0, failuresX: 0, failuresZ: 0 }

export type ErrorChannel = 'X' | 'Z'

type Props = {
  code: SurfaceCode
  errorsX: Uint8Array
  errorsZ: Uint8Array
  /** Which channel a click or Enter injects into. */
  channel: ErrorChannel
  /** Physical error rate for Monte Carlo mode. */
  p: number
  /** When true the frame loop runs shots instead of showing the hand-placed errors. */
  monteCarlo: boolean
  /** Bump to clear the accumulated Monte Carlo statistics. */
  resetKey: number
  onToggleQubit: (q: number) => void
  onMonteCarlo?: (s: MonteCarloStats) => void
  className?: string
}

export default function SurfaceCodeLab({
  code,
  errorsX,
  errorsZ,
  channel,
  p,
  monteCarlo,
  resetKey,
  onToggleQubit,
  onMonteCarlo,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const loopRef = useRef<FrameLoop | null>(null)

  // The decode of whatever the learner placed by hand. Recomputed only when the
  // lattice or the errors change — this is exact, not sampled.
  const handResult = useMemo(
    () => evaluateErrors(code, errorsX, errorsZ),
    [code, errorsX, errorsZ]
  )

  const propsRef = useRef({ code, p, monteCarlo, handResult })
  propsRef.current = { code, p, monteCarlo, handResult }
  const onMonteCarloRef = useRef(onMonteCarlo)
  onMonteCarloRef.current = onMonteCarlo

  const generationRef = useRef(0)
  const builtRef = useRef(-1)
  const mcStatsRef = useRef<MonteCarloStats>(ZERO_MC)
  const mcResultRef = useRef<ShotResult | null>(null)

  useEffect(() => {
    generationRef.current += 1
    loopRef.current?.start()
  }, [code, p, resetKey])

  useEffect(() => {
    loopRef.current?.start()
  }, [monteCarlo, handResult, channel])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = prefersReducedMotion()
    let colors = readVizColors(wrap)
    let rand = mulberry32(1)
    let lastEmit = 0

    const resetRun = (): void => {
      mcStatsRef.current = ZERO_MC
      mcResultRef.current = null
      rand = mulberry32(0x2545f491 ^ (generationRef.current * 2246822519))
      builtRef.current = generationRef.current
      lastEmit = 0
    }

    const onFrame = (now: number): boolean => {
      if (builtRef.current !== generationRef.current) resetRun()
      const live = propsRef.current
      let more = false

      if (live.monteCarlo) {
        const s = { ...mcStatsRef.current }
        let last: ShotResult | null = null
        // Under prefers-reduced-motion the loop still gathers statistics — the
        // numbers are the content — it just does one batch and stops rather than
        // repainting a flickering lattice sixty times a second.
        const batch = reduceMotion ? SHOTS_PER_FRAME * 40 : SHOTS_PER_FRAME
        for (let i = 0; i < batch; i++) {
          last = runShot(live.code, live.p, rand)
          s.shots += 1
          if (last.failed) s.failures += 1
          if (last.logicalXError) s.failuresX += 1
          if (last.logicalZError) s.failuresZ += 1
        }
        mcStatsRef.current = s
        mcResultRef.current = last
        more = !reduceMotion
      }

      if (now - lastEmit > EMIT_MS) {
        lastEmit = now
        onMonteCarloRef.current?.(mcStatsRef.current)
      }

      const { w, h } = sizeRef.current
      const shown = live.monteCarlo && mcResultRef.current ? mcResultRef.current : live.handResult
      if (w > 0 && h > 0) render(ctx, live.code, shown, w, h, colors)
      return more
    }

    const loop = createFrameLoop(window, document, domIntersectionWatcher(wrap), onFrame)
    loopRef.current = loop

    const repaint = (): void => {
      const { w, h } = sizeRef.current
      const live = propsRef.current
      const shown = live.monteCarlo && mcResultRef.current ? mcResultRef.current : live.handResult
      if (w > 0 && h > 0) render(ctx, live.code, shown, w, h, colors)
    }

    const stopTheme = watchThemeChange(() => {
      colors = readVizColors(wrap)
      repaint()
    })

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sizeRef.current = { w, h }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (builtRef.current !== generationRef.current) resetRun()
      repaint()
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
  }, [])

  const d = code.d

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height: 440 }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describe(code, monteCarlo ? null : handResult, monteCarlo)}
      />

      {/* A11Y + input: one real button per data qubit, laid over the canvas. This is
          the ONLY way errors get injected — the canvas has no click handler of its
          own — so keyboard and pointer take exactly the same path and cannot drift
          apart. The buttons are transparent; the canvas draws what they represent. */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden={monteCarlo ? 'true' : undefined}
      >
        <div
          role="group"
          aria-label={`Data qubits, ${d} by ${d}. Activate one to inject a ${channel} error.`}
          className={`pointer-events-auto grid ${monteCarlo ? 'invisible' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${d}, ${CELL}px)`,
            gridTemplateRows: `repeat(${d}, ${CELL}px)`,
          }}
        >
          {Array.from({ length: d * d }, (_, q) => {
            const r = Math.floor(q / d)
            const c = q % d
            const hasX = errorsX[q] === 1
            const hasZ = errorsZ[q] === 1
            const state = hasX && hasZ ? 'X and Z error' : hasX ? 'X error' : hasZ ? 'Z error' : 'clean'
            return (
              <button
                key={q}
                type="button"
                disabled={monteCarlo}
                aria-pressed={channel === 'X' ? hasX : hasZ}
                onClick={() => onToggleQubit(q)}
                className="focus-ring rounded-full"
                style={{ width: CELL, height: CELL, background: 'transparent', border: 0 }}
              >
                <span className="sr-only">{`Qubit row ${r + 1}, column ${c + 1}: ${state}. Toggle ${channel} error.`}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The overlay button pitch, in CSS pixels, and the lattice pitch the canvas draws at.
 * They must be the same number or the buttons stop lining up with the circles — this
 * constant is the single source of both.
 */
const CELL = 44

/** Accessible name: what the lattice shows right now, in words. */
function describe(code: SurfaceCode, result: ShotResult | null, monteCarlo: boolean): string {
  const head = `Rotated surface code, distance ${code.d}: ${code.numData} data qubits and ${code.stabilisers.length} stabiliser measurements.`
  if (monteCarlo || result === null) {
    return `${head} Running randomised error rounds; the counts are given in the statistics beside this lattice.`
  }
  const errX = countOnes(result.errorsX)
  const errZ = countOnes(result.errorsZ)
  if (errX === 0 && errZ === 0) {
    return `${head} No errors placed. Every stabiliser reads even parity, so nothing is lit.`
  }
  const litZ = result.decX.defects.length
  const litX = result.decZ.defects.length
  const verdict = result.failed
    ? `The correction closes the syndrome but leaves a logical ${result.logicalXError ? 'X' : ''}${result.logicalXError && result.logicalZError ? ' and ' : ''}${result.logicalZError ? 'Z' : ''} error: the encoded qubit has been corrupted.`
    : 'The correction returns the lattice to the code space with no logical error.'
  return (
    `${head} ${errX} X errors and ${errZ} Z errors placed. ` +
    `${litZ} Z-type and ${litX} X-type stabilisers are lit. ` +
    `The decoder proposes chains of ${countOnes(result.decX.correction)} and ` +
    `${countOnes(result.decZ.correction)} qubits. ${verdict}`
  )
}

function countOnes(a: Uint8Array): number {
  let n = 0
  for (const v of a) n += v
  return n
}

function render(
  ctx: CanvasRenderingContext2D,
  code: SurfaceCode,
  result: ShotResult,
  w: number,
  h: number,
  colors: VizColors
): void {
  ctx.clearRect(0, 0, w, h)
  const d = code.d
  const originX = w / 2 - ((d - 1) * CELL) / 2
  const originY = h / 2 - ((d - 1) * CELL) / 2
  const xOf = (col: number) => originX + col * CELL
  const yOf = (row: number) => originY + row * CELL

  const litZ = new Set(result.decX.defects)
  const litX = new Set(result.decZ.defects)

  // ── Stabiliser plaquettes ──
  for (const s of code.stabilisers) {
    const isZ = s.type === 'Z'
    const lit = isZ ? litZ.has(s.typeIndex) : litX.has(s.typeIndex)
    const base = isZ ? colors.sky : colors.teal
    const cx = xOf(s.col)
    const cy = yOf(s.row)

    // Draw the plaquette as the convex hull of its data qubits, inset — for a
    // weight-2 boundary stabiliser that is a lens shape pointing off the lattice,
    // which is what the half-plaquette actually is.
    ctx.beginPath()
    if (s.qubits.length === 4) {
      ctx.moveTo(cx, cy - CELL * 0.46)
      ctx.lineTo(cx + CELL * 0.46, cy)
      ctx.lineTo(cx, cy + CELL * 0.46)
      ctx.lineTo(cx - CELL * 0.46, cy)
    } else {
      const [q0, q1] = s.qubits
      const x0 = xOf(q0 % d)
      const y0 = yOf(Math.floor(q0 / d))
      const x1 = xOf(q1 % d)
      const y1 = yOf(Math.floor(q1 / d))
      ctx.moveTo(x0, y0)
      ctx.quadraticCurveTo(cx + (cx - (x0 + x1) / 2) * 1.4, cy + (cy - (y0 + y1) / 2) * 1.4, x1, y1)
    }
    ctx.closePath()
    ctx.fillStyle = withAlpha(base, lit ? 0.55 : 0.1)
    ctx.fill()
    ctx.strokeStyle = withAlpha(base, lit ? 1 : 0.28)
    ctx.lineWidth = lit ? 2 : 1
    ctx.stroke()
  }

  // ── Decoder chains, under the qubits ──
  const drawChains = (
    chains: { qubits: number[] }[],
    stroke: string
  ): void => {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 3.5
    ctx.lineCap = 'round'
    for (const chain of chains) {
      for (const q of chain.qubits) {
        const r = Math.floor(q / d)
        const c = q % d
        ctx.beginPath()
        ctx.arc(xOf(c), yOf(r), CELL * 0.3, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }
  drawChains(result.decX.chains, withAlpha(colors.amber, 0.85))
  drawChains(result.decZ.chains, withAlpha(colors.violet, 0.85))

  // ── Data qubits ──
  for (let q = 0; q < code.numData; q++) {
    const r = Math.floor(q / d)
    const c = q % d
    const cx = xOf(c)
    const cy = yOf(r)
    const hasX = result.errorsX[q] === 1
    const hasZ = result.errorsZ[q] === 1

    ctx.beginPath()
    ctx.arc(cx, cy, CELL * 0.19, 0, Math.PI * 2)
    ctx.fillStyle = hasX && hasZ ? colors.roseText : hasX ? colors.amber : hasZ ? colors.violet : colors.surface2
    ctx.fill()
    ctx.strokeStyle = hasX || hasZ ? withAlpha(colors.ink, 0.5) : withAlpha(colors.inkSecondary, 0.4)
    ctx.lineWidth = 1.25
    ctx.stroke()
  }

  // ── Logical operator representatives, as faint guide lines ──
  ctx.save()
  ctx.setLineDash([2, 5])
  ctx.lineWidth = 1
  ctx.strokeStyle = withAlpha(colors.inkSecondary, 0.35)
  ctx.beginPath()
  ctx.moveTo(xOf(0), yOf(-0.6))
  ctx.lineTo(xOf(0), yOf(d - 0.4))
  ctx.moveTo(xOf(-0.6), yOf(0))
  ctx.lineTo(xOf(d - 0.4), yOf(0))
  ctx.stroke()
  ctx.restore()

  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = colors.inkMuted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('X̄', xOf(0) - 4, yOf(-0.85))
  ctx.fillText('Z̄', xOf(-1.0), yOf(0))

  // ── Verdict banner ──
  if (result.failed) {
    const text = `LOGICAL ${result.logicalXError ? 'X' : ''}${
      result.logicalXError && result.logicalZError ? '+' : ''
    }${result.logicalZError ? 'Z' : ''} ERROR — the encoded qubit is wrong`
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = withAlpha(colors.rose, 0.2)
    const tw = ctx.measureText(text).width
    ctx.fillRect(w / 2 - tw / 2 - 10, 8, tw + 20, 22)
    ctx.fillStyle = colors.roseText
    ctx.fillText(text, w / 2, 13)
  }

  // ── Legend ──
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  const legend: [string, string][] = [
    ['X error', colors.amberText],
    ['Z error', colors.violetText],
    ['X stabiliser', colors.tealText],
    ['Z stabiliser', colors.skyText],
  ]
  let lx = 10
  for (const [label, color] of legend) {
    ctx.fillStyle = color
    ctx.fillText(label, lx, h - 8)
    lx += ctx.measureText(label).width + 14
  }
}
