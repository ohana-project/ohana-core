import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

import { LogoMark } from '@/ui/logo.tsx'

/*
 * Ohana admin top bar (`.admin-top` in the prototype): calm and solid
 * — the mark, «Ohana · Админка», and the caller's actions. No glass.
 * On a space's screen the caller passes `back`, and the lockup gives
 * way to the back link (issue #79). The bar keeps the prototype's
 * 56px (`--topbar-h`): 10px of padding around the 36px actions, and
 * the word mark is the prototype's `.admin-word` — 16.5px, outside the
 * type scale like the button sizes.
 */
export function AdminTopBar({
  actions,
  back,
  className,
  ...props
}: React.ComponentProps<'header'> & { actions?: React.ReactNode; back?: React.ReactNode }) {
  const { t } = useTranslation()

  return (
    <header
      data-slot="admin-top"
      className={cn(
        'sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-border bg-background px-(--pad) py-2.5',
        className,
      )}
      {...props}
    >
      {back ?? (
        <span className="inline-flex items-center gap-2.5 text-foreground">
          <LogoMark className="size-[26px]" />
          <span className="font-display text-[16.5px] leading-none font-semibold">
            {t('layout.adminTitle')}
          </span>
        </span>
      )}
      <span className="min-w-0 flex-1" />
      {actions}
    </header>
  )
}
