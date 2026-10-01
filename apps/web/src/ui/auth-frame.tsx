import { cn } from 'cn'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Logo } from '@/ui/logo.tsx'

/*
 * Ohana auth frame (`.auth` in the prototype): a centred column up to
 * 420px with the logo on top and a footer note.
 */
export function AuthFrame({
  children,
  footer,
  className,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <div
      data-slot="auth-frame"
      className={cn('flex min-h-dvh flex-col items-center justify-center px-5 py-8', className)}
    >
      <div className="w-full max-w-[420px]">
        <Logo className="mb-8 justify-center" />
        {children}
      </div>
      <p className="mt-[22px] text-center text-sm text-muted-foreground">
        {footer ?? t('layout.authNote')}
      </p>
    </div>
  )
}
