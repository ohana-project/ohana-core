'use client'

import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from 'cn'

/*
 * Ohana switch: 46×28 with an accent track when on (`.switch` in the
 * prototype). Focus uses the global :focus-visible outline.
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group/switch relative inline-flex h-[28px] w-[46px] shrink-0 items-center rounded-full border border-border bg-transparent transition-[background,border-color] duration-(--t-base) ease-(--ease) outline-none after:absolute after:-inset-x-2 after:-inset-y-1.5 data-checked:border-primary data-checked:bg-primary data-unchecked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-card shadow-1 transition-transform duration-(--t-base) ease-(--ease) group-data-checked/switch:translate-x-[18px] group-data-checked/switch:bg-primary-foreground group-data-unchecked/switch:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
