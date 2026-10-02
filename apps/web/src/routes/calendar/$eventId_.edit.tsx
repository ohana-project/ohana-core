import { createFileRoute } from '@tanstack/react-router'
import { EventEditorScreen } from '@/features/calendar/event-editor-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * The event's editor (issue #20): the creator's or owner's replace of the
 * whole event.
 */
function EditEventPage() {
  const { eventId } = Route.useParams()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <EventEditorScreen eventId={eventId} />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/calendar/$eventId_/edit')({
  component: EditEventPage,
})
