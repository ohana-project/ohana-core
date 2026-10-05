import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

import { Logo } from '@/ui/logo.tsx'

/*
 * Ohana auth frame (`.auth` in the prototype): a centred column up to
 * 420px with the logo on top and a footer note. The note sits inside
 * the column, like the prototype's `.auth-foot` inside `.auth-card`
 * (issue #79). A screen that brings its own brand row — the admin
 * sign-in's logo-and-pill row — passes `logo={false}` so the lockup
 * does not double.
 */
export function AuthFrame({
  children,
  footer,
  logo = true,
  className,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
  logo?: boolean
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <div
      data-slot="auth-frame"
      className={cn('flex min-h-dvh flex-col items-center justify-center px-5 py-8', className)}
    >
      <div className="w-full max-w-[420px]">
        {logo && <Logo className="mb-8 justify-center" />}
        {children}
        <p className="mt-5.5 text-center text-sm text-muted-foreground">
          {footer ?? t('layout.authNote')}
        </p>
      </div>
    </div>
  )
}
