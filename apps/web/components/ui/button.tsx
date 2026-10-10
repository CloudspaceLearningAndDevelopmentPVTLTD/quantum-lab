import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex max-w-full items-center justify-center gap-2 whitespace-normal rounded-lg text-center text-sm font-semibold sm:whitespace-nowrap ' +
    'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-[var(--q-violet-hover)]',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        outline: 'border border-line bg-transparent text-ink hover:bg-surface-2',
        secondary: 'bg-surface-2 text-ink-secondary border border-line hover:text-ink hover:border-line-strong',
        ghost: 'text-ink-secondary hover:bg-surface-2 hover:text-ink',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-10 px-4 py-2',
        sm: 'min-h-9 rounded-md px-3 text-xs',
        lg: 'min-h-11 rounded-lg px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

/**
 * shadcn/ui Button, skinned with this repo's existing tokens rather than a
 * new palette: `default` maps to the same --q-violet-strong/hover pairing
 * .btn-primary used before the migration (see app/globals.css's shadcn
 * alias block), `secondary`/`ghost` map to the old .btn-ghost look. The
 * legacy .btn/.btn-primary/.btn-ghost classes in globals.css remain during
 * the migration for any call sites not yet converted — see
 * docs/UI-MIGRATION.md.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
