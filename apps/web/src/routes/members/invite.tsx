import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { InviteMemberScreen } from '@/features/space-settings/invite-member-screen.tsx'

/*
 * The invite screen (issue #12): an owner provisions a member and is handed
 * the one-time access code.
 */
function InviteMemberPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <InviteMemberScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/members/invite')({
  component: InviteMemberPage,
})
