/**
 * circuitImage.ts — render a Circuit as a static image (SVG / PNG) or as
 * quantikz LaTeX, for pasting into a paper or a slide.
 *
 * This is deliberately NOT the same code path as CircuitGrid.tsx (the
 * editable on-screen grid): CircuitGrid renders interactive React/SVG with
 * CSS-variable colors, hover states, and click targets. An exported image has
 * none of that — it is a flat, standalone document meant to be pasted
 * somewhere else (a paper, a slide, a README), so it resolves CSS variables
 * down to a clean black/white/gray palette that reads well printed or
 * embedded, rather than trying to replicate every on-screen pixel. It reuses
 * `lib/quantum/circuitLayout.ts`'s geometry constants so a gate's column/row
 * lines up with where CircuitGrid puts it, which is what makes the export
 * "recognizably the same circuit" rather than a from-scratch redraw.
 *
 * Three independent, pure, string-producing entry points
 * (renderCircuitSvg, renderCircuitQuantikz) plus two small browser-only
 * helpers (svgToPngDataUrl, copyToClipboard) that ExportPanel.tsx wires up to
 * download buttons.
 */

import type { Circuit, GateName, GateOp } from '@/lib/quantum'
import { GATE_BY_NAME, blockLabel, BLOCK_GATES } from '@/lib/quantum'
import { BOX, COL_W, LABEL_W, PAD_BOTTOM, PAD_TOP, ROW_H, colX, rowY } from '@/lib/quantum/circuitLayout'

// ────────────────────────────────────────────────────────────
// Shared palette — literal colors, not CSS variables. An exported PNG/SVG
// can't resolve `var(--q-violet)` once it leaves the app's stylesheet, and a
// figure pasted into a paper wants print-safe ink anyway, not the app's
// dark-mode-aware hues. One gray/black palette, differentiated by a little
// fill on controlled/measurement glyphs rather than by hue.
// ────────────────────────────────────────────────────────────

const INK = '#111111'
const INK_MUTED = '#666666'
const WIRE = '#333333'
const BOX_FILL = '#f4f4f5'
const BOX_STROKE = '#111111'
const BG = '#ffffff'

// ────────────────────────────────────────────────────────────
// renderCircuitSvg
// ────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Column index each op occupies. Mirrors CircuitGrid's simple "op i -> column i" layout. */
function opColumn(i: number): number {
  return i
}

function gateShortLabel(op: GateOp): string {
  if (op.name === 'UNITARY') return (op.label ?? 'U').slice(0, 4)
  if (BLOCK_GATES.has(op.name)) return blockLabel(op)
  const spec = GATE_BY_NAME[op.name]
  return spec?.label ?? op.name
}

/** A single named-gate box, e.g. H, X, RX(θ), U3, RESET, POSTSELECT, or a 1-qubit UNITARY. */
function renderSingleBox(op: GateOp, x: number, elements: string[]): void {
  const y = rowY(op.qubits[0])
  const spec = GATE_BY_NAME[op.name]
  let label = gateShortLabel(op)
  let sub = ''
  if (op.name === 'RESET') label = 'R'
  else if (op.name === 'POSTSELECT') label = `<${op.postselectValue ?? 0}|`
  else if (op.name === 'U3') sub = `${fmtAngle(op.theta)},${fmtAngle(op.phi)},${fmtAngle(op.lambda)}`
  else if (spec?.hasAngle && op.theta !== undefined) sub = fmtAngle(op.theta)

  // extraControls: draw a connecting line + control dot per extra control,
  // same visual grammar as CircuitGrid (filled dot = Z/positive, open ring =
  // anything else), with a small basis letter when it isn't Z.
  for (const ctrl of op.extraControls ?? []) {
    const cy = rowY(ctrl.qubit)
    elements.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${cy}" stroke="${WIRE}" stroke-width="2"/>`)
  }

  elements.push(
    `<rect x="${x - BOX / 2}" y="${y - BOX / 2}" width="${BOX}" height="${BOX}" rx="6" fill="${BOX_FILL}" stroke="${BOX_STROKE}" stroke-width="1.5"/>`
  )
  elements.push(
    `<text x="${x}" y="${sub ? y - 1 : y + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${INK}" font-family="monospace">${escapeXml(label)}</text>`
  )
  if (sub) {
    elements.push(
      `<text x="${x}" y="${y + 12}" text-anchor="middle" font-size="8" fill="${INK_MUTED}" font-family="monospace">${escapeXml(sub)}</text>`
    )
  }

  for (const ctrl of op.extraControls ?? []) {
    const cy = rowY(ctrl.qubit)
    const basis = ctrl.basis ?? 'Z'
    const anti = ctrl.anti ?? false
    const plain = basis === 'Z' && !anti
    if (plain) {
      elements.push(`<circle cx="${x}" cy="${cy}" r="5" fill="${INK}"/>`)
    } else {
      elements.push(`<circle cx="${x}" cy="${cy}" r="5" fill="${BG}" stroke="${INK}" stroke-width="2"/>`)
    }
    if (basis !== 'Z') {
      elements.push(
        `<text x="${x + 9}" y="${cy + 3}" font-size="8" font-weight="700" fill="${INK}" font-family="monospace">${basis}</text>`
      )
    }
  }
}

function fmtAngle(theta: number | undefined): string {
  if (theta === undefined) return ''
  const v = theta / Math.PI
  if (Math.abs(v) < 1e-9) return '0'
  return `${v.toFixed(2)}π`
}

/** Filled control dot connected to a target glyph — CX/CY/CZ/CCX/MCX. */
function renderControlled(op: GateOp, x: number, elements: string[]): void {
  const qs = op.qubits
  const target = qs[qs.length - 1]
  const controls = qs.slice(0, qs.length - 1)
  const ys = qs.map(rowY)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  const yTarget = rowY(target)

  elements.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${WIRE}" stroke-width="2"/>`)
  for (const cq of controls) {
    elements.push(`<circle cx="${x}" cy="${rowY(cq)}" r="5" fill="${INK}"/>`)
  }
  if (op.name === 'CZ') {
    elements.push(`<circle cx="${x}" cy="${yTarget}" r="5" fill="${INK}"/>`)
  } else if (op.name === 'CY') {
    elements.push(`<circle cx="${x}" cy="${yTarget}" r="11" fill="${BG}" stroke="${INK}" stroke-width="2"/>`)
    elements.push(`<text x="${x}" y="${yTarget + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}" font-family="monospace">Y</text>`)
  } else {
    // CX / CCX / MCX: the standard ⊕ target glyph.
    elements.push(`<circle cx="${x}" cy="${yTarget}" r="11" fill="${BG}" stroke="${INK}" stroke-width="2"/>`)
    elements.push(`<line x1="${x - 11}" y1="${yTarget}" x2="${x + 11}" y2="${yTarget}" stroke="${INK}" stroke-width="2"/>`)
    elements.push(`<line x1="${x}" y1="${yTarget - 11}" x2="${x}" y2="${yTarget + 11}" stroke="${INK}" stroke-width="2"/>`)
  }
}

/** X-shaped crosses connected by a vertical line — SWAP / CSWAP. */
function renderSwapLike(op: GateOp, x: number, elements: string[]): void {
  const cross = (cx: number, cy: number) => {
    elements.push(
      `<path d="M ${cx - 7} ${cy - 7} L ${cx + 7} ${cy + 7} M ${cx + 7} ${cy - 7} L ${cx - 7} ${cy + 7}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`
    )
  }
  if (op.name === 'SWAP') {
    const [a, b] = op.qubits
    const ya = rowY(a), yb = rowY(b)
    elements.push(`<line x1="${x}" y1="${ya}" x2="${x}" y2="${yb}" stroke="${WIRE}" stroke-width="2"/>`)
    cross(x, ya)
    cross(x, yb)
  } else {
    // CSWAP: control dot + two crosses.
    const [ctl, a, b] = op.qubits
    const ys = op.qubits.map(rowY)
    const top = Math.min(...ys), bottom = Math.max(...ys)
    elements.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${WIRE}" stroke-width="2"/>`)
    elements.push(`<circle cx="${x}" cy="${rowY(ctl)}" r="5" fill="${INK}"/>`)
    cross(x, rowY(a))
    cross(x, rowY(b))
  }
}

/** Register block (ADDK/MULK/QFT/IQFT) or a 2-qubit UNITARY: a tall labeled box over the register. */
function renderBlock(op: GateOp, x: number, elements: string[]): void {
  const nControls = BLOCK_GATES.has(op.name) ? (op.controls ?? 0) : 0
  const controls = op.qubits.slice(0, nControls)
  const register = op.qubits.slice(nControls)
  const regYs = register.map(rowY)
  const top = Math.min(...regYs) - BOX / 2
  const bottom = Math.max(...regYs) + BOX / 2
  const allYs = op.qubits.map(rowY)
  const lineTop = Math.min(...allYs)
  const lineBottom = Math.max(...allYs)
  const W = 46
  const label = op.name === 'UNITARY' ? (op.label ?? 'U') : blockLabel(op)

  if (controls.length) {
    elements.push(`<line x1="${x}" y1="${lineTop}" x2="${x}" y2="${lineBottom}" stroke="${WIRE}" stroke-width="2"/>`)
  }
  for (const cq of controls) {
    elements.push(`<circle cx="${x}" cy="${rowY(cq)}" r="5" fill="${INK}"/>`)
  }
  elements.push(
    `<rect x="${x - W / 2}" y="${top}" width="${W}" height="${bottom - top}" rx="7" fill="${BOX_FILL}" stroke="${BOX_STROKE}" stroke-width="1.5"/>`
  )
  const midY = (top + bottom) / 2
  elements.push(
    `<text x="${x}" y="${midY + 4}" text-anchor="middle" font-size="${label.length > 6 ? 8 : 11}" font-weight="700" fill="${INK}" font-family="monospace">${escapeXml(label)}</text>`
  )
}

/** Dashed vertical line across every qubit wire — BARRIER. */
function renderBarrier(numQubits: number, x: number, elements: string[]): void {
  const top = PAD_TOP + 6
  const bottom = PAD_TOP + numQubits * ROW_H - 6
  elements.push(
    `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${INK_MUTED}" stroke-width="2" stroke-dasharray="5 4"/>`
  )
}

/** Box + arc-and-needle "meter" glyph — MEASURE. */
function renderMeasure(op: GateOp, x: number, elements: string[]): void {
  const y = rowY(op.qubits[0])
  elements.push(
    `<rect x="${x - BOX / 2}" y="${y - BOX / 2}" width="${BOX}" height="${BOX}" rx="6" fill="${BOX_FILL}" stroke="${BOX_STROKE}" stroke-width="1.5"/>`
  )
  elements.push(
    `<path d="M ${x - 9} ${y + 6} A 9 9 0 0 1 ${x + 9} ${y + 6}" fill="none" stroke="${INK}" stroke-width="1.6"/>`
  )
  elements.push(
    `<line x1="${x}" y1="${y + 6}" x2="${x + 6.5}" y2="${y - 4}" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`
  )
}

const KNOWN_GATE_NAMES: ReadonlySet<GateName> = new Set<GateName>([
  'H', 'X', 'Y', 'Z', 'S', 'SDG', 'T', 'TDG',
  'RX', 'RY', 'RZ', 'P',
  'CX', 'CY', 'CZ', 'SWAP', 'CCX',
  'MEASURE', 'BARRIER',
  'SX', 'SXDG', 'CSWAP', 'MCX', 'UNITARY',
  'ADDK', 'MULK', 'QFT', 'IQFT',
  'RESET', 'POSTSELECT', 'U3',
])

/**
 * Render one op's glyph into `elements` at its column. Throws for any
 * GateName this module does not recognize — silently skipping an op would
 * hand back an image that looks complete but is missing a gate, which is
 * worse than an error (see the module header on `lib/quantum.ts` for why
 * this codebase treats a plausible-looking wrong answer as the failure mode
 * to avoid).
 */
function renderOp(op: GateOp, col: number, numQubits: number, elements: string[]): void {
  if (!KNOWN_GATE_NAMES.has(op.name)) {
    throw new Error(`renderCircuitSvg: unrecognized gate "${op.name}"`)
  }
  const x = colX(col)
  if (op.name === 'BARRIER') return renderBarrier(numQubits, x, elements)
  if (op.name === 'MEASURE') return renderMeasure(op, x, elements)
  if (op.name === 'SWAP' || op.name === 'CSWAP') return renderSwapLike(op, x, elements)
  if (BLOCK_GATES.has(op.name) || (op.name === 'UNITARY' && op.qubits.length === 2)) {
    return renderBlock(op, x, elements)
  }
  if (op.name === 'CX' || op.name === 'CY' || op.name === 'CZ' || op.name === 'CCX' || op.name === 'MCX') {
    return renderControlled(op, x, elements)
  }
  // Everything else (H, X, Y, Z, S, SDG, T, TDG, RX, RY, RZ, P, SX, SXDG, U3,
  // RESET, POSTSELECT, a 1-qubit UNITARY): a single labeled box, possibly
  // with extraControls drawn alongside it.
  return renderSingleBox(op, x, elements)
}

/**
 * Render a Circuit as a complete, standalone SVG document: one horizontal
 * wire per qubit and one glyph per op, in the same column/row positions
 * CircuitGrid.tsx draws them in on screen (both import `circuitLayout.ts`),
 * but in a fixed black/white/gray palette suitable for printing or pasting
 * into a paper rather than the app's CSS-variable theme.
 */
export function renderCircuitSvg(circuit: Circuit, options?: { title?: string }): string {
  const { numQubits, ops } = circuit
  const title = options?.title
  const titleH = title ? 24 : 0
  const numCols = Math.max(ops.length, 1)
  const width = LABEL_W + numCols * COL_W + 24
  const height = PAD_TOP + numQubits * ROW_H + PAD_BOTTOM + titleH

  const elements: string[] = []

  // Wires, one per qubit, labeled q0, q1, ...
  for (let q = 0; q < numQubits; q++) {
    const y = rowY(q) + titleH
    elements.push(
      `<text x="${LABEL_W - 10}" y="${y + 4}" text-anchor="end" font-size="12" font-weight="700" fill="${INK}" font-family="monospace">q${q}</text>`
    )
    elements.push(
      `<line x1="${LABEL_W}" y1="${y}" x2="${width - 12}" y2="${y}" stroke="${WIRE}" stroke-width="1.5"/>`
    )
  }

  // Ops, one glyph per op, shifted down by the title's height so wires and
  // glyphs stay in registration with each other.
  const opElements: string[] = []
  ops.forEach((op, i) => {
    renderOp(op, opColumn(i), numQubits, opElements)
  })
  // Shift every op glyph down by titleH by wrapping them in a <g transform>.
  if (titleH) {
    elements.push(`<g transform="translate(0, ${titleH})">${opElements.join('')}</g>`)
  } else {
    elements.push(...opElements)
  }

  const titleEl = title
    ? `<text x="${width / 2}" y="16" text-anchor="middle" font-size="13" font-weight="700" fill="${INK}" font-family="sans-serif">${escapeXml(title)}</text>`
    : ''

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${BG}"/>`,
    titleEl,
    ...elements,
    `</svg>`,
  ].join('\n')
}

// ────────────────────────────────────────────────────────────
// svgToPngDataUrl — browser only
// ────────────────────────────────────────────────────────────

/**
 * Rasterize an SVG string to a PNG data URL via an off-screen Image + canvas.
 * Client-side only: `Image`/`document`/canvas do not exist server-side, and
 * calling this during SSR or in a test would fail confusingly deep inside
 * the DOM APIs rather than with a clear message, so that check is explicit.
 */
export async function svgToPngDataUrl(svgString: string, scale = 2): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('svgToPngDataUrl can only run in a browser (needs Image/canvas)')
  }

  const match = svgString.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  const vbWidth = match ? parseFloat(match[1]) : 600
  const vbHeight = match ? parseFloat(match[2]) : 400

  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('svgToPngDataUrl: the SVG failed to load as an image'))
      image.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(vbWidth * scale))
    canvas.height = Math.max(1, Math.round(vbHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('svgToPngDataUrl: canvas 2D context is unavailable')
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ────────────────────────────────────────────────────────────
// renderCircuitQuantikz
// ────────────────────────────────────────────────────────────

function texEscape(s: string): string {
  return s.replace(/\\/g, '\\textbackslash{}').replace(/[&%$#_{}~^]/g, (ch) => `\\${ch}`)
}

/** One quantikz cell for a single-qubit named gate, angle included when relevant. */
function quantikzGateCell(op: GateOp): string {
  const spec = GATE_BY_NAME[op.name]
  let label = spec?.label ?? op.name
  if (op.name === 'U3') {
    label = `U3(${fmtAngle(op.theta)},${fmtAngle(op.phi)},${fmtAngle(op.lambda)})`
  } else if (op.name === 'RESET') {
    label = 'RESET'
  } else if (op.name === 'POSTSELECT') {
    label = `\\langle ${op.postselectValue ?? 0}|`
  } else if (spec?.hasAngle && op.theta !== undefined) {
    label = `${op.name}(${fmtAngle(op.theta)})`
  } else if (op.name === 'UNITARY') {
    label = (op.label ?? 'U').slice(0, 6)
  }
  return `\\gate{${texEscape(label)}}`
}

/**
 * Emit `numQubits` quantikz rows (one `&`-separated cell list per row,
 * joined with `\\`), placing each op's cells at its column. Every column not
 * touched by an op gets `\qw` (an idle wire segment) on every row, which is
 * quantikz's own convention for "nothing happens here".
 *
 * `\ctrl{n}` / `\targ{}`: quantikz's ctrl command takes the row offset (in
 * rows, not absolute index) FROM the control TO the target as its argument —
 * positive when the target is below the control, negative when above. A
 * multi-control gate (CCX/MCX) needs a `\ctrl{n}` on every control row, each
 * pointing at the NEXT control or the target in sequence, so the chained
 * offsets thread through every control row down to the target.
 */
export function renderCircuitQuantikz(circuit: Circuit, options?: { title?: string }): string {
  const { numQubits, ops } = circuit
  const rows: string[][] = Array.from({ length: numQubits }, () => [])

  ops.forEach((op) => {
    if (!KNOWN_GATE_NAMES.has(op.name)) {
      throw new Error(`renderCircuitQuantikz: unrecognized gate "${op.name}"`)
    }
    const touched = new Set(op.qubits)
    if (op.name === 'BARRIER') {
      // quantikz has no dashed-barrier primitive without extra packages;
      // \qw everywhere is the honest, always-compilable rendering.
      for (let q = 0; q < numQubits; q++) rows[q].push('\\qw')
      return
    }
    if (op.name === 'MEASURE') {
      rows[op.qubits[0]].push('\\meter{}')
      for (let q = 0; q < numQubits; q++) if (q !== op.qubits[0]) rows[q].push('\\qw')
      return
    }
    if (op.name === 'SWAP' || op.name === 'CSWAP') {
      const cellFor = (q: number): string => {
        if (op.name === 'SWAP') {
          const [a, b] = op.qubits
          if (q === a) return `\\swap{${b - a}}`
          if (q === b) return `\\targX{}`
          return '\\qw'
        }
        const [ctl, a, b] = op.qubits
        if (q === ctl) return `\\ctrl{${a - ctl}}`
        if (q === a) return `\\swap{${b - a}}`
        if (q === b) return `\\targX{}`
        return '\\qw'
      }
      for (let q = 0; q < numQubits; q++) rows[q].push(cellFor(q))
      return
    }
    if (op.name === 'CX' || op.name === 'CY' || op.name === 'CZ' || op.name === 'CCX' || op.name === 'MCX') {
      const qs = op.qubits
      const target = qs[qs.length - 1]
      const controls = qs.slice(0, qs.length - 1)
      const chain = [...controls, target]
      for (let q = 0; q < numQubits; q++) {
        if (!touched.has(q)) {
          rows[q].push('\\qw')
          continue
        }
        if (q === target) {
          rows[q].push(op.name === 'CZ' ? `\\control{}` : '\\targ{}')
          continue
        }
        const idx = chain.indexOf(q)
        const next = chain[idx + 1]
        rows[q].push(op.name === 'CZ' ? `\\control{}` : `\\ctrl{${next - q}}`)
      }
      return
    }
    if (BLOCK_GATES.has(op.name) || (op.name === 'UNITARY' && op.qubits.length === 2)) {
      const nControls = BLOCK_GATES.has(op.name) ? (op.controls ?? 0) : 0
      const controls = op.qubits.slice(0, nControls)
      const register = op.qubits.slice(nControls)
      const label = op.name === 'UNITARY' ? (op.label ?? 'U') : blockLabel(op)
      const top = Math.min(...register)
      for (let q = 0; q < numQubits; q++) {
        if (controls.includes(q)) {
          rows[q].push(`\\ctrl{${top - q}}`)
        } else if (q === top) {
          rows[q].push(`\\gate[${register.length}]{${texEscape(label)}}`)
        } else if (register.includes(q)) {
          rows[q].push('\\qw')
        } else {
          rows[q].push('\\qw')
        }
      }
      return
    }
    // Single-qubit gate, possibly with extraControls.
    const target = op.qubits[0]
    const extra = op.extraControls ?? []
    for (let q = 0; q < numQubits; q++) {
      if (q === target) {
        rows[q].push(quantikzGateCell(op))
      } else {
        const ec = extra.find((c) => c.qubit === q)
        if (ec) {
          // quantikz's \ctrl has no built-in basis/anti annotation — see the
          // header comment on this limitation.
          rows[q].push(`\\ctrl{${target - q}}`)
        } else {
          rows[q].push('\\qw')
        }
      }
    }
  })

  const body = rows.map(
    (cells, q) => `\\lstick{$q_{${q}}$} & ${[...cells, '\\qw'].join(' & ')} \\\\`
  )

  const header = [
    '% Requires the quantikz package (\\usepackage{quantikz} or \\usepackage{tikz} + quantikz.tex).',
    '% extraControls (X/Y-basis or anti controls) render as a plain \\ctrl line — quantikz has no',
    '% built-in open/basis-control glyph, so that distinction is lost here; it is an honest',
    "% simplification, not a bug. RESET/POSTSELECT/U3/a custom UNITARY render as a plain \\gate{}",
    '% box with a text label for the same reason: an exact quantikz idiom does not exist for them.',
    '%',
    '% Minimal compilable example:',
    '% \\documentclass{standalone}',
    '% \\usepackage{tikz}',
    '% \\usepackage{quantikz}',
    '% \\begin{document}',
    '% \\begin{quantikz}',
    '%   ...',
    '% \\end{quantikz}',
    '% \\end{document}',
  ]
  if (options?.title) header.push(`% ${texEscape(options.title)}`)

  return [...header, '\\begin{quantikz}', ...body, '\\end{quantikz}'].join('\n')
}

// ────────────────────────────────────────────────────────────
// copyToClipboard — browser only
// ────────────────────────────────────────────────────────────

/** Copy text to the clipboard. Client-side only, with a clear error when the API is unavailable. */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) {
    throw new Error('copyToClipboard: the Clipboard API is unavailable in this environment')
  }
  await navigator.clipboard.writeText(text)
}
