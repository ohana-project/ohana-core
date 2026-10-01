import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { MemberCardScreen } from '@/features/space-settings/member-card-screen.tsx'

/*
 * The member card (issue #12): one member of the space — role, code, and
 * devices for an owner; the read-only profile for a regular member.
 */
function MemberCardPage() {
  const { memberId } = Route.useParams()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <MemberCardScreen memberId={memberId} />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/members/$memberId')({
  component: MemberCardPage,
})
