'use client'

/**
 * SignInLink — "Sign in" that comes back here afterwards.
 *
 * Every in-page sign-in prompt should use this rather than a bare
 * `<Link href="/account">`: the account page reads `?next=` and, once the
 * visitor is signed in, returns them to the page they were on (see AuthPanel).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { signInHref } from '@/components/auth/AccountButton'
import { useSession } from '@/components/auth/useSession'

export function SignInLink({
  className = 'focus-ring font-semibold text-q-violet-text underline underline-offset-2',
  next,
  children = 'Sign in',
}: {
  className?: string
  /** Where to return to; defaults to the current page. */
  next?: string
  children?: ReactNode
}) {
  const pathname = usePathname()
  return (
    <Link href={signInHref(next ?? pathname)} className={className}>
      {children}
    </Link>
  )
}

export default SignInLink

/**
 * "Already on a plan? Sign in" — for paywalls. A subscriber who is simply
 * signed out on this device used to see only "See plans", which reads as
 * "pay again". Renders nothing when accounts are off, while the session is
 * loading, or when someone is already signed in.
 */
export function AlreadySubscribedPrompt({ className = 'mt-3 text-[13px] text-ink-secondary' }: { className?: string }) {
  const { user, loading, configured } = useSession()
  if (!configured || loading || user) return null
  return (
    <p className={className}>
      Already have a plan? <SignInLink /> to use it here.
    </p>
  )
}
