import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { SpaceHomeScreen } from '@/features/member/space-home.tsx'

/*
 * The member landing: the space home with its section navigation. Without
 * a member session on this device the visitor is sent to the code screen.
 */
function HomePage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <SpaceHomeScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/')({
  component: HomePage,
})
