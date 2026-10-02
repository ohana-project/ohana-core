import { createFileRoute } from '@tanstack/react-router'
import { EventScreen } from '@/features/calendar/event-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * One event (issue #20): its device-local time with the zone it keeps,
 * and the creator's or owner's edit and delete.
 */
function EventPage() {
  const { eventId } = Route.useParams()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <EventScreen eventId={eventId} />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/calendar/$eventId')({
  component: EventPage,
})
