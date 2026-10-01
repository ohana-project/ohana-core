import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { useMemberSessionStatus, useMemberSignOut } from '@/features/member/use-member-session.ts'
import { Icon } from '@/ui/icon.tsx'
import type { ShellSection, ShellUserMenuItem } from '@/ui/shell.ts'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'

/*
 * The space settings area (docs/design/screens/members.html,
 * member-card.html, invite.html, space-settings.html): the member shell
 * with the screen's title in the top bar and a back arrow — to the members
 * screen inside the area, to home at its edge. The section navigation stays
 * the space's own; only home is a real destination so far. The user menu
 * travels with the shell, so every screen of the area reaches the others
 * and the accounts screen the same way the home does.
 */

const sections: ShellSection[] = [
  { id: 'home', label: '', icon: 'home' },
  { id: 'journal', label: '', icon: 'book' },
  { id: 'calendar', label: '', icon: 'calendar' },
  { id: 'wishlist', label: '', icon: 'gift' },
]

const sectionLabels = {
  home: 'nav.home',
  journal: 'nav.journal',
  calendar: 'nav.calendar',
  wishlist: 'nav.wishlist',
} as const

export function SettingsShell({
  title,
  backTo = '/',
  width = 'narrow',
  children,
}: {
  title: string
  backTo?: '/' | '/members'
  width?: 'default' | 'narrow'
  children: ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useMemberSessionStatus()
  const signOut = useMemberSignOut()

  const localisedSections = sections.map((section) => ({
    ...section,
    label: t(sectionLabels[section.id as keyof typeof sectionLabels]),
  }))

  const me = session.me
  const userMenuItems: ShellUserMenuItem[] = me
    ? [
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
              // A failed sign-out keeps the member signed in; it must not
              // look like the menu did nothing.
              onError: () => toast(t('member.home.signOutFailed'), 'danger'),
            }),
        },
      ]
    : []

  if (session.status === 'pending') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <MemberLayout
      space={{ name: me?.space.name ?? '', marks: [] }}
      sections={localisedSections}
      title={title}
      width={width}
      userMenuItems={userMenuItems}
      back={
        <Link
          to={backTo}
          aria-label={t('space.back')}
          className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icon name="chevron-left" className="size-5" />
        </Link>
      }
      onSectionClick={(id) => {
        // Journal, calendar, and wishlist screens arrive with their own
        // tickets; until then only home is a real destination.
        if (id === 'home') void navigate({ to: '/' })
      }}
    >
      {children}
    </MemberLayout>
  )
}
