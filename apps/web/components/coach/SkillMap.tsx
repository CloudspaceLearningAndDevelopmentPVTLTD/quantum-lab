'use client'

/**
 * SkillMap — the concept graph, drawn by hand in SVG.
 *
 * No chart library and no force simulation. A force layout would settle into a
 * slightly different arrangement on every mount, so the map a learner built a
 * mental model of last week would be a different picture today. Instead nodes
 * are placed by TOPOLOGICAL RANK: column = dependency depth, row = position
 * within that depth. The same graph always draws the same picture, and the
 * left-to-right axis means something — everything to the right of you is
 * downstream of what you have not learned yet.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CONCEPT_GRAPH, layerOf, topologicalOrder } from '@/lib/coach/graph'
import { MASTERY_THRESHOLD } from '@/lib/coach/recommend'

interface SkillMapProps {
  mastery: Record<string, number>
  currentSlug?: string
}

const NODE_W = 168
const NODE_H = 58
const COL_GAP = 56
const ROW_GAP = 26
const PAD = 20

// Resolved through CSS custom properties (see docs/THEMING.md) so this SVG
// re-themes for free — `fill`/`stroke` accept `var(...)` directly.
const INK_MUTED = 'var(--ink-muted)'
const VIOLET = 'var(--q-violet)'
const VIOLET_LIGHT = 'var(--q-violet-text)'
const TEAL = 'var(--q-teal)'

interface Placed {
  id: string
  label: string
  x: number
  y: number
  mastery: number
}

/** Deterministic layout: column by dependency depth, row by declaration order. */
function layout(): { placed: Placed[]; width: number; height: number } {
  const order = topologicalOrder()
  const columns = new Map<number, string[]>()
  for (const id of order) {
    const depth = layerOf(id)
    const column = columns.get(depth)
    if (column) column.push(id)
    else columns.set(depth, [id])
  }

  const depths = [...columns.keys()].sort((a, b) => a - b)
  const tallest = Math.max(1, ...depths.map((d) => (columns.get(d) ?? []).length))
  const height = PAD * 2 + tallest * NODE_H + (tallest - 1) * ROW_GAP
  const width = PAD * 2 + depths.length * NODE_W + (depths.length - 1) * COL_GAP

  const placed: Placed[] = []
  depths.forEach((depth, columnIndex) => {
    const ids = columns.get(depth) ?? []
    const blockHeight = ids.length * NODE_H + (ids.length - 1) * ROW_GAP
    const top = (height - blockHeight) / 2
    ids.forEach((id, rowIndex) => {
      const node = CONCEPT_GRAPH.find((n) => n.id === id)
      placed.push({
        id,
        label: node ? node.label : id,
        x: PAD + columnIndex * (NODE_W + COL_GAP),
        y: top + rowIndex * (NODE_H + ROW_GAP),
        mastery: 0,
      })
    })
  })

  return { placed, width, height }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function SkillMap({ mastery, currentSlug }: SkillMapProps) {
  const router = useRouter()
  const [hovered, setHovered] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  // Whether there is more graph to the right than the viewport shows right
  // now. Starts false (matches a non-JS / first-paint render, where nothing
  // has measured yet) and is re-evaluated on mount, resize, and scroll, so
  // the hint disappears once the learner has actually scrolled to the end
  // instead of nagging at a map they have already seen in full.
  const [canScrollRight, setCanScrollRight] = useState(false)
  const { placed, width, height } = useMemo(() => layout(), [])
  const nodes = placed.map((p) => ({ ...p, mastery: clamp01(mastery[p.id] ?? 0) }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const edges = CONCEPT_GRAPH.flatMap((node) =>
    node.requires.map((from) => ({ from, to: node.id }))
  )

  const hoveredNode = hovered !== null ? byId.get(hovered) : undefined

  // RESPONSIVE: on a phone the SVG is wider than the card (that is what the
  // `min-width: 640` on it and `overflow-x-auto` on the wrapper below are
  // for — every node stays reachable by a horizontal scroll), but a plain
  // `overflow-x-auto` div gives no visual sign that there is anything past
  // the right edge. This measures the gap directly rather than guessing a
  // breakpoint, so it stays correct if the graph grows past ten concepts and
  // stays silent on the desktop widths where nothing is actually clipped.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const update = () => {
      const remaining = el.scrollWidth - el.clientWidth - el.scrollLeft
      setCanScrollRight(remaining > 1)
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)

    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [width])

  const summary = nodes
    .map((n) => `${n.label} ${Math.round(n.mastery * 100)}%`)
    .join(', ')

  return (
    <div>
      {/*
        Horizontal scroll on narrow screens; the viewBox scales the rest.
        `relative` on the outer card and the fade + hint positioned inside it
        are the scroll affordance: without them `overflow-x-auto` is silent
        about there being anything past the right edge, which is how the
        first four columns of ten read as the whole graph on a phone.
      */}
      <div className="card relative overflow-hidden p-3">
        <div ref={scrollerRef} className="overflow-x-auto">
          <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minWidth: 640, height: 'auto' }}
          role="img"
          aria-label={`Dependency map of the ten Qubit16 concepts, arranged left to right in prerequisite order. Mastery: ${summary}.`}
        >
          <defs>
            {nodes.map((node) => (
              <clipPath key={node.id} id={`coach-clip-${node.id}`}>
                <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={10} />
              </clipPath>
            ))}
          </defs>

          {/* Edges first so nodes paint over them. */}
          <g fill="none">
            {edges.map((edge) => {
              const a = byId.get(edge.from)
              const b = byId.get(edge.to)
              if (!a || !b) return null
              const x1 = a.x + NODE_W
              const y1 = a.y + NODE_H / 2
              const x2 = b.x
              const y2 = b.y + NODE_H / 2
              const mid = (x1 + x2) / 2
              const live = a.mastery > 0 && b.mastery > 0
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  stroke={live ? VIOLET : INK_MUTED}
                  strokeWidth={live ? 1.6 : 1}
                  opacity={live ? 0.85 : 0.45}
                />
              )
            })}
          </g>

          {nodes.map((node) => {
            const mastered = node.mastery >= MASTERY_THRESHOLD
            const partial = node.mastery > 0 && !mastered
            const stroke = mastered ? TEAL : partial ? VIOLET : INK_MUTED
            const isCurrent = node.id === currentSlug
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                onClick={() => router.push(`/learn/${node.id}`)}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered((h) => (h === node.id ? null : h))}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  fill={mastered ? TEAL : 'var(--surface-2)'}
                  stroke={stroke}
                  strokeWidth={isCurrent ? 2.5 : 1.4}
                />
                {partial ? (
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_W * node.mastery}
                    height={NODE_H}
                    fill={VIOLET}
                    opacity={0.32}
                    clipPath={`url(#coach-clip-${node.id})`}
                  />
                ) : null}
                <text
                  x={node.x + 14}
                  y={node.y + NODE_H / 2 + 4}
                  fontSize={13}
                  fontWeight={600}
                  fill={mastered ? 'var(--bg)' : 'var(--ink)'}
                >
                  {node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}
                </text>
                {mastered ? (
                  <path
                    d={`M ${node.x + NODE_W - 28} ${node.y + NODE_H / 2} l 5 6 l 10 -13`}
                    fill="none"
                    stroke="var(--bg)"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
              </g>
            )
          })}

          {hoveredNode ? (
            <g pointerEvents="none">
              <rect
                x={Math.min(hoveredNode.x, width - 210)}
                y={Math.max(4, hoveredNode.y - 58)}
                width={206}
                height={54}
                rx={8}
                fill="var(--surface-3)"
                stroke={VIOLET}
                strokeWidth={1}
              />
              <text
                x={Math.min(hoveredNode.x, width - 210) + 12}
                y={Math.max(4, hoveredNode.y - 58) + 20}
                fontSize={12}
                fontWeight={700}
                fill="var(--ink)"
              >
                {hoveredNode.label}
              </text>
              <text
                x={Math.min(hoveredNode.x, width - 210) + 12}
                y={Math.max(4, hoveredNode.y - 58) + 36}
                fontSize={11}
                fill={VIOLET_LIGHT}
              >
                {`${Math.round(hoveredNode.mastery * 100)}% mastered`}
              </text>
              <text
                x={Math.min(hoveredNode.x, width - 210) + 12}
                y={Math.max(4, hoveredNode.y - 58) + 48}
                fontSize={10}
                fill="var(--ink-secondary)"
              >
                Click to go to lesson
              </text>
            </g>
          ) : null}
          </svg>
        </div>

        {/*
          The gradient covers the last ~24px of the card so it reads as "the
          map keeps going" rather than a stray bar; `pointer-events-none` so it
          never intercepts the scroll or click it is only there to describe.
          Hidden once `canScrollRight` goes false — scrolled to the end, or
          the graph fit without scrolling in the first place (desktop).
        */}
        {canScrollRight ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent"
          />
        ) : null}
        {canScrollRight ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-ink-secondary"
          >
            Scroll for more
            <span aria-hidden="true">→</span>
          </div>
        ) : null}
      </div>

      {/*
        The SVG is role="img", so its interior is opaque to assistive tech. This
        list is the accessible equivalent: the same ten concepts, in the same
        dependency order, with the same numbers — and real links, so the map is
        not a visual dead end for anyone using a screen reader or a keyboard.
      */}
      {/*
        A11Y (WCAG 2.4.7 Focus Visible, AA). `sr-only` on the <ol> hid ten
        genuinely focusable links: a sighted keyboard user tabbing past the map
        lost the focus ring for ten consecutive stops with nothing on screen
        moving. `sr-only` is only safe on non-focusable content. Each link now
        un-hides itself on focus, which is the standard skip-link treatment and
        the same one components/ui/SkipLink.tsx uses. The list still reads as
        visually-hidden to everyone who is not tabbing through it.
      */}
      <ol aria-label="Concepts in prerequisite order">
        {nodes.map((node) => (
          <li key={node.id} className="sr-only focus-within:not-sr-only">
            <Link
              href={`/learn/${node.id}`}
              className="focus-ring inline-block rounded bg-surface-3 px-2 py-1 text-[13px] text-ink"
            >
              {node.label} — {Math.round(node.mastery * 100)} percent mastered
            </Link>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[11px] text-ink-muted">
        Outlined means not started, a violet fill shows partial mastery, and a
        solid teal node with a check is mastered. Click any node to open its
        lesson.
      </p>
    </div>
  )
}
