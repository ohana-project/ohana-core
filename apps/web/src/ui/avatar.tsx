import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { cn } from 'cn'
import type * as React from 'react'

/*
 * Ohana avatar (docs/design/README.md, "Colour"): a monogram on a warm
 * per-member hue — never a photo. The hue sits in --hue; the dark
 * inversion lives only inside [data-theme=dark], unlike the prototype,
 * which leaked it into pages without the attribute.
 */

export interface AvatarProps extends AvatarPrimitive.Root.Props {
  size?: 'xs' | 'sm' | 'default' | 'lg'
  /** Warm hue for the monogram fill, e.g. Аня 60, Дима 145, Миша 25, Люда 340. */
  hue?: number
}

const avatarSizes = {
  xs: 'size-6 text-meta',
  sm: 'size-8 text-sm',
  default: 'size-10 text-body',
  lg: 'size-14 text-h2',
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
        'flex *:data-[slot=avatar]:border-2 *:data-[slot=avatar]:border-bg *:data-[slot=avatar]:-ml-2 first:*:data-[slot=avatar]:ml-0 dark:*:data-[slot=avatar]:border-bg',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback, AvatarGroup }
