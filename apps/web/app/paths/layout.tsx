import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Learning Paths: Quantum Roadmaps for Every Goal',
  description:
    'Step-by-step quantum roadmaps for where you want to go: quantum software engineer, physics student, hardware and error-correction researcher, quantum-safe security, quantum ML — or simply understanding it properly.',
  path: '/paths',
})

export default function PathsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
