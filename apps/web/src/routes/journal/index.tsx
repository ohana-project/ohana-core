import { createFileRoute } from '@tanstack/react-router'
import { JournalScreen } from '@/features/journal/journal-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * The journal feed (issue #15): the space's shared entries, the drafts
 * corner beside them.
 */
function JournalPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <JournalScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/journal/')({
  component: JournalPage,
})
