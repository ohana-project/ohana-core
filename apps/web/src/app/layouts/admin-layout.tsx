import { Link } from '@tanstack/react-router'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'

import { ThemeToggle } from '@/app/theme-toggle.tsx'
import { UpdatePrompt } from '@/features/update/update-prompt.tsx'
import { cn } from '@/lib/cn'
import { AdminTopBar } from '@/ui/admin-top-bar.tsx'
import { Icon } from '@/ui/icon.tsx'

/*
 * Administrative shell (docs/design/README.md, "Layout"): a calm solid
 * top bar and content up to 960px — no tab bar, no sidebar. The bar ends
 * with the 36px round theme toggle (issue #63), after the caller's
 * actions. A space's screen passes `back`, and the bar carries «‹
 * Пространства» in place of the logo (issue #79) — the prototype's
 * `gap: 8px` row with an 18px muted chevron and a small muted label.
 * The instance settings narrow the column to the prototype's own 760px
 * (`width="narrow"`, admin-settings.html).
 */
export function AdminLayout({
  actions,
  back = false,
  width = 'default',
  children,
}: {
  actions?: React.ReactNode
  back?: boolean
  width?: 'default' | 'narrow'
  children: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="min-h-dvh">
      <AdminTopBar
        back={
          back ? (
            <Link
              to="/admin"
              className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-muted-foreground transition-colors duration-(--t-fast) ease-(--ease) hover:text-foreground"
            >
              <Icon name="chevron-left" size={18} />
              {t('admin.space.back')}
            </Link>
          ) : undefined
        }
        actions={
          <>
            {actions}
            <ThemeToggle size="icon-sm" />
          </>
        }
      />
      <main
        className={cn(
          'mx-auto w-full px-(--pad) pt-7 pb-14',
          width === 'default' && 'max-w-[var(--admin-w)]',
          width === 'narrow' && 'max-w-[var(--content-w-narrow)]',
        )}
      >
        <UpdatePrompt />
        {children}
      </main>
    </div>
  )
}
