import { createFileRoute } from '@tanstack/react-router'
import { JournalEntryScreen } from '@/features/journal/journal-entry-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * One journal entry (issue #15): a published entry for every member, the
 * author's draft for the author.
 */
function JournalEntryPage() {
  const { entryId } = Route.useParams()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <JournalEntryScreen entryId={entryId} />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/journal/$entryId')({
  component: JournalEntryPage,
})
