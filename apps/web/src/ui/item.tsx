import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/cn'

import { Separator } from '@/ui/separator'

/*
 * Ohana list row (`.list-row` in the prototype): a leading icon —
 * bare by default, in the 38px tinted tile that `variant="icon"` opts
 * into, or in the 28px numbered plate of `variant="num"` (the
 * prototype's `.leading.num`, install.html) —, title and subtitle,
 * trailing content; rows are divided by hairlines. The size variants
 * carry the heights the prototypes use inline (52, 56, 60, 64, 68px)
 * instead of one-off pixel values (issue #58). A leading icon is 20px
 * (`.list-row .leading svg`), a trailing icon 18px
 * (`.list-row .trailing svg`) — the icons pick their sizes up from the
 * row, callers do not need to pass one (issue #55).
 */

function ItemGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-group" className={cn('flex w-full flex-col', className)} {...props} />
}

function ItemSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn('my-2', className)}
      {...props}
    />
  )
}

const itemVariants = cva(
  "group/item flex w-full flex-wrap items-center gap-3.5 px-3.5 py-2.5 text-body text-left transition-colors duration-(--t-fast) ease-(--ease) border-b border-border last:border-b-0 [a]:transition-colors hover:bg-surface-2 [&>svg]:pointer-events-none [&>svg]:shrink-0 [&>svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: '',
        danger:
          '[&>[data-slot=item-media]]:text-destructive [&>[data-slot=item-content]]:[&>[data-slot=item-title]]:text-destructive',
      },
      size: {
        sm: 'min-h-[52px]',
        default: 'min-h-14',
        md: 'min-h-15',
        lg: 'min-h-16',
        xl: 'min-h-17',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Item({
  className,
  variant = 'default',
  size = 'default',
  render,
  ...props
}: useRender.ComponentProps<'div'> & VariantProps<typeof itemVariants>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(itemVariants({ variant, size, className })),
      },
      props,
    ),
    render,
    state: {
      slot: 'item',
      variant,
      size,
    },
  })
}

type ItemMediaTone = 'neutral' | 'primary' | 'ok' | 'warn' | 'danger'

/*
 * The tone colours the leading icon everywhere; the 38px tile adds the
 * matching tint on top (compound variants below). A tone on a bare
 * icon therefore colours it without a square behind it, like the
 * prototype's accent heart in the wishlists row.
 */
const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: 'text-muted-foreground',
        icon: 'size-[38px] rounded-md',
        // The prototype's `.leading.num` (install.html): a 28px mono
        // muted number on a round surface-2 plate.
        num: 'size-7 rounded-full bg-surface-2 font-mono text-[13px] tabular-nums text-muted-foreground',
      },
      tone: {
        neutral: '',
        primary: 'text-primary',
        ok: 'text-ok',
        warn: 'text-warn',
        danger: 'text-destructive',
      },
    },
    compoundVariants: [
      { variant: 'icon', tone: 'neutral', className: 'bg-surface-2 text-muted-foreground' },
      { variant: 'icon', tone: 'primary', className: 'bg-primary-soft' },
      { variant: 'icon', tone: 'ok', className: 'bg-(--ok-fill)' },
      { variant: 'icon', tone: 'warn', className: 'bg-(--warn-fill)' },
      { variant: 'icon', tone: 'danger', className: 'bg-(--danger-fill)' },
    ],
  },
)

function ItemMedia({
  className,
  variant = 'default',
  tone,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'icon' | 'num'
  tone?: ItemMediaTone
}) {
  // A bare icon is the default, like the prototype's `.leading`; the
  // 38px tinted tile is opt-in through `variant="icon"`, its tint
  // coming from the tone; the numbered plate is `variant="num"`. An
  // avatar therefore never sits on a tinted square (issue #58).
  const tiled = variant === 'icon'
  const activeTone = tone ?? (tiled ? 'neutral' : undefined)
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      data-tone={activeTone}
      className={cn(itemMediaVariants({ variant, tone: activeTone }), className)}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-content"
      className={cn('flex min-w-0 flex-1 flex-col gap-px', className)}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        // `w-fit` hugs short titles; `max-w-full` clamps it to the row's
        // clipped column — under `truncate`'s nowrap the fit-content
        // floors at the longest word and would otherwise reach into the
        // trailing content (issue #80).
        'flex w-fit max-w-full items-center gap-2 truncate text-body leading-snug font-medium',
        className,
      )}
      {...props}
    />
  )
}

function ItemDescription({
  className,
  singleLine = false,
  ...props
}: React.ComponentProps<'p'> & {
  /** One clipped line instead of two: rows that must hold their height (issue #80). */
  singleLine?: boolean
}) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        'text-left text-sm leading-normal font-normal text-muted-foreground [&>a]:underline [&>a]:underline-offset-3 [&>a:hover]:text-primary',
        singleLine ? 'truncate' : 'line-clamp-2',
        className,
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-actions"
      className={cn(
        "ml-auto flex shrink-0 items-center gap-2 text-muted-foreground [&>svg]:pointer-events-none [&>svg]:shrink-0 [&>svg:not([class*='size-'])]:size-[18px]",
        className,
      )}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-header"
      className={cn('flex basis-full items-center justify-between gap-2', className)}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-footer"
      className={cn('flex basis-full items-center justify-between gap-2', className)}
      {...props}
    />
  )
}

export {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
}
