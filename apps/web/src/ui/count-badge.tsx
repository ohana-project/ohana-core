import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana count badge (`.count-badge` in the prototype): mono 11.5px on
 * the fg-soft fill, e.g. the number of wishes on a nav row.
 */
export function CountBadge({ className, children, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="count-badge"
      className={cn(
        'inline-grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 font-mono text-micro text-muted-foreground tabular-nums',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
