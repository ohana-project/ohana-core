import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

import { Logo } from '@/ui/logo.tsx'

/*
 * Ohana auth frame (`.auth` in the prototype): a centred column —
 * 420px by default, 460px where the prototype says so (onboarding,
 * accounts) — with an optional wordmark lockup on top and a footer
 * note that stays inside the column, like `.auth-foot` inside
 * `.auth-card`. A screen that brings its own brand row — the admin
 * sign-in's logo-and-pill row — passes `logo={false}` so the lockup
 * does not double (issue #79).
 */
export interface AuthFrameProps {
  children: React.ReactNode
  footer?: React.ReactNode
  /** The column's max width; the prototype's wide sign-in screens take 460. */
  columnWidth?: 420 | 460
  /** The wordmark lockup; screens whose prototype omits it pass false. */
  logo?: boolean
  className?: string
}

export function AuthFrame({
  children,
  footer,
  columnWidth = 420,
  logo = true,
  className,
}: AuthFrameProps) {
  const { t } = useTranslation()

  return (
    <div
      data-slot="auth-frame"
      className={cn('flex min-h-dvh flex-col items-center justify-center px-5 py-8', className)}
    >
      <div
        className={cn(
          'flex w-full flex-col',
          columnWidth === 420 ? 'max-w-[420px]' : 'max-w-[460px]',
        )}
      >
        {logo && <Logo className="mb-8 justify-center" />}
        {children}
        <p className="mt-5.5 text-center text-sm text-muted-foreground">
          {footer ?? t('layout.authNote')}
        </p>
      </div>
    </div>
  )
}
