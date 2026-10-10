import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'GPU Simulator',
  description:
    'Run a circuit on CPU (float64) and GPU (float32) via WebGPU: wall time, the largest statevector each reaches under budget, and the float32-vs-float64 gap.',
  path: '/workbench/gpu-simulator',
})

export default function GpuSimulatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/gpu-simulator')} />
      {children}
    </>
  )
}
