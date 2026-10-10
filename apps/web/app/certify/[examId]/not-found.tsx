/**
 * app/certify/[examId]/not-found.tsx — 404 for an unknown exam id.
 *
 * Thrown by app/certify/[examId]/page.tsx. The second sentence exists because a
 * candidate who lands here mid-attempt will assume their attempt is gone; it is
 * not. It is a row on our side, keyed to a real exam id and to them, and it is
 * still running — including its clock.
 */

import { NotFoundPanel } from '@/lib/observability/NotFoundPanel'

export default function NotFound() {
  return (
    <NotFoundPanel title="There is no exam with that id" links={[{ href: '/certify', label: 'The exams' }, { href: '/challenges', label: 'Practise first' }]}>
      <p>Only the certification exams listed on the exams page exist. If you were resuming an attempt, it is recorded on our side against a valid exam id and is still there — this address just is not one. Its clock is still running, so go back and pick the exam you started.</p>
    </NotFoundPanel>
  )
}
