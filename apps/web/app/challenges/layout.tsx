import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Quantum Coding Challenges and Puzzles',
  description:
    'LeetCode-style quantum puzzles: reach a target state, golf the gate count, repair a broken circuit. Every attempt is simulated and graded locally.',
  path: '/challenges',
})

export default function ChallengesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
