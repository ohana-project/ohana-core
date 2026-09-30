import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AdminLayout } from '@/app/layouts/admin-layout.tsx'
import { AdminPasswordForm } from '@/features/admin/admin-password-form.tsx'
import { AdminSessionGate } from '@/features/admin/admin-session-gate.tsx'
import { useAdminSignOut } from '@/features/admin/use-admin-session.ts'
import { Button } from '@/ui/button.tsx'
import { Icon } from '@/ui/icon.tsx'
import { toast } from '@/ui/toast.tsx'

function AdminPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const signOut = useAdminSignOut()

  return (
    <AdminSessionGate require="signed-in" redirectTo="/admin/login">
      <AdminLayout
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('admin.signOut')}
            disabled={signOut.isPending}
            onClick={() =>
              signOut.mutate(undefined, {
                onSuccess: () => void navigate({ to: '/admin/login' }),
                onError: () => toast(t('admin.errors.unexpected'), 'danger'),
              })
            }
          >
            <Icon name="log-out" />
          </Button>
        }
      >
        <AdminPasswordForm />
      </AdminLayout>
    </AdminSessionGate>
  )
}

export const Route = createFileRoute('/admin/password')({
  component: AdminPasswordPage,
})
