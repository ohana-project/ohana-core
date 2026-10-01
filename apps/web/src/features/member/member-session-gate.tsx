import { Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { useSyncLifecycle } from '@/features/member/use-synced-space.ts'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The member gate mirrors the administrative one (issue #7): it probes the
 * session and either renders the children or redirects to the screen that
 * repairs the mismatch. While the session is known good it also carries
 * the member area's one sync trigger (issue #14), so the synchronised
 * partition stays current no matter which screen is open.
 */
export function MemberSessionGate({
  require,
  redirectTo,
  children,
}: {
  require: 'signed-in' | 'signed-out'
  redirectTo: string
  children: ReactNode
}) {
  const session = useMemberSessionStatus()
  useSyncLifecycle(session.status === 'signed-in' && require === 'signed-in')
  if (session.status === 'pending') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (session.status !== require) return <Navigate to={redirectTo} replace />
  return <>{children}</>
}
