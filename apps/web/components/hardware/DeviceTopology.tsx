'use client'

/**
 * DeviceTopology — a SCHEMATIC sketch of a device family's qubit connectivity.
 *
 * This is deliberately not a calibration map. The real coupling graph of a
 * 127-qubit machine is provider data that changes with every maintenance
 * window and would be unreadable at card size; what a learner needs is the
 * IDEA — heavy-hex qubits touch three neighbours, trapped ions touch all of
 * them — because that idea is why the transpiled depth next to this sketch
 * grew. The caption says "schematic" in so many words, and must keep saying
 * it: a diagram in a hardware UI is read as telemetry unless it denies it.
 *
 * All geometry lives in lib/hardware/topology.ts (pure, unit-tested); this
 * file only turns nodes and edges into themed SVG.
 */

import {
  TOPOLOGY_BLURB,
  topologyFamilyFor,
  topologySketch,
} from '@/lib/hardware/topology'

export interface DeviceTopologyProps {
  /** Backend id, e.g. 'ibm_brisbane' — the family is derived from it. */
  backend: string
  /** Real qubit count of the device, when known, for the caption. */
  qubits?: number
}

const FAMILY_LABEL: Record<string, string> = {
  'heavy-hex': 'Heavy-hex lattice',
  'square-lattice': 'Square lattice',
  'all-to-all': 'All-to-all (trapped ion)',
  linear: 'Linear chain',
}

export function DeviceTopology({ backend, qubits }: DeviceTopologyProps) {
  const family = topologyFamilyFor(backend)
  const sketch = topologySketch(family)
  const label = FAMILY_LABEL[family] ?? family

  const caption =
    typeof qubits === 'number' && qubits > 0
      ? `Schematic of the ${label.toLowerCase()} family — ${sketch.nodes.length} of ${backend}'s ${qubits} qubits shown. Not a live calibration map.`
      : `Schematic of the ${label.toLowerCase()} family. Not a live calibration map.`

  return (
    <figure className="rounded-lg border border-line bg-surface-2 p-3">
      <figcaption className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
        Device connectivity · {label}
      </figcaption>
      <svg
        viewBox="0 0 100 60"
        role="img"
        aria-label={caption}
        className="mt-2 h-auto w-full max-w-[260px]"
      >
        {sketch.edges.map(([a, b], index) => {
          const from = sketch.nodes[a]
          const to = sketch.nodes[b]
          if (!from || !to) return null
          return (
            <line
              key={`e${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--ink-muted)"
              strokeWidth={family === 'all-to-all' ? 0.5 : 1}
              strokeOpacity={family === 'all-to-all' ? 0.45 : 0.7}
            />
          )
        })}
        {sketch.nodes.map((node, index) => (
          <circle
            key={`n${index}`}
            cx={node.x}
            cy={node.y}
            r={2.6}
            fill="var(--q-violet)"
            stroke="var(--surface-2)"
            strokeWidth={0.6}
          />
        ))}
      </svg>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
        {TOPOLOGY_BLURB[family]} <span className="font-semibold">Schematic only</span> — the
        device&apos;s real coupling map and calibration live in the provider&apos;s dashboard.
      </p>
    </figure>
  )
}

export default DeviceTopology
