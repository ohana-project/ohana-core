import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AdminSessionGate } from '@/features/admin/admin-session-gate.tsx'

/*
 * The administrative area root: signed-out visitors go to the sign-in
 * screen; until ticket #8 brings the spaces list, a signed-in
 * administrator lands on the password screen.
 */
function AdminIndexPage() {
  return (
    <AdminSessionGate require="signed-in" redirectTo="/admin/login">
      <Navigate to="/admin/password" replace />
    </AdminSessionGate>
  )
}

export const Route = createFileRoute('/admin/')({
  component: AdminIndexPage,
})
