'use client'

import Link from 'next/link'
import type { Challenge, ChallengeKind } from '@/lib/challenges/types'

const KIND_LABEL: Record<ChallengeKind, string> = {
  'target-state': 'Target state',
  'target-distribution': 'Distribution',
  'gate-golf': 'Gate golf',
  'fix-the-bug': 'Fix the bug',
  oracle: 'Oracle',
}

interface Accent {
  text: string
  border: string
}

const KIND_COLOR: Record<ChallengeKind, Accent> = {
  'target-state': { text: 'var(--q-violet-text)', border: 'rgb(var(--q-violet-rgb) / 0.33)' },
  'target-distribution': { text: 'var(--q-sky-text)', border: 'rgb(var(--q-sky-rgb) / 0.33)' },
  'gate-golf': { text: 'var(--q-amber-text)', border: 'rgb(var(--q-amber-rgb) / 0.33)' },
  'fix-the-bug': { text: 'var(--q-rose-text)', border: 'rgb(var(--q-rose-rgb) / 0.33)' },
  oracle: { text: 'var(--q-teal-text)', border: 'rgb(var(--q-teal-rgb) / 0.33)' },
}

const LEVEL_COLOR: Record<Challenge['level'], Accent> = {
  Beginner: { text: 'var(--q-teal-text)', border: 'rgb(var(--q-teal-rgb) / 0.33)' },
  Intermediate: { text: 'var(--q-amber-text)', border: 'rgb(var(--q-amber-rgb) / 0.33)' },
  Advanced: { text: 'var(--q-rose-text)', border: 'rgb(var(--q-rose-rgb) / 0.33)' },
}

export default function ChallengeCard({
  challenge,
  solved,
  bestGates,
}: {
  challenge: Challenge
  solved: boolean
  bestGates?: number
}) {
  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="card card-hover focus-ring flex flex-col gap-3 p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="pill"
          style={{
            color: KIND_COLOR[challenge.kind].text,
            borderColor: KIND_COLOR[challenge.kind].border,
          }}
        >
          {KIND_LABEL[challenge.kind]}
        </span>
        <span
          className="pill"
          style={{
            color: LEVEL_COLOR[challenge.level].text,
            borderColor: LEVEL_COLOR[challenge.level].border,
          }}
        >
          {challenge.level}
        </span>
        {solved ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-q-teal-text">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 8.5 L6.5 12 L13 4.5"
                fill="none"
                stroke="var(--q-teal)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Solved
          </span>
        ) : null}
      </div>

      <div>
        <h3 className="text-base font-bold text-ink">{challenge.title}</h3>
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink-secondary">
          {challenge.brief}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-[11px] text-ink-muted">
        <span className="font-mono">
          {challenge.numQubits} qubit{challenge.numQubits === 1 ? '' : 's'}
        </span>
        {solved && bestGates !== undefined ? (
          <span className="font-mono text-q-teal-text">
            best {bestGates} gate{bestGates === 1 ? '' : 's'}
            {challenge.maxGates !== undefined ? ` · par ${challenge.maxGates}` : ''}
          </span>
        ) : challenge.maxGates !== undefined ? (
          <span className="font-mono">par {challenge.maxGates}</span>
        ) : (
          <span>Open →</span>
        )}
      </div>
    </Link>
  )
}
