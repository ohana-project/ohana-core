import { createFileRoute } from '@tanstack/react-router'
import { JournalEditorScreen } from '@/features/journal/journal-editor-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * A new entry (issue #15): the editor without an entry — the first save
 * creates the draft.
 */
function JournalNewPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <JournalEditorScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/journal/new')({
  component: JournalNewPage,
})
