import { cn } from 'cn'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'

import { LogoMark } from '@/ui/logo.tsx'

/*
 * Ohana admin top bar (`.admin-top` in the prototype): calm and solid
 * — the mark, «Ohana · Админка», and the caller's actions. No glass.
 */
export function AdminTopBar({
  actions,
  className,
  ...props
}: React.ComponentProps<'header'> & { actions?: React.ReactNode }) {
  const { t } = useTranslation()

  return (
    <header
      data-slot="admin-top"
      className={cn(
        'sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background px-(--pad) py-2.5',
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-2.5 text-foreground">
        <LogoMark className="size-[26px]" />
        <span className="font-display text-h3">{t('layout.adminTitle')}</span>
      </span>
      <span className="min-w-0 flex-1" />
      {actions}
    </header>
  )
}
