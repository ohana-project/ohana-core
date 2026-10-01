import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { SpaceSettingsScreen } from '@/features/space-settings/space-settings-screen.tsx'

/*
 * The space settings (issue #12): the owner's space-level setting — the
 * default time zone for new events.
 */
function SpaceSettingsPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <SpaceSettingsScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/settings')({
  component: SpaceSettingsPage,
})
