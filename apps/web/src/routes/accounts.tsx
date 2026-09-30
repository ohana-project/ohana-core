import { createFileRoute } from '@tanstack/react-router'
import { AccountsScreen } from '@/features/accounts/accounts-screen.tsx'

/*
 * The accounts screen (issue #10): the retained sign-ins of this device
 * and the active member's device review. Reachable from the user menu;
 * shows whatever the device retains even without an active session.
 */
function AccountsPage() {
  return <AccountsScreen />
}

export const Route = createFileRoute('/accounts')({
  component: AccountsPage,
})
