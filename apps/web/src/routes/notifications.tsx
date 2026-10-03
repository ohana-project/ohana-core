import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { NotificationsScreen } from '@/features/notifications/notifications-screen.tsx'

/*
 * The notifications settings (issue #22): this device's push subscription
 * and its own opt-in to event details.
 */
function NotificationsPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <NotificationsScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/notifications')({
  component: NotificationsPage,
})
