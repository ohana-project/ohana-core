import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { MembersScreen } from '@/features/space-settings/members-screen.tsx'

/*
 * The space members screen (issue #12): the space's people with their
 * roles; the owner's instruments live one tap deeper.
 */
function MembersPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <MembersScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/members/')({
  component: MembersPage,
})
