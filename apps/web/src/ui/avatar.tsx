import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana avatar (docs/design/README.md, "Colour"): a monogram on a warm
 * per-member hue — never a photo. The hue sits in --hue; the dark
 * inversion lives only inside [data-theme=dark], unlike the prototype,
 * which leaked it into pages without the attribute. Monogram sizes are
 * the prototype's own pixel values (.avatar-xs/-sm/.avatar/.avatar-lg:
 * 11, 13, 15, 20px), not type-scale steps.
 */

export interface AvatarProps extends AvatarPrimitive.Root.Props {
  size?: 'xs' | 'sm' | 'default' | 'lg'
  /** Warm hue for the monogram fill, e.g. Аня 60, Дима 145, Миша 25, Люда 340. */
  hue?: number
}

const avatarSizes = {
  xs: 'size-6 text-[11px]',
  sm: 'size-8 text-[13px]',
  default: 'size-10 text-[15px]',
  lg: 'size-14 text-[20px]',
} as const

function Avatar({ className, size = 'default', hue = 40, style, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      style={{ ...style, ['--hue' as string]: hue }}
      className={cn(
        'relative flex shrink-0 select-none items-center justify-center rounded-full bg-[oklch(88%_0.055_var(--hue))] font-semibold tracking-[0.02em] text-[oklch(38%_0.08_var(--hue))] dark:bg-[oklch(34%_0.055_var(--hue))] dark:text-[oklch(88%_0.06_var(--hue))]',
        avatarSizes[size],
        className,
      )}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn('flex size-full items-center justify-center', className)}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        // the stack rim (`.avatar-stack .avatar`): 2px of the page
        // background, so the overlap reads on any surface, and 8px of
        // travel for every avatar after the first. The first-child
        // binds to the avatar, not to the stack — a `first:*:` variant
        // would bind it to the stack, and every stack that is its own
        // parent's first child (a list row's media, the top-bar
        // switcher) would lose the overlap (issue #60).
        'flex *:data-[slot=avatar]:border-2 *:data-[slot=avatar]:border-background *:data-[slot=avatar]:-ml-2 [&>[data-slot=avatar]:first-child]:ml-0',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback, AvatarGroup }
