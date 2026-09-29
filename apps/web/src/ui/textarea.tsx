import { cn } from 'cn'
import type * as React from 'react'

/* Ohana textarea: the input recipe, at least 110px tall. */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-[110px] w-full resize-y rounded-md border border-input bg-card px-3.5 py-[11px] text-body leading-[1.55] outline-none transition-[border-color,box-shadow] duration-(--t-fast) ease-(--ease) placeholder:text-muted-foreground/70 hover:border-[color-mix(in_oklch,var(--fg)_24%,var(--border))] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-primary-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 group-data-[invalid=true]/field:animate-shake',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
