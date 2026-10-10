'use client'

/**
 * A link to /admin/platform that renders ONLY for platform admins (the
 * PLATFORM_ADMIN_EMAILS allow-list, checked server-side via /api/platform/me).
 * Everyone else sees nothing — not a disabled link, nothing — because the
 * console is an operator surface, not a feature to upsell.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSession } from '@/components/auth/useSession'
import { authFetch } from '@/lib/authFetch'

export default function PlatformConsoleLink({ className = '' }: { className?: string }) {
  const { user } = useSession()
  const [admin, setAdmin] = useState(false)

  useEffect(() => {
    if (!user) {
      setAdmin(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await authFetch('/api/platform/me')
        const body = (await res.json()) as { admin?: boolean }
        if (!cancelled) setAdmin(Boolean(body.admin))
      } catch {
        if (!cancelled) setAdmin(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  if (!admin) return null
  return (
    <div className={`card border-q-violet/25 p-5 ${className}`}>
      <p className="section-label">Platform console</p>
      <p className="mt-1 text-sm text-ink-secondary">
        You are a platform admin. Configure the AI tutor’s providers, API keys, routing and what each tier of learner
        gets — live, without a redeploy.
      </p>
      <Link href="/admin/platform" className="btn-primary focus-ring mt-4 inline-flex">
        Open the console →
      </Link>
    </div>
  )
}
