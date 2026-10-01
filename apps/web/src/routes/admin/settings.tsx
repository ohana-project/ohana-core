import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AdminLayout } from '@/app/layouts/admin-layout.tsx'
import { AdminPasswordForm } from '@/features/admin/admin-password-form.tsx'
import { AdminSessionGate } from '@/features/admin/admin-session-gate.tsx'
import { AdminTopBarActions } from '@/features/admin/admin-top-bar-actions.tsx'
import { AdminTrashSettings } from '@/features/admin/admin-trash-settings.tsx'

/*
 * Instance settings (docs/design/screens/admin-settings.html): the trash
 * retention (issue #16) and the administrative password section. The
 * remaining sections arrive with their tickets.
 */
function AdminSettingsPage() {
  const { t } = useTranslation()
  return (
    <AdminSessionGate require="signed-in" redirectTo="/admin/login">
      <AdminLayout actions={<AdminTopBarActions showSettings={false} />}>
        <div className="flex flex-col gap-4">
          <header>
            <h1 className="text-display-lg">{t('admin.settings.title')}</h1>
          </header>
          <AdminTrashSettings />
          <AdminPasswordForm />
        </div>
      </AdminLayout>
    </AdminSessionGate>
  )
}

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
})
