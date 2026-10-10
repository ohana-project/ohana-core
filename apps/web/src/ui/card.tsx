import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana card (`.card` in the prototype): surface, hairline border,
 * shadow-1, 18px radius. Two forms (issue #58; the old vertical-padding
 * default was removed once every screen had migrated, issue #81):
 * the prototype's padded card (`.card-pad`: 20px on all sides, no
 * forced gap — the content sets its own rhythm) and the list card
 * (`.card.list`: no padding, rows flush, the corners clip them). The
 * padded form takes plain children — the old header and content slots
 * went with the default —, and the list form takes rows only.
 * `hoverable` is the link-card lift: shadow-2, −1px, a stronger
 * border (README "Components").
 */

/*
 * The link-card lift (`.card-link:hover` in the prototype): shadow-2,
 * −1px, a stronger border. Card's `hoverable` opts in; the radio card
 * (`label.card.card-link`, issue #78) shares the recipe from here so
 * the two cannot drift.
 */
export const cardHoverableClass =
  'transition-[box-shadow,transform,border-color] duration-(--t-base) ease-(--ease) hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--fg)_16%,var(--border))] hover:shadow-2'

function Card({
  className,
  variant = 'padded',
  size = 'default',
  hoverable = false,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'padded' | 'list'
  size?: 'default' | 'sm'
  hoverable?: boolean
}) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      data-size={size}
      data-hoverable={hoverable || undefined}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-card text-body text-card-foreground shadow-1 [--card-spacing:--spacing(5)] data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg',
        variant === 'padded' && 'p-(--card-spacing)',
        // A list card's rows sit flush with the corners, so a row's own
        // :focus-visible ring — drawn outside the element — is clipped by
        // the card's overflow. The card carries the ring instead, at the
        // global rule's 2px offset (issue #76); the row keeps it where its
        // box has room around it.
        variant === 'list' &&
          'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        hoverable && cardHoverableClass,
        className,
      )}
      {...props}
    />
  )
}

export { Card }
