import { cn } from 'cn'
import type * as React from 'react'

/*
 * Ohana section header (`.sec-head` in the prototype): an h2 with an
 * optional trailing accent link.
 */
export function SectionHeader({
  title,
  action,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  title: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="section-header"
      className={cn('mb-3 flex items-baseline justify-between gap-3', className)}
      {...props}
    >
      <h2>{title}</h2>
      {action && (
        <span className="text-sm font-medium whitespace-nowrap text-primary [&_a]:underline-offset-3 [&_a:hover]:underline">
          {action}
        </span>
      )}
    </div>
  )
}
