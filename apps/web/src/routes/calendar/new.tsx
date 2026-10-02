import { createFileRoute } from '@tanstack/react-router'
import { EventEditorScreen } from '@/features/calendar/event-editor-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * A new event (issue #20): the editor with the space's zone as the
 * timed kind's default.
 */
function NewEventPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <EventEditorScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/calendar/new')({
  component: NewEventPage,
})
