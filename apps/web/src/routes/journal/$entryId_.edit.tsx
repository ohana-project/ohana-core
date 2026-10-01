import { createFileRoute } from '@tanstack/react-router'
import { JournalEditorScreen } from '@/features/journal/journal-editor-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * Editing an entry (issue #15): the author's edit of a draft or of a
 * published entry — the state itself is not editable here.
 */
function JournalEditPage() {
  const { entryId } = Route.useParams()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <JournalEditorScreen entryId={entryId} />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/journal/$entryId_/edit')({
  component: JournalEditPage,
})
