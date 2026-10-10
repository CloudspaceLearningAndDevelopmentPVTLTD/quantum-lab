import { describe, expect, it } from 'vitest'
import { drawLatticeFallback, type FallbackPalette } from './drawLatticeFallback'
import { assertFiniteCoordinates, createStubContext } from '../canvasStub'
import { buildLattice3D, errorsFromChannels, matchingSegments } from '@/lib/qec3d/layout'
import { dataInstances, edgeInstances, stabiliserInstances } from '@/lib/qec3d/instances'
import { buildHistory, historyMatching } from '@/lib/qec3d/history'
import { describeLattice } from '../SurfaceCodeLattice3D'

/**
 * The no-WebGL path is the one nobody on the team will see by accident, so it is
 * the one most worth exercising blind: every coordinate finite, every colour a
 * colour, something actually drawn, and a zero-size canvas drawing nothing.
 */

const palette: FallbackPalette = {
  styleFill: (style) => (style.endsWith('-lit') ? '#8ae8da' : '#3d5070'),
  edgeStroke: (type) => (type === 'Z' ? '#f2a96a' : '#a99dff'),
  outline: 'rgba(125, 140, 176, 0.4)',
  label: '#7d8cb0',
}

function frameFor(d: number, stacked: boolean) {
  const lattice = buildLattice3D(d)
  const mid = Math.floor((d * d) / 2)
  const errors = errorsFromChannels(
    Array.from({ length: d * d }, (_, q) => (q === mid ? 1 : 0)),
    new Array(d * d).fill(0)
  )
  const litIds = lattice.stabilisers.filter((s) => s.qubits.includes(mid) && s.type === 'Z').map((s) => s.id)
  const flatEdges = [{ from: { stabiliser: litIds[0] }, to: { stabiliser: litIds[1] } }]
  const roundSpacing = 0.8
  const flat = stabiliserInstances(lattice, { errors, roundSpacing })
  const rounds = stacked
    ? buildHistory(
        lattice,
        flat.map((i) => i.style.endsWith('-lit')),
        { rounds: 5, errorRound: 2, blip: { stabiliser: 0, round: 3 } }
      )
    : undefined
  const edges = stacked
    ? historyMatching(flatEdges, { rounds: 5, errorRound: 2, blip: { stabiliser: 0, round: 3 } })
    : flatEdges
  return {
    lattice,
    data: dataInstances(lattice, errors),
    stabilisers: stabiliserInstances(lattice, { errors, rounds, roundSpacing }),
    edges: edgeInstances(matchingSegments(lattice, edges, roundSpacing)),
    rounds,
    roundSpacing,
  }
}

describe('drawLatticeFallback', () => {
  it('draws every marker and edge of a flat d = 5 lattice with finite coordinates', () => {
    const stub = createStubContext()
    const frame = frameFor(5, false)
    drawLatticeFallback(stub.ctx, 640, 440, frame, palette)
    assertFiniteCoordinates(stub.ops)
    expect(stub.count('clearRect')).toBe(1)
    // 25 circles + 24 diamonds filled, one matching edge stroked, one outline.
    expect(stub.count('arc')).toBe(25)
    expect(stub.count('fill')).toBe(49)
    expect(stub.count('stroke')).toBe(2)
    expect(stub.count('fillText')).toBe(0)
  })

  it('draws a stacked history: one outline per round, labels, and the vertical blip edge', () => {
    const stub = createStubContext()
    const frame = frameFor(3, true)
    drawLatticeFallback(stub.ctx, 500, 500, frame, palette)
    assertFiniteCoordinates(stub.ops)
    // 5 outlines + 2 edges + the time axis line.
    expect(stub.count('stroke')).toBe(8)
    expect(stub.count('fillText')).toBe(2)
    // 9 data + 8 × 5 stabilisers.
    expect(stub.count('fill')).toBe(9 + 40)
  })

  it('a zero-size or too-small canvas clears and draws nothing, without throwing', () => {
    for (const [w, h] of [
      [0, 0],
      [0, 440],
      [640, 0],
      [30, 30],
    ]) {
      const stub = createStubContext()
      drawLatticeFallback(stub.ctx, w, h, frameFor(7, true), palette)
      expect(stub.count('clearRect')).toBe(1)
      expect(stub.ops.length).toBe(1)
    }
  })
})

describe('describeLattice', () => {
  it('says what is placed, what is lit, and how many rounds are stacked', () => {
    const errors = errorsFromChannels([1, 0, 0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0, 0, 0])
    expect(describeLattice({ d: 3, errors })).toBe(
      'Distance-3 surface code as a 3-D lattice: 9 data qubits and 8 stabilisers. 2 errors placed: 1 X, 0 Z, 1 Y. One round, showing the syndrome of the placed errors.'
    )
    const text = describeLattice({
      d: 3,
      errors,
      rounds: [new Array(8).fill(false), [true, ...new Array(7).fill(false)]],
      matching: [{ from: { stabiliser: 0, round: 1 }, to: 'boundary' }],
    })
    expect(text).toContain('2 rounds of syndrome measurement stacked along the vertical time axis, with 1 detection event lit.')
    expect(text).toContain('drawn as 1 edge.')
    expect(describeLattice({ d: 5, syndrome: [true, true, false] })).toContain('One round; 2 stabilisers lit.')
  })
})
