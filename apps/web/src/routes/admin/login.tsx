import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/app/layouts/auth-layout.tsx'
import { AdminLoginForm } from '@/features/admin/admin-login-form.tsx'
import { AdminSessionGate } from '@/features/admin/admin-session-gate.tsx'

function AdminLoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <AuthLayout footer={t('admin.login.footer')}>
      <AdminSessionGate require="signed-out" redirectTo="/admin">
        <AdminLoginForm onSignedIn={() => void navigate({ to: '/admin' })} />
      </AdminSessionGate>
    </AuthLayout>
  )
}

export const Route = createFileRoute('/admin/login')({
  component: AdminLoginPage,
})
