'use client'

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

/*
 * Ohana toggle: the `.seg` button look, shared with the toggle group.
 * `aria-pressed` shows the active segment.
 */
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--t-fast) ease-(--ease) hover:text-foreground data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:shadow-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default: 'min-h-8 px-3.5 py-[5px]',
        sm: "min-h-7 px-3 py-1 text-meta [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

function Toggle({
  className,
  size = 'default',
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
