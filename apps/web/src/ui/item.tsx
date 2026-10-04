import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import type * as React from 'react'

import { Separator } from '@/ui/separator'

/*
 * Ohana list row (`.list-row` in the prototype): a leading icon —
 * bare by default, or in the 38px tile a tone opts into —, title and
 * subtitle, trailing content; rows are divided by hairlines. The size
 * variants carry the heights the prototypes use inline (52, 56, 60,
 * 64, 68px) instead of one-off pixel values (issue #58).
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
  'group/item flex w-full flex-wrap items-center gap-3.5 px-3.5 py-2.5 text-body text-left transition-colors duration-(--t-fast) ease-(--ease) border-b border-border last:border-b-0 [a]:transition-colors hover:bg-surface-2',
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

export type ItemMediaTone = 'neutral' | 'primary' | 'ok' | 'warn' | 'danger'

const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        bare: 'text-muted-foreground',
        icon: 'size-[38px] rounded-md',
      },
      tone: {
        neutral: 'bg-surface-2 text-muted-foreground',
        primary: 'bg-primary-soft text-primary',
        ok: 'bg-(--ok-fill) text-ok',
        warn: 'bg-(--warn-fill) text-warn',
        danger: 'bg-(--danger-fill) text-destructive',
      },
    },
  },
)

function ItemMedia({
  className,
  variant = 'default',
  tone,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'icon'
  tone?: ItemMediaTone
}) {
  // A bare icon is the default, like the prototype's `.leading`; the
  // 38px tile arrives through `variant="icon"` or through any tone at
  // all — a tone without the tile would have nothing to tint. An
  // avatar therefore never sits on a tinted square (issue #58).
  const tiled = variant === 'icon' || tone !== undefined
  return (
    <div
      data-slot="item-media"
      data-variant={tiled ? 'icon' : 'default'}
      data-tone={tiled ? (tone ?? 'neutral') : undefined}
      className={cn(
        itemMediaVariants({
          variant: tiled ? 'icon' : 'bare',
          tone: tiled ? (tone ?? 'neutral') : undefined,
        }),
        className,
      )}
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
        'flex w-fit items-center gap-2 truncate text-body leading-snug font-medium',
        className,
      )}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        'line-clamp-2 text-left text-sm leading-normal font-normal text-muted-foreground [&>a]:underline [&>a]:underline-offset-3 [&>a:hover]:text-primary',
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
      className={cn('ml-auto flex shrink-0 items-center gap-2 text-muted-foreground', className)}
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
