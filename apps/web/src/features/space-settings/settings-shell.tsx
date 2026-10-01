import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { useNavSections } from '@/features/member/use-nav-sections.ts'
import { useSectionNav } from '@/features/member/use-section-nav.ts'
import { useMemberUserMenu } from '@/features/member/use-user-menu.ts'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The space settings area (docs/design/screens/members.html,
 * member-card.html, invite.html, space-settings.html): the member shell
 * with the screen's title in the top bar and a back arrow — to the members
 * screen inside the area, to home at its edge. The section navigation is
 * the space's own visible sections (issue #13); the user menu travels with
 * the shell, so every screen of the area reaches the others and the
 * accounts screen the same way the home does.
 */

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
  const session = useMemberSessionStatus()
  const sections = useNavSections()
  const userMenuItems = useMemberUserMenu()
  const onSectionClick = useSectionNav()

  if (session.status === 'pending') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <MemberLayout
      space={{ name: session.me?.space.name ?? '', marks: [] }}
      sections={sections}
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
      onSectionClick={onSectionClick}
    >
      {children}
    </MemberLayout>
  )
}
