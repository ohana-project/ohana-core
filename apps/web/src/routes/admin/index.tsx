import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAdminSession } from '@/features/admin/use-admin-session.ts'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The administrative area root: signed-out visitors go to the sign-in
 * screen; until ticket #8 brings the spaces list, a signed-in
 * administrator lands on the password screen.
 */
function AdminIndexPage() {
  const session = useAdminSession()

  if (session.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  return session.data === 'signed-in' ? (
    <Navigate to="/admin/password" replace />
  ) : (
    <Navigate to="/admin/login" replace />
  )
}

export const Route = createFileRoute('/admin/')({
  component: AdminIndexPage,
})
