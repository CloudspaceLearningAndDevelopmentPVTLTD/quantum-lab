import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ChallengeWorkbench from '@/components/challenge/ChallengeWorkbench'
import PracticeMore from './PracticeMore'
import { CHALLENGES, getChallenge } from '@/lib/challenges/catalogue'
import { pageMetadata } from '@/lib/seo'

interface PageProps {
  params: Promise<{ id: string }>
}

/** The catalogue is static data, so every challenge page prerenders at build. */
export function generateStaticParams(): { id: string }[] {
  return CHALLENGES.map((challenge) => ({ id: challenge.id }))
}

/**
 * Through `pageMetadata` for the canonical and the social tags, which the
 * hand-written version had neither of.
 *
 * The title gains "quantum circuit challenge" because the challenge titles are
 * written to be fun inside the app ("Flip it", "Golf the Bell pair") and mean
 * nothing at all as a standalone search result.
 */
export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const challenge = getChallenge(params.id)
  if (!challenge) return { title: 'Challenge not found · Qubit16' }

  return pageMetadata({
    title: `${challenge.title} — ${challenge.level} quantum circuit challenge`,
    description: `${challenge.brief} Build it in the browser; every attempt is simulated and graded as you run it.`,
    path: `/challenges/${challenge.id}`,
  })
}

export default async function ChallengePage(props: PageProps) {
  const params = await props.params;
  const challenge = getChallenge(params.id)
  if (!challenge) notFound()

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <ChallengeWorkbench challenge={challenge} />
      {/* Below rather than inside the workbench's result card: the workbench is
          a shared component owned by another feature, and this page is the
          mount the generator owns. Client-side, seeded, verified — see
          lib/challenges/generate.ts. */}
      <PracticeMore challenge={challenge} />
    </div>
  )
}
