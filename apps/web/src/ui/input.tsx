import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from 'cn'
import type * as React from 'react'

/*
 * Ohana input (docs/design/README.md, "Components"): 46px, border
 * darkens on hover, accent border with a 3px accent-soft ring on
 * focus, danger border and ring when invalid. The invalid shake is
 * applied by the Field.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'min-h-[46px] w-full min-w-0 rounded-md border border-input bg-card px-3.5 py-[11px] text-body outline-none transition-[border-color,box-shadow] duration-(--t-fast) ease-(--ease) placeholder:text-muted-foreground/70 hover:border-[color-mix(in_oklch,var(--fg)_24%,var(--border))] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-primary-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 group-data-[invalid=true]/field:animate-shake',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
