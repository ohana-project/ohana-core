import { cn } from '@/lib/cn'
import type * as React from 'react'

import { Icon } from '@/ui/icon.tsx'

/*
 * Ohana pick row (`.pick` in the prototype): a selectable row —
 * recipients of an event, members in a filter — driven by
 * aria-pressed with an accent check.
 */
export function PickRow({
  pressed = false,
  onPressedChange,
  leading,
  sub,
  children,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  pressed?: boolean
  onPressedChange?: (pressed: boolean) => void
  leading?: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-slot="pick-row"
      aria-pressed={pressed}
      onClick={(event) => {
        onPressedChange?.(!pressed)
        props.onClick?.(event)
      }}
      className={cn(
        'flex w-full min-h-[52px] items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-(--t-fast) ease-(--ease) border-b border-border last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 aria-pressed:bg-[color-mix(in_oklch,var(--accent)_5%,transparent)]',
        className,
      )}
      {...props}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{children}</span>
        {sub && <span className="block text-sm text-muted-foreground">{sub}</span>}
      </span>
      <Icon
        name="check"
        className={cn(
          'shrink-0 text-primary transition-opacity duration-(--t-fast) ease-(--ease)',
          pressed ? 'opacity-100' : 'opacity-0',
        )}
      />
    </button>
  )
}
