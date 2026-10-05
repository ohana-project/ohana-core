import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAdminSignOut } from '@/features/admin/use-admin-session.ts'
import { Button } from '@/ui/button.tsx'
import { Icon } from '@/ui/icon.tsx'
import { toast } from '@/ui/toast.tsx'

/*
 * Shared actions for the administrative top bar: instance settings and
 * sign-out. The settings entry houses the password change (folded from
 * the former standalone password screen). Both are 36px rounds (issue
 * #79) — the bar's actions share the theme toggle's `.btn-icon.btn-sm`
 * size, so the bar keeps its 56px.
 */
export function AdminTopBarActions({ showSettings = true }: { showSettings?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const signOut = useAdminSignOut()

  return (
    <>
      {showSettings ? (
        <Button variant="ghost" size="icon-sm" render={<Link to="/admin/settings" />}>
          <Icon name="settings" />
          <span className="sr-only">{t('admin.settings.title')}</span>
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
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
    </>
  )
}
