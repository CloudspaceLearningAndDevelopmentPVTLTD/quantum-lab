import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

/**
 * Records are fetched client-side from a store that may be in-process memory,
 * so the metadata is generic and the page is not indexed: a URL that resolves
 * on one instance and 404s on another is not a page a crawler should keep.
 */
export const metadata: Metadata = pageMetadata({
  title: 'Experiment Record',
  description:
    'One experiment an agent ran over MCP: hypothesis, every circuit with its target and counts, and the conclusion.',
  path: '/workbench/experiments',
  noIndex: true,
})

export default function ExperimentRecordLayout({ children }: { children: React.ReactNode }) {
  return children
}
