import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Circuit Equivalence Checker',
  description:
    'A pass/fail verdict and process fidelity for whether two OpenQASM circuits are the same unitary, up to global phase — paste both, get a number.',
  path: '/workbench/equivalence',
})

export default function WorkbenchEquivalenceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/equivalence')} />
      {children}
    </>
  )
}
