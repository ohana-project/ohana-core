import type * as React from 'react'

import { UpdatePrompt } from '@/features/update/update-prompt.tsx'
import { AdminTopBar } from '@/ui/admin-top-bar.tsx'

/*
 * Administrative shell (docs/design/README.md, "Layout"): a calm solid
 * top bar and content up to 960px — no tab bar, no sidebar.
 */
export function AdminLayout({
  actions,
  children,
}: {
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh">
      <AdminTopBar actions={actions} />
      <main className="mx-auto max-w-[var(--admin-w)] px-(--pad) pt-7 pb-14">
        <UpdatePrompt />
        {children}
      </main>
    </div>
  )
}
