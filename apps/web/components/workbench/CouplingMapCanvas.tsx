'use client'

import { useEffect, useRef } from 'react'
import type { CouplingMap } from '@/lib/quantum/topology'
import { TOPOLOGY_LABEL } from '@/lib/quantum/topology'

/**
 * A static drawing of the coupling map. Physical qubits are discs labelled by
 * index; edges are lines whose thickness grows with the number of SWAPs the
 * router placed on them, so a hot corridor on a line or a bridge on the
 * heavy-hex lattice stands out. Redrawn on prop change, resize and theme
 * change only — nothing animates, so reduced motion needs no special case.
 */
export default function CouplingMapCanvas({
  map,
  swapsPerEdge,
  occupied,
  title,
}: {
  map: CouplingMap
  /** key "a-b" (a < b) → SWAP count on that edge. */
  swapsPerEdge: ReadonlyMap<string, number>
  /** Physical qubits that hold a logical qubit in the initial layout. */
  occupied: ReadonlySet<number>
  title: string
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
      const ink = token('--ink', '#eef2ff')
      const inkMuted = token('--ink-muted', '#7d8cb0')
      const sky = token('--q-sky', '#6283c8')
      const rose = token('--q-rose', '#e0678f')
      const surface = token('--surface-2', '#141a2c')

      ctx.clearRect(0, 0, w, h)

      // Fit the positions into the box with a margin.
      const pad = 26
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const p of map.positions) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
      }
      const spanX = Math.max(1e-9, maxX - minX)
      const spanY = Math.max(1e-9, maxY - minY)
      const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY, 80)
      const ox = (w - spanX * scale) / 2
      const oy = (h - spanY * scale) / 2
      const pt = (q: number) => ({
        x: ox + (map.positions[q].x - minX) * scale,
        y: oy + (map.positions[q].y - minY) * scale,
      })

      let maxSwaps = 0
      for (const v of swapsPerEdge.values()) maxSwaps = Math.max(maxSwaps, v)

      // Edges.
      for (const [a, b] of map.edges) {
        const count = swapsPerEdge.get(`${a}-${b}`) ?? 0
        const pa = pt(a)
        const pb = pt(b)
        ctx.beginPath()
        ctx.moveTo(pa.x, pa.y)
        ctx.lineTo(pb.x, pb.y)
        ctx.lineCap = 'round'
        if (count > 0) {
          ctx.strokeStyle = rose
          ctx.lineWidth = 2 + (6 * count) / Math.max(1, maxSwaps)
          ctx.globalAlpha = map.kind === 'all-to-all' ? 0.9 : 1
        } else {
          ctx.strokeStyle = line
          ctx.lineWidth = map.kind === 'all-to-all' ? 1 : 2
          ctx.globalAlpha = map.kind === 'all-to-all' ? 0.5 : 1
        }
        ctx.stroke()
        ctx.globalAlpha = 1
        if (count > 0 && map.kind !== 'all-to-all') {
          ctx.fillStyle = ink
          ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const mx = (pa.x + pb.x) / 2
          const my = (pa.y + pb.y) / 2
          ctx.fillStyle = surface
          ctx.beginPath()
          ctx.arc(mx, my, 8, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = ink
          ctx.fillText(String(count), mx, my)
        }
      }

      // Qubits.
      const r = Math.max(8, Math.min(13, scale * 0.28))
      for (let q = 0; q < map.numQubits; q++) {
        const p = pt(q)
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fillStyle = occupied.has(q) ? sky : surface
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = occupied.has(q) ? sky : inkMuted
        ctx.stroke()
        ctx.fillStyle = occupied.has(q) ? '#0b1020' : inkMuted
        ctx.font = `bold ${Math.round(r * 0.9)}px ui-monospace, SFMono-Regular, Menlo, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(q), p.x, p.y + 0.5)
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    const mo =
      typeof MutationObserver === 'function'
        ? new MutationObserver(draw)
        : null
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => {
      ro.disconnect()
      mo?.disconnect()
    }
  }, [map, swapsPerEdge, occupied])

  let totalSwaps = 0
  for (const v of swapsPerEdge.values()) totalSwaps += v

  return (
    <div ref={wrapRef} className="relative h-[260px] w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={
          `${title}: ${TOPOLOGY_LABEL[map.kind]} with ${map.numQubits} physical qubits and ` +
          `${map.edges.length} edges. ${occupied.size} of them hold a logical qubit. ` +
          (totalSwaps > 0
            ? `${totalSwaps} SWAPs were placed, on ${swapsPerEdge.size} distinct edges.`
            : 'No SWAPs were placed.')
        }
      />
    </div>
  )
}
