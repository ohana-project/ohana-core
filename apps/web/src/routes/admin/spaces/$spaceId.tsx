import { createFileRoute } from '@tanstack/react-router'
import { AdminLayout } from '@/app/layouts/admin-layout.tsx'
import { AdminSessionGate } from '@/features/admin/admin-session-gate.tsx'
import { AdminSpaceDetail } from '@/features/admin/admin-space-detail.tsx'
import { AdminTopBarActions } from '@/features/admin/admin-top-bar-actions.tsx'

function AdminSpacePage() {
  const { spaceId } = Route.useParams()
  return (
    <AdminSessionGate require="signed-in" redirectTo="/admin/login">
      <AdminLayout back actions={<AdminTopBarActions />}>
        <AdminSpaceDetail spaceId={spaceId} />
      </AdminLayout>
    </AdminSessionGate>
  )
}

export const Route = createFileRoute('/admin/spaces/$spaceId')({
  component: AdminSpacePage,
})
