import { createFileRoute } from '@tanstack/react-router'
import { JournalDraftsScreen } from '@/features/journal/journal-drafts-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * The author's drafts (issue #15): the separate list only they see.
 */
function JournalDraftsPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <JournalDraftsScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/journal/drafts')({
  component: JournalDraftsPage,
})
