import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana section header (`.sec-head` in the prototype): an h2 with an
 * optional trailing accent link. The administrative screens use the
 * prototype's other form (admin-space.html, admin-settings.html): a
 * plain h3 — the type scale's 16px sans — inset 4px with 10px below,
 * its action a small button, not a link (`level={3}`).
 */
export function SectionHeader({
  title,
  action,
  level = 2,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  title: React.ReactNode
  action?: React.ReactNode
  level?: 2 | 3
}) {
  if (level === 3) {
    return (
      <div
        data-slot="section-header"
        data-level={level}
        className={cn('mb-2.5 flex items-center justify-between gap-3 px-1', className)}
        {...props}
      >
        <h3>{title}</h3>
        {action && <span className="flex shrink-0 items-center gap-2">{action}</span>}
      </div>
    )
  }
  return (
    <div
      data-slot="section-header"
      data-level={level}
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
