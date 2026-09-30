import { cn } from 'cn'
import type * as React from 'react'

/*
 * Ohana card (`.card` in the prototype): surface, hairline border,
 * shadow-1, 18px radius, 20px padding. `hoverable` is the link-card
 * lift: shadow-2, −1px, a stronger border (README "Components").
 */

function Card({
  className,
  size = 'default',
  hoverable = false,
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm'; hoverable?: boolean }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-hoverable={hoverable || undefined}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-lg border border-border bg-card py-(--card-spacing) text-body text-card-foreground shadow-1 [--card-spacing:--spacing(5)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg',
        hoverable &&
          'transition-[box-shadow,transform,border-color] duration-(--t-base) ease-(--ease) hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--fg)_16%,var(--border))] hover:shadow-2',
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
