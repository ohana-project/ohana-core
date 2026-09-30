import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AdminLayout } from '@/app/layouts/admin-layout.tsx'
import { AdminPasswordForm } from '@/features/admin/admin-password-form.tsx'
import { useAdminSession, useAdminSignOut } from '@/features/admin/use-admin-session.ts'
import { Button } from '@/ui/button.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'

function AdminPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useAdminSession()
  const signOut = useAdminSignOut()

  if (session.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (session.data === 'signed-out') {
    return <Navigate to="/admin/login" replace />
  }
  return (
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
  )
}

export const Route = createFileRoute('/admin/password')({
  component: AdminPasswordPage,
})
