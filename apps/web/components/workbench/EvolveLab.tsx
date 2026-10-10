'use client'

import { useEffect, useMemo, useRef } from 'react'
import { readVizColors, withAlpha, type VizColors } from '@/components/viz/theme'
import { watchThemeChange } from '@/components/viz/frameLoop'
import type { Candidate, EvolutionRun, Graph } from '@/lib/workbench/evolve'

/**
 * EvolveLab — the fitness curve and the lineage tree of one evolution run,
 * on a single canvas. Everything drawn here is read straight off the
 * `EvolutionRun` the loop in lib/workbench/evolve.ts produced; the canvas
 * holds no state of its own and repaints when the run, the selection or the
 * theme changes. Nothing animates, so prefers-reduced-motion has nothing to
 * suppress — the motion on this page is the run progressing.
 *
 * Clicking a node in the tree selects that candidate. That is a shortcut:
 * the page lists every candidate of every generation as real buttons, so the
 * keyboard route is the list, not the canvas.
 */

export const LAB_HEIGHT = 420
const PAD = 28
const CURVE_H = 150
const NODE_R = 6

/** Operator → accent. Providers are assigned in order of first appearance. */
export function operatorPalette(run: EvolutionRun | null): Map<string, keyof VizColors> {
  const map = new Map<string, keyof VizColors>([
    ['seed', 'inkMuted'],
    ['mutation', 'sky'],
  ])
  const cycle: (keyof VizColors)[] = ['violet', 'teal', 'rose', 'amber']
  if (!run) return map
  let i = 0
  for (const g of run.generations) {
    for (const c of g.population) {
      if (!map.has(c.operator)) {
        map.set(c.operator, cycle[i % cycle.length])
        i += 1
      }
    }
  }
  return map
}

interface NodePos {
  id: string
  generation: number
  x: number
  y: number
  candidate: Candidate
}

function layout(run: EvolutionRun, w: number, h: number): NodePos[] {
  const top = PAD + CURVE_H + PAD
  const bottom = h - PAD
  const gens = run.generations.length
  const colW = gens > 1 ? (w - 2 * PAD) / (gens - 1) : 0
  const nodes: NodePos[] = []
  for (const g of run.generations) {
    const n = g.population.length
    const x = gens > 1 ? PAD + g.index * colW : w / 2
    const rowH = n > 1 ? (bottom - top) / (n - 1) : 0
    g.population.forEach((c, i) => {
      nodes.push({ id: c.id, generation: g.index, x, y: n > 1 ? top + i * rowH : (top + bottom) / 2, candidate: c })
    })
  }
  return nodes
}

function render(
  ctx: CanvasRenderingContext2D,
  run: EvolutionRun | null,
  selectedId: string | null,
  colors: VizColors,
  w: number,
  h: number,
): NodePos[] {
  ctx.clearRect(0, 0, w, h)
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'

  // ── fitness curve ──
  const cx0 = PAD + 26
  const cx1 = w - PAD
  const cy0 = PAD
  const cy1 = PAD + CURVE_H
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 1
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = cy1 - t * (cy1 - cy0)
    ctx.beginPath()
    ctx.moveTo(cx0, y)
    ctx.lineTo(cx1, y)
    ctx.stroke()
    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'right'
    ctx.fillText(t.toFixed(2), cx0 - 6, y)
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('fitness per generation — best (solid) and population mean (dashed)', cx0, cy0 - 12)

  if (!run) {
    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'center'
    ctx.fillText('Run the search to see the curve and the lineage.', w / 2, (cy0 + cy1) / 2)
    ctx.textAlign = 'left'
    return []
  }

  const gens = run.generations
  const gx = (i: number) => (gens.length > 1 ? cx0 + (i / (gens.length - 1)) * (cx1 - cx0) : (cx0 + cx1) / 2)
  const gy = (f: number) => cy1 - Math.max(0, Math.min(1, f)) * (cy1 - cy0)

  ctx.setLineDash([4, 4])
  ctx.strokeStyle = withAlpha(colors.sky, 0.9)
  ctx.lineWidth = 1.5
  ctx.beginPath()
  gens.forEach((g, i) => {
    const mean = g.population.reduce((s, c) => s + c.fitness, 0) / g.population.length
    if (i === 0) ctx.moveTo(gx(i), gy(mean))
    else ctx.lineTo(gx(i), gy(mean))
  })
  ctx.stroke()
  ctx.setLineDash([])

  ctx.strokeStyle = colors.amber
  ctx.lineWidth = 2
  ctx.beginPath()
  gens.forEach((g, i) => {
    if (i === 0) ctx.moveTo(gx(i), gy(g.best.fitness))
    else ctx.lineTo(gx(i), gy(g.best.fitness))
  })
  ctx.stroke()
  gens.forEach((g, i) => {
    ctx.fillStyle = colors.amber
    ctx.beginPath()
    ctx.arc(gx(i), gy(g.best.fitness), 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = colors.inkMuted
    ctx.textAlign = 'center'
    ctx.fillText(`g${g.index}`, gx(i), cy1 + 12)
  })
  ctx.textAlign = 'left'

  // ── lineage tree ──
  const nodes = layout(run, w, h)
  const byId = new Map<string, NodePos[]>()
  for (const n of nodes) {
    const list = byId.get(n.id) ?? []
    list.push(n)
    byId.set(n.id, list)
  }
  const at = (id: string, generation: number): NodePos | undefined =>
    byId.get(id)?.find((n) => n.generation === generation)

  ctx.fillStyle = colors.inkSecondary
  ctx.fillText('lineage — each column is one generation, best at the top; lines run to parents', PAD, PAD + CURVE_H + PAD - 14)

  const palette = operatorPalette(run)
  // edges first
  for (const n of nodes) {
    if (n.generation === 0) continue
    const c = n.candidate
    const prev = n.generation - 1
    if (c.generation < n.generation) {
      // survived from the previous column unchanged
      const from = at(c.id, prev)
      if (from) {
        ctx.strokeStyle = withAlpha(colors.inkMuted, 0.35)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(n.x, n.y)
        ctx.stroke()
      }
      continue
    }
    for (const pid of c.parentIds) {
      const from = at(pid, prev)
      if (!from) continue
      const hue = colors[palette.get(c.operator) ?? 'violet']
      ctx.strokeStyle = withAlpha(hue, c.id === selectedId ? 0.95 : 0.45)
      ctx.lineWidth = c.id === selectedId ? 2 : 1
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      const mx = (from.x + n.x) / 2
      ctx.bezierCurveTo(mx, from.y, mx, n.y, n.x, n.y)
      ctx.stroke()
    }
  }
  // nodes
  for (const n of nodes) {
    const c = n.candidate
    const hue = colors[palette.get(c.operator) ?? 'violet']
    const carried = c.generation < n.generation
    ctx.beginPath()
    ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2)
    ctx.fillStyle = carried ? withAlpha(hue, 0.35) : hue
    ctx.fill()
    if (c.verified) {
      ctx.strokeStyle = colors.teal
      ctx.lineWidth = 2
      ctx.stroke()
    }
    if (c.id === selectedId) {
      ctx.strokeStyle = colors.ink
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(n.x, n.y, NODE_R + 3, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (n.generation === run.generations.length - 1) {
      ctx.fillStyle = colors.inkMuted
      ctx.textAlign = 'right'
      ctx.fillText(c.fitness.toFixed(3), n.x - NODE_R - 4, n.y)
      ctx.textAlign = 'left'
    }
  }
  return nodes
}

export function EvolveLab({
  run,
  selectedId,
  onSelect,
}: {
  run: EvolutionRun | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nodesRef = useRef<NodePos[]>([])
  const stateRef = useRef({ run, selectedId, onSelect })
  stateRef.current = { run, selectedId, onSelect }
  const colorsRef = useRef<VizColors | null>(null)
  const repaintRef = useRef<() => void>(() => {})

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let size = { w: 1, h: 1 }

    const repaint = () => {
      if (!colorsRef.current) colorsRef.current = readVizColors(wrap)
      nodesRef.current = render(ctx, stateRef.current.run, stateRef.current.selectedId, colorsRef.current, size.w, size.h)
    }
    repaintRef.current = repaint

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      size = { w, h }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      repaint()
    }
    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      let best: NodePos | null = null
      let bestD = 12
      for (const n of nodesRef.current) {
        const d = Math.hypot(n.x - x, n.y - y)
        if (d < bestD) {
          bestD = d
          best = n
        }
      }
      if (best) stateRef.current.onSelect(best.id)
    }
    canvas.addEventListener('click', onClick)
    const stopTheme = watchThemeChange(() => {
      colorsRef.current = null
      repaint()
    })
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    return () => {
      observer.disconnect()
      canvas.removeEventListener('click', onClick)
      stopTheme()
    }
  }, [])

  useEffect(() => {
    repaintRef.current()
  }, [run, selectedId])

  const label = useMemo(() => {
    if (!run) return 'Empty chart. Run the search to draw the fitness curve and the lineage tree.'
    const last = run.generations[run.generations.length - 1]
    return (
      `Fitness curve over ${run.generations.length} generations, best rising from ` +
      `${run.generations[0].best.fitness.toFixed(3)} to ${last.best.fitness.toFixed(3)}, and a lineage tree ` +
      `with one column per generation. The same candidates are listed as buttons below the chart.`
    )
  }, [run])

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: LAB_HEIGHT }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} />
    </div>
  )
}

/**
 * CutGraph — the MaxCut instance, nodes coloured by a two-side assignment,
 * cut edges drawn solid and uncut edges dashed. Static; repaints on change.
 */
export function CutGraph({
  graph,
  assignment,
  caption,
}: {
  graph: Graph
  /** Bit q of `assignment` is node q's side. null draws the bare graph. */
  assignment: number | null
  caption: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef({ graph, assignment })
  stateRef.current = { graph, assignment }
  const repaintRef = useRef<() => void>(() => {})

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let size = { w: 1, h: 1 }
    let colors: VizColors | null = null

    const repaint = () => {
      if (!colors) colors = readVizColors(wrap)
      const { graph: g, assignment: a } = stateRef.current
      const { w, h } = size
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const r = Math.min(w, h) / 2 - 18
      const pos = (i: number) => {
        const t = (i / g.n) * Math.PI * 2 - Math.PI / 2
        return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }
      }
      for (const [u, v] of g.edges) {
        const pu = pos(u)
        const pv = pos(v)
        const cut = a !== null && ((a >> u) & 1) !== ((a >> v) & 1)
        ctx.setLineDash(a !== null && !cut ? [3, 4] : [])
        ctx.strokeStyle = cut ? colors.teal : withAlpha(colors.inkMuted, a === null ? 0.7 : 0.5)
        ctx.lineWidth = cut ? 2 : 1.25
        ctx.beginPath()
        ctx.moveTo(pu.x, pu.y)
        ctx.lineTo(pv.x, pv.y)
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < g.n; i++) {
        const p = pos(i)
        const side = a === null ? -1 : (a >> i) & 1
        ctx.beginPath()
        ctx.arc(p.x, p.y, 11, 0, Math.PI * 2)
        ctx.fillStyle = side === -1 ? colors.surface2 : side === 0 ? colors.violet : colors.amber
        ctx.fill()
        ctx.strokeStyle = colors.lineStrong
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = side === -1 ? colors.ink : '#ffffff'
        ctx.fillText(String(i), p.x, p.y)
      }
    }
    repaintRef.current = repaint
    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      size = { w, h }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      repaint()
    }
    const stopTheme = watchThemeChange(() => {
      colors = null
      repaint()
    })
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    return () => {
      observer.disconnect()
      stopTheme()
    }
  }, [])

  useEffect(() => {
    repaintRef.current()
  }, [graph, assignment])

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: 200 }}>
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={caption} />
    </div>
  )
}
