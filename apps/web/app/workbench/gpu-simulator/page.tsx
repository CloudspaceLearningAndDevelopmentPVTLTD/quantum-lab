'use client'

import Link from 'next/link'
import GpuSimulatorLab, { GpuSimulatorExplainers } from '@/components/workbench/GpuSimulatorLab'

/**
 * /workbench/gpu-simulator — the same circuit on the CPU and on the GPU.
 *
 * The lab is a client component that owns a WebGPU device for its lifetime;
 * the page is the shell around it. Copy that states the limits (float32,
 * browser support, 2^N × 8 bytes) lives in GpuSimulatorExplainers so the
 * numbers and the words that qualify them ship together.
 */
export default function GpuSimulatorPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <div className="mb-8">
        <span className="pill border border-q-rose/30 bg-q-rose/15 text-q-rose-text">Run</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">GPU Simulator</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">
          Pick a circuit and a size, run it on your CPU in float64 and on your GPU in float32, and see the wall
          time, the most probable states, the largest statevector each can hold under a stated budget, and exactly
          how far the two answers drift apart. Chrome, Edge and Safari 17+; Firefox behind a flag; CPU-only
          everywhere else.
        </p>
      </div>

      <GpuSimulatorLab />

      <div className="mt-10 max-w-3xl">
        <GpuSimulatorExplainers />
      </div>
    </div>
  )
}
