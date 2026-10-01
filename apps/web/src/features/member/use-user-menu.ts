import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useMemberSessionStatus, useMemberSignOut } from '@/features/member/use-member-session.ts'
import type { ShellUserMenuItem } from '@/ui/shell.ts'
import { toast } from '@/ui/toast.tsx'

/*
 * The user menu every member-area shell carries (docs/design/README.md,
 * "Layout"): the members screen, the owner's space settings where the API
 * would accept them, the accounts screen, and sign-out. One builder for
 * the shells, so every screen reaches the others the way the home does.
 */
export function useMemberUserMenu(): ShellUserMenuItem[] {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useMemberSessionStatus()
  const signOut = useMemberSignOut()

  const build = useCallback((): ShellUserMenuItem[] => {
    const me = session.me
    if (me === undefined) return []
    return [
      {
        id: 'members',
        label: t('space.members.title'),
        icon: 'users',
        onSelect: () => void navigate({ to: '/members' }),
      },
      // The space settings are an owner instrument (issue #12); the menu
      // shows the entry only where the API would accept it.
      ...(me.member.role === 'owner'
        ? [
            {
              id: 'space-settings',
              label: t('space.settings.title'),
              icon: 'settings' as const,
              onSelect: () => void navigate({ to: '/settings' }),
            },
          ]
        : []),
      {
        id: 'accounts',
        label: t('member.home.accounts'),
        icon: 'users',
        onSelect: () => void navigate({ to: '/accounts' }),
      },
      {
        id: 'sign-out',
        label: t('member.home.signOut'),
        icon: 'log-out',
        danger: true,
        onSelect: () =>
          signOut.mutate(me.member.id, {
            // A failed sign-out keeps the member signed in; it must not look
            // like the menu did nothing.
            onError: () => toast(t('member.home.signOutFailed'), 'danger'),
          }),
      },
    ]
  }, [navigate, session.me, signOut, t])

  // The menu is rebuilt per render like the screens that inline it; the
  // shells treat the items as plain props.
  return build()
}
