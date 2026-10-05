import type * as React from 'react'

import { ThemeToggle } from '@/app/theme-toggle.tsx'
import { UpdatePrompt } from '@/features/update/update-prompt.tsx'
import { AuthFrame } from '@/ui/auth-frame.tsx'

/*
 * Auth shell (docs/design/README.md, "Layout"): the centred frame plus
 * the pieces every sign-in-side screen shares — the update offer and the
 * round theme toggle pinned at the viewport's top right (issue #63) —
 * among them, so a version detected anywhere on the auth side is offered
 * here too and the theme is reachable before any sign-in.
 */
export function AuthLayout({
  children,
  footer,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <>
      <ThemeToggle className="fixed top-3.5 right-3.5 z-10" />
      <AuthFrame footer={footer}>
        <UpdatePrompt />
        {children}
      </AuthFrame>
    </>
  )
}
