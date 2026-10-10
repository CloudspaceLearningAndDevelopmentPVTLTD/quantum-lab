'use client'

/**
 * AccountButton — the header's sign-in entry point and signed-in indicator.
 *
 * Before this existed the only way to sign in was "More → About → Account",
 * and nothing in the header ever said whether you were signed in. Signed out
 * it is a "Sign in" link that returns to the current page afterwards; signed
 * in it is the account's initial, linking to /account (where sign-out lives).
 *
 * Renders nothing when accounts are not configured, and nothing while the
 * session is still being read, so there is no "Sign in" flash for a visitor
 * who is already signed in.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from '@/components/auth/useSession'

export function signInHref(pathname: string | null | undefined): string {
  if (!pathname || pathname === '/' || pathname.startsWith('/account')) return '/account'
  return `/account?next=${encodeURIComponent(pathname)}`
}

export function AccountButton({ variant = 'bar' }: { variant?: 'bar' | 'drawer' }) {
  const { user, loading, configured, signOut } = useSession()
  const pathname = usePathname()

  if (!configured || loading) return null

  if (!user) {
    return (
      <Link
        href={signInHref(pathname)}
        className={
          variant === 'drawer'
            ? 'btn-ghost focus-ring flex min-h-[44px] w-full items-center justify-center rounded-lg text-[15px]'
            : 'btn-ghost focus-ring shrink-0 whitespace-nowrap !px-3 !py-1.5 !text-sm'
        }
      >
        Sign in
      </Link>
    )
  }

  const label = user.email ?? 'Your account'
  const initial = (user.email ?? '?').trim().charAt(0).toUpperCase() || '?'

  if (variant === 'drawer') {
    return (
      <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-line px-3">
        <Link href="/account" className="focus-ring min-w-0 truncate py-2 text-[14px] font-semibold text-ink">
          {label}
        </Link>
        <button
          type="button"
          className="focus-ring shrink-0 py-2 text-[13px] font-semibold text-q-violet-text"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <Link
      href="/account"
      title={`Signed in as ${label}`}
      aria-label={`Account — signed in as ${label}`}
      className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full bg-q-violet/20 text-[13px] font-bold text-q-violet-text"
    >
      <span aria-hidden="true">{initial}</span>
    </Link>
  )
}

export default AccountButton
