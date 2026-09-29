import { cn } from 'cn'
import type * as React from 'react'

import { Icon } from '@/ui/icon.tsx'

/*
 * Ohana banner (`.banner` in the prototype): the offline notice —
 * warn 14% over surface, warn-toned text, an icon so colour is never
 * the only signal, and an optional trailing action.
 */
export function Banner({
  icon = 'wifi-off',
  action,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  icon?: 'wifi-off' | 'cloud-off' | 'alert' | 'info'
  action?: React.ReactNode
}) {
  return (
    <div
      role="status"
      data-slot="banner"
      className={cn(
        'flex items-center gap-2.5 rounded-md border border-[color-mix(in_oklch,var(--warn)_35%,transparent)] bg-[color-mix(in_oklch,var(--warn)_14%,var(--surface))] px-3.5 py-2.5 text-sm font-medium text-[color-mix(in_oklch,var(--warn)_80%,var(--fg))]',
        className,
      )}
      {...props}
    >
      <Icon name={icon} className="size-[17px] shrink-0" />
      <span className="min-w-0">{children}</span>
      {action && (
        <span className="ml-auto font-semibold whitespace-nowrap [&_a,_button]:underline [&_a,_button]:decoration-1 [&_a,_button]:underline-offset-3">
          {action}
        </span>
      )}
    </div>
  )
}
