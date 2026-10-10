import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { HOME_CRUMB, breadcrumbSchema } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'About',
  description:
    'How Qubit16 differs from a video course or a Qiskit notebook: real circuit execution, live visualization, an AI tutor. Free to start, in the browser.',
  path: '/about',
})

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbSchema([HOME_CRUMB, { name: 'About', path: '/about' }])} />
      {children}
    </>
  )
}
