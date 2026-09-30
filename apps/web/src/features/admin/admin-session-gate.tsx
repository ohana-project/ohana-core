import { Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Spinner } from '@/ui/spinner.tsx'
import { useAdminSession } from './use-admin-session.ts'

/*
 * Route gate for the administrative area: shows the loading state while the
 * session probe is in flight, then either renders the children or sends the
 * visitor to the route matching their session state.
 */
export function AdminSessionGate({
  require,
  redirectTo,
  children,
}: {
  require: 'signed-in' | 'signed-out'
  redirectTo: string
  children: ReactNode
}) {
  const session = useAdminSession()

  if (session.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (session.data !== require) {
    return <Navigate to={redirectTo} replace />
  }
  return <>{children}</>
}
