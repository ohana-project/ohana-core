import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana field label: 13.5px, muted (`.field > label` in the prototype).
 * A generic primitive — callers associate the control with htmlFor or
 * by wrapping it, which is why this file opts out of
 * noLabelWithoutControl in packages/config/biome.json.
 */
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
