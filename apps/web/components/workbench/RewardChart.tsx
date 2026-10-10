'use client'

import { useEffect, useRef } from 'react'

/**
 * Per-episode reward with a 20-episode moving average, against the heuristic
 * line at −1. Repaints only when the data changes; nothing animates.
 */
export default function RewardChart({
  rewards,
  maxEpisodes,
}: {
  rewards: readonly number[]
  maxEpisodes: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = (): void => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const css = window.getComputedStyle(wrap)
      const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
      const line = token('--line-strong', 'rgba(128,128,128,0.4)')
      const inkMuted = token('--ink-muted', '#7d8cb0')
      const sky = token('--q-sky', '#6283c8')
      const amber = token('--q-amber', '#e0a33c')

      ctx.clearRect(0, 0, w, h)
      const padL = 36, padR = 8, padT = 8, padB = 20
      const plotW = w - padL - padR
      const plotH = h - padT - padB

      // y range: around −1, wide enough for the data.
      let lo = -1.3, hi = -0.7
      for (const r of rewards) { lo = Math.min(lo, r); hi = Math.max(hi, r) }
      lo = Math.floor(lo * 10) / 10 - 0.05
      hi = Math.ceil(hi * 10) / 10 + 0.05
      const n = Math.max(maxEpisodes, rewards.length, 2)
      const x = (i: number) => padL + (i / (n - 1)) * plotW
      const y = (v: number) => padT + ((hi - v) / (hi - lo)) * plotH

      // Axes and the heuristic line.
      ctx.strokeStyle = line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padL, padT)
      ctx.lineTo(padL, padT + plotH)
      ctx.lineTo(padL + plotW, padT + plotH)
      ctx.stroke()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = amber
      ctx.beginPath()
      ctx.moveTo(padL, y(-1))
      ctx.lineTo(padL + plotW, y(-1))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = inkMuted
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText('−1', padL - 4, y(-1))
      ctx.fillText(hi.toFixed(1), padL - 4, y(hi))
      ctx.fillText(lo.toFixed(1), padL - 4, y(lo))
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('episode', padL + plotW / 2, padT + plotH + 6)

      // Raw rewards as faint dots.
      ctx.fillStyle = sky
      ctx.globalAlpha = 0.35
      for (let i = 0; i < rewards.length; i++) {
        ctx.beginPath()
        ctx.arc(x(i), y(rewards[i]), 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // Moving average.
      if (rewards.length >= 2) {
        ctx.strokeStyle = sky
        ctx.lineWidth = 2
        ctx.beginPath()
        let sum = 0
        const win = 20
        for (let i = 0; i < rewards.length; i++) {
          sum += rewards[i]
          if (i >= win) sum -= rewards[i - win]
          const avg = sum / Math.min(win, i + 1)
          if (i === 0) ctx.moveTo(x(i), y(avg))
          else ctx.lineTo(x(i), y(avg))
        }
        ctx.stroke()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(draw) : null
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => {
      ro.disconnect()
      mo?.disconnect()
    }
  }, [rewards, maxEpisodes])

  const last = rewards.length ? rewards.slice(-20) : []
  const recent = last.length ? last.reduce((a, b) => a + b, 0) / last.length : null

  return (
    <div ref={wrapRef} className="relative h-[160px] w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={
          rewards.length === 0
            ? 'Reward chart, empty: no episodes yet.'
            : `Reward chart over ${rewards.length} episodes. The heuristic scores −1. ` +
              `The last twenty episodes average ${recent!.toFixed(3)}.`
        }
      />
    </div>
  )
}
