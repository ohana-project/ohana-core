import { cn } from 'cn'
import type * as React from 'react'

import { Icon, type IconName } from '@/ui/icon.tsx'

/*
 * Ohana FAB: 56px liquid glass with an accent icon, mobile only
 * (hidden from 920px up, like the prototype). The `.fab` recipe and
 * its fallbacks live in ui/styles/glass.css.
 */
export function Fab({
  icon = 'plus',
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & { icon?: IconName }) {
  return (
    <button
      type="button"
      data-slot="fab"
      className={cn(
        'fab fixed right-4 bottom-[calc(var(--tabbar-h)+20px)] z-35 grid size-14 place-items-center rounded-full desktop:hidden',
        className,
      )}
      {...props}
    >
      <Icon name={icon} className="relative size-6" />
      {children}
    </button>
  )
}
