/**
 * app/challenges/[id]/not-found.tsx — 404 for an unknown challenge id.
 *
 * Thrown by app/challenges/[id]/page.tsx. Same argument as the lesson 404: a
 * known, local, complete set means the list is the answer.
 */

import { NotFoundPanel } from '@/lib/observability/NotFoundPanel'

export default function NotFound() {
  return (
    <NotFoundPanel title="There is no challenge with that id" links={[{ href: '/challenges', label: 'All challenges' }, { href: '/simulator', label: 'Open the simulator' }]}>
      <p>The challenge set is fixed and this id is not in it. Nothing has been removed — the link is most likely from an older version of the app.</p>
    </NotFoundPanel>
  )
}
