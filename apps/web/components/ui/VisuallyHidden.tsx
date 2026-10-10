import type { ElementType, ReactNode } from 'react'

/**
 * Content that is available to screen readers but not painted.
 *
 * Tailwind's `sr-only` does the same job and is used in a few places already;
 * this component exists for the cases where the hidden text needs to be an
 * element other than a span (a heading that keeps the document outline honest,
 * a <p> inside a <figure>), and so that the clipping technique lives in exactly
 * one place.
 *
 * `display: none` and `visibility: hidden` are NOT used deliberately: both
 * remove the element from the accessibility tree, which is the opposite of what
 * this is for.
 */
export function VisuallyHidden({
  as: Tag = 'span',
  children,
  id,
}: {
  /** Element to render. Defaults to `span`. */
  as?: ElementType
  children: ReactNode
  id?: string
}) {
  return (
    <Tag id={id} className="sr-only">
      {children}
    </Tag>
  )
}

export default VisuallyHidden
