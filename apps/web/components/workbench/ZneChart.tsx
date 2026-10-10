'use client'

import { useEffect, useRef } from 'react'
import type { MitigationReport } from '@/lib/workbench/mitigation'
import { drawAxes, drawDot, drawErrorBar, fitCanvas, makeFrame, niceRange, readChartColors } from './noiseCanvas'

/**
 * The zero-noise-extrapolation picture: measured points at fold scales 1, 3, 5
 * (hollow = raw, filled = readout-mitigated, with bootstrap bars), the fitted
 * curve run back to λ = 0, the extrapolated value there, and the ideal value
 * as a dashed line. Static — it redraws when the report changes and on
 * resize, and never animates, so reduced-motion needs nothing special.
 */
export default function ZneChart({
  report,
  observableLabel,
}: {
  report: MitigationReport | null
  observableLabel: string
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

      const xs = [0, 1, 2, 3, 4, 5]
      const ys = report
        ? [report.ideal, report.zne - report.zneStderr, report.zne + report.zneStderr,
           ...report.points.flatMap((p) => [p.value, p.readoutMitigated - p.stderr, p.readoutMitigated + p.stderr])]
        : [0, 1]
      const yRange = niceRange(ys, -1.1, 1.1)
      const f = makeFrame(width, height, [-0.3, 5.6], yRange)
      const yTicks: number[] = []
      const step = yRange[1] - yRange[0] > 1 ? 0.5 : yRange[1] - yRange[0] > 0.4 ? 0.2 : 0.1
      for (let t = Math.ceil(yRange[0] / step) * step; t <= yRange[1] + 1e-9; t += step) yTicks.push(Number(t.toFixed(3)))
      drawAxes(ctx, f, colors, {
        xTicks: xs,
        yTicks,
        xLabel: 'noise scale λ (gate folds)',
        yLabel: observableLabel,
        yFormat: (v) => v.toFixed(step < 0.2 ? 1 : 1),
      })

      if (!report) {
        ctx.fillStyle = colors.inkMuted
        ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('running…', (f.left + f.right) / 2, (f.top + f.bottom) / 2)
        return
      }

      // Ideal: dashed teal line.
      ctx.save()
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = colors.teal
      ctx.lineWidth = 1.5
      const yi = f.y(report.ideal)
      ctx.beginPath(); ctx.moveTo(f.left, yi); ctx.lineTo(f.right, yi); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = colors.teal
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
      ctx.fillText(`ideal ${report.ideal.toFixed(3)}`, f.right - 2, yi - 3)

      // Fitted curve, from 0 to 5.5.
      if (report.curve) {
        ctx.save()
        ctx.strokeStyle = colors.violet
        ctx.lineWidth = 2
        ctx.beginPath()
        let first = true
        for (let i = 0; i <= 110; i++) {
          const x = (i / 110) * 5.5
          const y = report.curve(x)
          if (!Number.isFinite(y)) continue
          const px = f.x(x), py = f.y(Math.max(yRange[0] - 1, Math.min(yRange[1] + 1, y)))
          if (first) { ctx.moveTo(px, py); first = false } else ctx.lineTo(px, py)
        }
        ctx.stroke()
        ctx.restore()
      } else {
        // Learned method: no closed-form curve. Dotted guide from scale 1 to the prediction.
        ctx.save()
        ctx.setLineDash([2, 4])
        ctx.strokeStyle = colors.violet
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(f.x(0), f.y(report.zne))
        ctx.lineTo(f.x(report.points[0].scale), f.y(report.points[0].readoutMitigated))
        ctx.stroke()
        ctx.restore()
      }

      // Measured points.
      for (const p of report.points) {
        const x = f.x(p.scale)
        drawDot(ctx, x + 6, f.y(p.value), 4, colors.rose, true, colors.surface)
        const y = f.y(p.readoutMitigated)
        drawErrorBar(ctx, x, y, Math.abs(f.y(p.readoutMitigated + p.stderr) - y), colors.amber)
        drawDot(ctx, x, y, 4.5, colors.amber)
      }

      // Extrapolated value at λ = 0, drawn as a diamond.
      const zx = f.x(0), zy = f.y(report.zne)
      drawErrorBar(ctx, zx, zy, Math.abs(f.y(report.zne + report.zneStderr) - zy), colors.violet)
      ctx.save()
      ctx.fillStyle = colors.violet
      ctx.beginPath()
      ctx.moveTo(zx, zy - 6); ctx.lineTo(zx + 6, zy); ctx.lineTo(zx, zy + 6); ctx.lineTo(zx - 6, zy); ctx.closePath()
      ctx.fill()
      ctx.restore()

      // Legend.
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      const items: [string, string, boolean][] = [
        [colors.rose, 'raw', true],
        [colors.amber, 'readout-mitigated ± 1σ', false],
        [colors.violet, `ZNE (${report.method}) at λ = 0`, false],
      ]
      let lx = f.left + 8
      const ly = f.bottom - 12
      for (const [color, label, hollow] of items) {
        drawDot(ctx, lx, ly, 4, color, hollow, colors.surface)
        ctx.fillStyle = colors.inkSecondary
        ctx.fillText(label, lx + 9, ly)
        lx += 9 + ctx.measureText(label).width + 16
      }
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
  }, [report, observableLabel])

  const summary = report
    ? `Zero-noise extrapolation of ${observableLabel}: ideal ${report.ideal.toFixed(3)}; raw at scale 1 ${report.noisy.toFixed(3)}; readout-mitigated ${report.readoutMitigated.toFixed(3)}; extrapolated ${report.zne.toFixed(3)} plus or minus ${report.zneStderr.toFixed(3)} using the ${report.method} fit.`
    : `Zero-noise extrapolation of ${observableLabel}: running.`

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={summary}
      className="block h-[300px] w-full"
    />
  )
}
