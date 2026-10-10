import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ' +
    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-surface-2 text-ink-secondary',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'border-line text-ink',
        // Maps onto the existing five categorical hues, same order used
        // everywhere else (q-violet -> q-teal -> q-amber -> q-rose -> q-sky) —
        // see tailwind.config.ts's header comment. Use these, not `default`,
        // when a badge represents a data series/category rather than status.
        violet: 'border-transparent bg-q-violet/15 text-q-violet-text',
        teal: 'border-transparent bg-q-teal/15 text-q-teal-text',
        amber: 'border-transparent bg-q-amber/15 text-q-amber-text',
        rose: 'border-transparent bg-q-rose/15 text-q-rose-text',
        sky: 'border-transparent bg-q-sky/15 text-q-sky-text',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
