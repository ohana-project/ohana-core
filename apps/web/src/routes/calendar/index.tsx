import { createFileRoute } from '@tanstack/react-router'
import { CalendarScreen } from '@/features/calendar/calendar-screen.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'

/*
 * The calendar (issue #20): the month grid beside the agenda, read from
 * the member's synchronised partition.
 */
function CalendarPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <CalendarScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/calendar/')({
  component: CalendarPage,
})
