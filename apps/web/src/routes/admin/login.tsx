import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AdminLoginForm } from '@/features/admin/admin-login-form.tsx'
import { useAdminSession } from '@/features/admin/use-admin-session.ts'
import { AuthLayout } from '@/ui/auth-layout.tsx'
import { Spinner } from '@/ui/spinner.tsx'

function AdminLoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useAdminSession()

  if (session.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (session.data === 'signed-in') {
    return <Navigate to="/admin" replace />
  }
  return (
    <AuthLayout footer={t('admin.login.footer')}>
      <AdminLoginForm onSignedIn={() => void navigate({ to: '/admin' })} />
    </AuthLayout>
  )
}

export const Route = createFileRoute('/admin/login')({
  component: AdminLoginPage,
})
