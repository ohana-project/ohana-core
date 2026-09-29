import type * as React from 'react'

import { AuthLayout as AuthFrame } from '@/ui/auth-layout.tsx'

/*
 * Sign-in shell (docs/design/README.md, "Layout"): a centred 420px
 * column with the logo on top and a footer note.
 */
export function AuthLayout({
  children,
  footer,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return <AuthFrame footer={footer}>{children}</AuthFrame>
}
