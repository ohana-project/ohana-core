import { Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { SpacesSheet } from '@/features/accounts/spaces-sheet.tsx'
import {
  useMemberSessionStatus,
  useMemberSyncActive,
} from '@/features/member/use-member-session.ts'
import { useSyncLifecycle } from '@/features/member/use-synced-space.ts'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The member gate mirrors the administrative one (issue #7): it probes the
 * session and either renders the children or redirects to the screen that
 * repairs the mismatch. While the probe's settled answer is signed-in it
 * also carries the member area's one sync trigger (issue #14). The trigger
 * follows the probe's data — which survives a refetch — rather than the
 * render status, which reports pending for the duration of a refetch and
 * would tear the sync down and start it again mid-flight. Every member
 * route mounts this gate, so entering a member area is what brings the
 * partition up to date; mutations trigger their own syncs besides this.
 * The gate also mounts the «Пространства» sheet once (issue #64): the
 * prototype's shell opens its account sheet from the switchers and the
 * user menu, and every member route sits behind this gate.
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
  const syncActive = useMemberSyncActive()
  useSyncLifecycle(require === 'signed-in' && syncActive)
  if (session.status === 'pending') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (session.status !== require) return <Navigate to={redirectTo} replace />
  return (
    <>
      {children}
      {require === 'signed-in' && <SpacesSheet />}
    </>
  )
}
