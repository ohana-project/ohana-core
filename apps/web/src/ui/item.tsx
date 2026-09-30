import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import type * as React from 'react'

import { Separator } from '@/ui/separator'

/*
 * Ohana list row (`.list-row` in the prototype): a leading 38px icon
 * tile with a tone, title and subtitle, trailing content; rows are
 * divided by hairlines, and the min-height comes from the size
 * variants instead of the prototype's inline pixel values.
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
        lg: 'min-h-16',
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

const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center rounded-md [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: '',
        icon: 'size-[38px]',
      },
      tone: {
        neutral: 'bg-surface-2 text-muted-foreground',
        primary: 'bg-primary-soft text-primary',
        ok: 'bg-(--ok-fill) text-ok',
        warn: 'bg-(--warn-fill) text-warn',
        danger: 'bg-(--danger-fill) text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
      tone: 'neutral',
    },
  },
)

function ItemMedia({
  className,
  variant = 'default',
  tone,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof itemMediaVariants> & {
    tone?: 'neutral' | 'primary' | 'ok' | 'warn' | 'danger'
  }) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      data-tone={tone}
      className={cn(itemMediaVariants({ variant, tone, className }))}
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
