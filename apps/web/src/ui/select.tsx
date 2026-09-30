import { cn } from 'cn'
import type * as React from 'react'

/*
 * Ohana select (`.input` on a native <select> in the prototypes, e.g.
 * space-settings `sp-tz` and event-editor `ee-tz`): the input surface
 * with a chevron, 46px tall, same focus and invalid states as Input.
 */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div data-slot="select" className={cn('relative', className)}>
      <select
        data-slot="select-input"
        className={cn(
          'min-h-[46px] w-full min-w-0 appearance-none rounded-md border border-input bg-card px-3.5 py-[11px] pr-9 text-body outline-none transition-[border-color,box-shadow] duration-(--t-fast) ease-(--ease) hover:border-[color-mix(in_oklch,var(--fg)_24%,var(--border))] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-primary-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15',
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  )
}

export { Select }
