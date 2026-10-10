/**
 * app/not-found.tsx — 404 for any unmatched URL.
 *
 * The catch-all 404. Every /learn, /challenges and /certify segment has its
 * own, because those know which set was searched and can offer the list; this
 * one cannot, so it offers the three places most people are trying to reach.
 */

import { NotFoundPanel } from '@/lib/observability/NotFoundPanel'

export default function NotFound() {
  return (
    <NotFoundPanel title="There is no page at that address" links={[{ href: '/', label: 'Home' }, { href: '/learn', label: 'The course' }, { href: '/simulator', label: 'The simulator' }]}>
      <p>The link may be out of date, or the address may have a typo in it. Nothing has been deleted — this app has no pages that come and go.</p>
    </NotFoundPanel>
  )
}
