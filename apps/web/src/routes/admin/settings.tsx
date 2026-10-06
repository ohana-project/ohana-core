import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AdminLayout } from '@/app/layouts/admin-layout.tsx'
import { AdminPasswordForm } from '@/features/admin/admin-password-form.tsx'
import { AdminSessionGate } from '@/features/admin/admin-session-gate.tsx'
import { AdminTopBarActions } from '@/features/admin/admin-top-bar-actions.tsx'
import { AdminTrashSettings } from '@/features/admin/admin-trash-settings.tsx'

/*
 * Instance settings (docs/design/screens/admin-settings.html): the 760px
 * column, 24px after the header and 26px between sections, padded cards,
 * and the closing meta line. The trash retention (issue #16) and the
 * administrative password section are the sections with an API behind
 * them; the prototype's «Сервер» section (backups, registration) arrives
 * with its ticket.
 */
function AdminSettingsPage() {
  const { t } = useTranslation()
  return (
    <AdminSessionGate require="signed-in" redirectTo="/admin/login">
      <AdminLayout width="narrow" actions={<AdminTopBarActions showSettings={false} />}>
        {/* The prototype's subtitle names the demo host, version, and
            uptime — deployment data no API carries (README, known
            defects), so the header keeps the title alone. */}
        <header className="mb-6">
          <h1 className="text-display-lg">{t('admin.settings.title')}</h1>
        </header>
        <div className="flex flex-col gap-6.5">
          <AdminTrashSettings />
          <AdminPasswordForm />
        </div>
        <p className="mt-6 text-meta font-mono text-muted-foreground uppercase">
          {t('admin.settings.privacyNote')}
        </p>
      </AdminLayout>
    </AdminSessionGate>
  )
}

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
})
