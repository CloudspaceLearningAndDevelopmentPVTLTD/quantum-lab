'use client'

import { useEffect, useRef } from 'react'
import { drawAxes, drawDot, fitCanvas, makeFrame, readChartColors } from './noiseCanvas'

export interface FidelityPoint {
  depth: number
  fidelity: number
  gates: number
}

/**
 * Fidelity of the noisy state with the ideal one, as a function of how many
 * times the circuit's block is repeated. Points arrive one at a time from the
 * page's sliced job, so the chart just redraws whatever it has. The dotted
 * reference is the naive product (1 − p)^gates — every gate failing
 * independently and no error ever cancelling — which the measured curve
 * usually beats, because some Pauli errors leave the observable alone.
 */
export default function FidelityChart({
  points,
  maxDepth,
  reference,
  presetLabel,
}: {
  points: FidelityPoint[]
  maxDepth: number
  /** Predicted fidelity from a per-gate survival product, per depth. */
  reference: (depth: number) => number
  presetLabel: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      const { width, height, ctx } = fitCanvas(canvas)
      if (!ctx) return
      const colors = readChartColors(canvas)
      ctx.clearRect(0, 0, width, height)
      const xMax = Math.max(1, maxDepth)
      const f = makeFrame(width, height, [0, xMax], [0, 1.02])
      const xTicks: number[] = []
      const xStep = xMax > 16 ? 5 : xMax > 8 ? 2 : 1
      for (let d = 0; d <= xMax; d += xStep) xTicks.push(d)
      drawAxes(ctx, f, colors, {
        xTicks,
        yTicks: [0, 0.25, 0.5, 0.75, 1],
        xLabel: 'repeated blocks',
        yLabel: 'fidelity with the ideal state',
        yFormat: (v) => v.toFixed(2),
      })

      // Reference product.
      ctx.save()
      ctx.setLineDash([2, 4])
      ctx.strokeStyle = colors.inkMuted
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i <= 60; i++) {
        const d = (i / 60) * xMax
        const px = f.x(d), py = f.y(reference(d))
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.restore()

      // Measured curve.
      if (points.length > 0) {
        ctx.save()
        ctx.strokeStyle = colors.rose
        ctx.lineWidth = 2
        ctx.beginPath()
        points.forEach((p, i) => {
          const px = f.x(p.depth), py = f.y(p.fidelity)
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
        })
        ctx.stroke()
        ctx.restore()
        for (const p of points) drawDot(ctx, f.x(p.depth), f.y(p.fidelity), 3.5, colors.rose)
      }

      ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      let lx = f.left + 8
      const ly = f.top + 14
      drawDot(ctx, lx, ly, 4, colors.rose)
      ctx.fillStyle = colors.inkSecondary
      ctx.fillText('measured (trajectory average)', lx + 9, ly)
      lx += 9 + ctx.measureText('measured (trajectory average)').width + 16
      ctx.save()
      ctx.setLineDash([2, 4]); ctx.strokeStyle = colors.inkMuted; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(lx - 4, ly); ctx.lineTo(lx + 10, ly); ctx.stroke()
      ctx.restore()
      ctx.fillText('every-gate-fails product', lx + 14, ly)
    }
    draw()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null
    ro?.observe(canvas)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', draw)
    const mo = new MutationObserver(draw)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => {
      ro?.disconnect()
      mq.removeEventListener('change', draw)
      mo.disconnect()
    }
  }, [points, maxDepth, reference])

  const last = points[points.length - 1]
  const summary = last
    ? `Fidelity of ${presetLabel} versus repeated blocks: ${points.length} points, falling to ${last.fidelity.toFixed(3)} at ${last.depth} blocks (${last.gates} gates).`
    : `Fidelity of ${presetLabel} versus repeated blocks: no points yet.`

  return <canvas ref={canvasRef} role="img" aria-label={summary} className="block h-[240px] w-full" />
}
