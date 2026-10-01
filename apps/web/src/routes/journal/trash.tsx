import { createFileRoute } from '@tanstack/react-router'
import { JournalTrashScreen } from '@/features/journal/journal-trash-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * The trash (issue #16): the trashed entries with their deletion dates.
 */
function JournalTrashPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <JournalTrashScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/journal/trash')({
  component: JournalTrashPage,
})
