/**
 * app/learn/[slug]/not-found.tsx — 404 for an unknown lesson slug.
 *
 * Thrown by app/learn/[slug]/page.tsx when the slug is not in lib/lessons. The
 * set is small, local and complete, so 'see every lesson' is a real answer
 * rather than a consolation link.
 */

import { NotFoundPanel } from '@/lib/observability/NotFoundPanel'

export default function NotFound() {
  return (
    <NotFoundPanel title="There is no lesson by that name" links={[{ href: '/learn', label: 'See every lesson' }, { href: '/coach', label: 'What to study next' }]}>
      <p>The course is a fixed set of lessons, and the address you followed is not one of them. The link is probably out of date rather than the lesson missing — no lesson has ever been removed.</p>
    </NotFoundPanel>
  )
}
