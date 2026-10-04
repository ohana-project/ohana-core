import type * as React from 'react'
import { cn } from '@/lib/cn'

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
  icon?: 'wifi-off' | 'cloud-off' | 'alert' | 'info' | 'sync'
  action?: React.ReactNode
}) {
  return (
    <div
      role="status"
      data-slot="banner"
      className={cn(
        'flex items-center gap-2.5 rounded-md border border-(--banner-border) bg-(--banner-fill) px-3.5 py-2.5 text-sm font-medium text-(--banner-text)',
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
