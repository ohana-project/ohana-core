import { createFileRoute } from '@tanstack/react-router'
import { EventScreen } from '@/features/calendar/event-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * One event (issues #20 and #21): its device-local time with the zone it
 * keeps, and the creator's or owner's edit and delete. The optional `date`
 * names an occurrence of a repeating event — the screen shows that
 * occurrence, the link the calendar's lists carry.
 */
function EventPage() {
  const { eventId } = Route.useParams()
  const { date } = Route.useSearch()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <EventScreen eventId={eventId} occurrenceDate={date} />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/calendar/$eventId')({
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const date = search.date
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}
  },
  component: EventPage,
})
