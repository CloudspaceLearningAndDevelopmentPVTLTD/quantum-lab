import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { faqSchema } from '@/components/seo/schema'
import { FAQ } from './faq'

export const metadata: Metadata = pageMetadata({
  title: 'Pricing — Free Forever Core, Pay for Hardware',
  description:
    'The simulator, the visualizations, the lessons and the challenges are free forever, no account needed. Paid plans cover running circuits on real hardware.',
  path: '/pricing',
})

/**
 * The FAQ array is imported from `./faq`, the same module page.tsx renders
 * from, rather than restated here. It had to move out of page.tsx to make that
 * possible: page.tsx is `'use client'`, and a server component importing a
 * plain value from a client module gets a client-reference proxy that throws
 * when read. A second copy of six paragraphs of refund and seat policy would be
 * wrong within a month, and FAQ markup that disagrees with the visible page is
 * a structured-data violation, not a cosmetic slip.
 *
 * The answers render inside <details> elements. That still counts as visible
 * for FAQPage: the text is in the DOM and reachable by clicking. Markup for
 * answers that are not on the page at all is what the guideline forbids.
 */
export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={faqSchema(FAQ, '/pricing')} />
      {children}
    </>
  )
}
