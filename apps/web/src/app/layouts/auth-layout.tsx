import type * as React from 'react'

import { UpdatePrompt } from '@/features/update/update-prompt.tsx'
import { AuthLayout as AuthFrame } from '@/ui/auth-layout.tsx'

/*
 * Auth shell (docs/design/README.md, "Layout"): the centred frame plus
 * the pieces every sign-in-side screen shares — the update offer among
 * them, so a version detected anywhere on the auth side is offered here
 * too.
 */
export function AuthLayout({
  children,
  footer,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <AuthFrame footer={footer}>
      <UpdatePrompt />
      {children}
    </AuthFrame>
  )
}
