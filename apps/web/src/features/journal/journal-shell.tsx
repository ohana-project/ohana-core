import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { useNavSections } from '@/features/member/use-nav-sections.ts'
import { useSectionNav } from '@/features/member/use-section-nav.ts'
import { useSyncStatus } from '@/features/member/use-sync-status.ts'
import { useMemberUserMenu } from '@/features/member/use-user-menu.ts'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The journal area's shell (docs/design/screens/diary.html): the member
 * shell with the journal section active, a back arrow where the screen
 * sits below the feed, and the user menu the other member areas carry.
 * Everything reads the local store, so the shell answers offline like the
 * screens inside it (ADR-0002).
 */
export function JournalShell({
  title,
  backTo,
  width = 'default',
  actions,
  children,
}: {
  title?: string
  backTo?: string
  width?: 'default' | 'narrow' | 'wide'
  actions?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const session = useMemberSessionStatus()
  const sections = useNavSections()
  const sync = useSyncStatus()
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
      activeId="journal"
      sync={sync}
      title={title}
      width={width}
      userMenuItems={userMenuItems}
      actions={actions}
      back={
        backTo === undefined ? undefined : (
          <Link
            to={backTo}
            aria-label={t('layout.back')}
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Icon name="chevron-left" className="size-5" />
          </Link>
        )
      }
      onSectionClick={onSectionClick}
    >
      {children}
    </MemberLayout>
  )
}
