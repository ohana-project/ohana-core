import { createFileRoute } from '@tanstack/react-router'
import { EventEditorScreen } from '@/features/calendar/event-editor-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * The event's editor (issues #20 and #21): the creator's or owner's
 * replace of the whole event — or, when a `date` names an occurrence, of
 * that one occurrence alone.
 */
function EditEventPage() {
  const { eventId } = Route.useParams()
  const { date } = Route.useSearch()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <EventEditorScreen eventId={eventId} occurrenceDate={date} />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/calendar/$eventId_/edit')({
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const date = search.date
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}
  },
  component: EditEventPage,
})
