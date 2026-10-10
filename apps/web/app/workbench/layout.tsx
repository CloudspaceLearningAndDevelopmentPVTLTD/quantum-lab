import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'AI Workbench for Quantum Developers',
  description:
    'Generate verified circuits, train error decoders, route onto real topologies, mitigate noise and run agent experiments — on the engines the course uses.',
  path: '/workbench',
})

/**
 * This layout wraps every /workbench/<tool> route as well as the index, so the
 * ItemList belongs in the index PAGE, not here — see app/workbench/page.tsx.
 */
export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return children
}
