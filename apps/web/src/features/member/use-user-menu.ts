import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/app/theme.tsx'
import { openSpacesSheet } from '@/features/accounts/spaces-sheet.tsx'
import { useMemberSessionStatus, useMemberSignOut } from '@/features/member/use-member-session.ts'
import type { ShellUserMenuItem } from '@/ui/shell.ts'
import { toast } from '@/ui/toast.tsx'

/*
 * The user menu every member-area shell carries (docs/design/README.md,
 * "Layout"; issue #63): the member's destinations, then the prototype's
 * pair — «Тема», whose icon follows the current theme and whose press
 * switches it without leaving the app, and «Сменить пространство», which
 * opens the «Пространства» sheet like the prototype's own menu item
 * (issue #64) — then the way out, with the prototype's hairlines between
 * the three groups. One builder for the shells, so every screen reaches
 * the others the way the home does.
 */
export function useMemberUserMenu(): ShellUserMenuItem[] {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useMemberSessionStatus()
  const signOut = useMemberSignOut()
  const { resolved, setTheme } = useTheme()

  const build = useCallback((): ShellUserMenuItem[] => {
    const me = session.me
    if (me === undefined) return []
    const dark = resolved === 'dark'
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
        id: 'notifications',
        label: t('notifications.menuItem'),
        icon: 'bell',
        onSelect: () => void navigate({ to: '/notifications' }),
      },
      {
        id: 'theme',
        label: t('layout.theme.item'),
        // The glyph and the accessible name both show the theme one tap
        // away, like the prototype's «Тема» item: the moon in the light
        // theme, the sun in the dark, and the name names that theme.
        icon: dark ? 'sun' : 'moon',
        ariaLabel: dark ? t('layout.theme.light') : t('layout.theme.dark'),
        separatorBefore: true,
        onSelect: () => setTheme(dark ? 'light' : 'dark'),
      },
      // The sheet is mounted by the member gate; the menu opens it like
      // the prototype's `data-menu="tpl-account"` item (issue #64).
      {
        id: 'switch-space',
        label: t('layout.switchSpace'),
        icon: 'repeat',
        onSelect: () => openSpacesSheet(),
      },
      {
        id: 'sign-out',
        label: t('member.home.signOut'),
        icon: 'log-out',
        danger: true,
        separatorBefore: true,
        onSelect: () =>
          signOut.mutate(me.member.id, {
            // A failed sign-out keeps the member signed in; it must not look
            // like the menu did nothing.
            onError: () => toast(t('member.home.signOutFailed'), 'danger'),
          }),
      },
    ]
  }, [navigate, resolved, session.me, setTheme, signOut, t])

  // The menu is rebuilt per render like the screens that inline it; the
  // shells treat the items as plain props.
  return build()
}
