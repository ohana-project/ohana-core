import type * as React from 'react'
import { cn } from '@/lib/cn'

import { Icon, type IconName } from '@/ui/icon.tsx'

/*
 * Ohana note block (`.venue-note` in the prototype, issue #61): the
 * soft-accent box with a 22% accent hairline, a 20px accent icon and
 * `sm` body text, used on Home, the wishlist screens and the invite
 * screen. The block renders its own icon and dictates the context's
 * 20px accent size (issue #55's icon-context rule); the size guard
 * keeps an explicit size winning, like every other sized-icon context.
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
      {/* a plain block, like the prototype's inner div: paragraphs and
          links keep their natural flow inside it */}
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  )
}
