import type * as React from 'react'
import { cn } from '@/lib/cn'

import { Icon, type IconName } from '@/ui/icon.tsx'

/*
 * Ohana note block (`.venue-note` in the prototype, issue #61): the
 * soft-accent box with a 22% accent hairline, a 20px accent icon and
 * `sm` body text, used on Home, the wishlist screens and the invite
 * screen. The icon is a sized-icon context (issue #55): callers pass
 * no size, the block dictates 20px, and an explicit size still wins.
 */
export interface NoteBlockProps extends React.ComponentProps<'div'> {
  icon: IconName
}

export function NoteBlock({ icon, className, children, ...props }: NoteBlockProps) {
  return (
    <div
      data-slot="note-block"
      className={cn(
        'flex gap-3.5 rounded-lg border border-[color-mix(in_oklch,var(--accent)_22%,transparent)] bg-primary-soft p-4',
        "[&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg]:text-primary [&>svg:not([class*='size-'])]:size-5",
        className,
      )}
      {...props}
    >
      <Icon name={icon} />
      <div className="flex min-w-0 flex-1 flex-col text-sm">{children}</div>
    </div>
  )
}
