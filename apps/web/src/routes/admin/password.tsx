import { createFileRoute, Navigate } from '@tanstack/react-router'

/*
 * The password form moved into the instance-settings screen; the old
 * address keeps working as a redirect.
 */
function AdminPasswordPage() {
  return <Navigate to="/admin/settings" replace />
}

export const Route = createFileRoute('/admin/password')({
  component: AdminPasswordPage,
})
