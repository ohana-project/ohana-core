'use client'

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'
import * as React from 'react'

import { toggleVariants } from '@/ui/toggle'

/*
 * Ohana segmented control built from toggles: the group is the `.seg`
 * pill track, each item an active-on-`aria-pressed` segment.
 */

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: 'horizontal' | 'vertical'
  }
>({
  size: 'default',
  spacing: 2,
  orientation: 'horizontal',
})

function ToggleGroup({
  className,
  size,
  spacing = 2,
  orientation = 'horizontal',
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: 'horizontal' | 'vertical'
  }) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ '--gap': spacing } as React.CSSProperties}
      className={cn(
        'inline-flex w-fit items-center gap-0.5 rounded-full bg-surface-2 p-[3px] data-vertical:flex-col data-vertical:items-stretch',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ size, spacing, orientation }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  size = 'default',
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        'flex-0 shrink-0',
        toggleVariants({
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
