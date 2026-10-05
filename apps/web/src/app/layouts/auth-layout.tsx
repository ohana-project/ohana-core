import type * as React from 'react'

import { ThemeToggle } from '@/app/theme-toggle.tsx'
import { UpdatePrompt } from '@/features/update/update-prompt.tsx'
import { AuthFrame, type AuthFrameProps } from '@/ui/auth-frame.tsx'

/*
 * Auth shell (docs/design/README.md, "Layout"): the centred frame plus
 * the pieces every sign-in-side screen shares — the update offer and the
 * round theme toggle pinned at the viewport's top right (issue #63) —
 * among them, so a version detected anywhere on the auth side is offered
 * here too and the theme is reachable before any sign-in. The frame's
 * column width and optional logo follow each screen's prototype.
 */
export function AuthLayout({
  children,
  footer,
  columnWidth,
  logo,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
  columnWidth?: AuthFrameProps['columnWidth']
  logo?: AuthFrameProps['logo']
}) {
  return (
    <>
      <ThemeToggle className="fixed top-3.5 right-3.5 z-10" />
      <AuthFrame footer={footer} columnWidth={columnWidth} logo={logo}>
        <UpdatePrompt />
        {children}
      </AuthFrame>
    </>
  )
}
