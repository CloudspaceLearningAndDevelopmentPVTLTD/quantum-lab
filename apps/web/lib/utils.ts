import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Standard shadcn/ui class-merging helper: clsx for conditional class
 * composition, tailwind-merge to resolve conflicting Tailwind utilities
 * (e.g. `cn('px-2', condition && 'px-4')` keeps only px-4, not both).
 * Every shadcn primitive in components/ui/ is built expecting this.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
