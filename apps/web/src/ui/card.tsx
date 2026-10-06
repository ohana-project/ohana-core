import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana card (`.card` in the prototype): surface, hairline border,
 * shadow-1, 18px radius. Three forms beside each other (issue #58):
 * the `default` the first screens were built on — vertical padding, a
 * gap between blocks, side padding coming from the header and content
 * slots —, the prototype's padded card (`.card-pad`: 20px on all
 * sides, no forced gap, the content sets its own rhythm), and the list
 * card (`.card.list`: no padding, rows flush, the corners clip them).
 * The padded form takes plain children — the slots' own side padding
 * would double it —, and the list form takes rows only.
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
  variant = 'default',
  size = 'default',
  hoverable = false,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'padded' | 'list'
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
        'group/card flex flex-col overflow-hidden rounded-lg border border-border bg-card text-body text-card-foreground shadow-1 [--card-spacing:--spacing(5)] data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg',
        variant === 'default' &&
          'gap-(--card-spacing) py-(--card-spacing) has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:has-data-[slot=card-footer]:pb-0',
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

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-lg px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        'font-display text-[17px] leading-snug font-semibold tracking-[-0.01em] group-data-[size=sm]/card:text-base',
        className,
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center gap-2.5 rounded-b-lg border-t border-border p-(--card-spacing)',
        className,
      )}
      {...props}
    />
  )
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
