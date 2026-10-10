import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { ShellBackLink } from '@/features/member/shell-back-link.tsx'
import { useMemberShell } from '@/features/member/use-member-shell.ts'
import { ALL_SECTIONS_VISIBLE } from '@/features/member/use-nav-sections.ts'
import { useSyncedSpace } from '@/features/member/use-synced-space.ts'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The calendar area's shell (docs/design/screens/calendar.html): the
 * member shell with the calendar section active, a back arrow — the
 * prototype's 44px round `.m-only` button, below 920px only — where the
 * screen sits below the month, and the top-bar actions the prototype
 * marks `d-only`: on a phone the FAB carries them (issue #62). Everything
 * reads the local store, so the shell answers offline like the screens
 * inside it (ADR-0002); the shell data itself comes from the one builder
 * every member area shares. When the owner has hidden the section
 * (ADR-0011), the shell says so instead of rendering a screen whose every
 * request the API answers 404 — the navigation already lacks the item;
 * this covers a direct URL or a stale tab.
 */
export function CalendarShell({
  title,
  backTo,
  width = 'default',
  desktopActions,
  children,
}: {
  title?: string
  backTo?: string
  width?: 'default' | 'narrow' | 'wide'
  desktopActions?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const shell = useMemberShell()
  const snapshot = useSyncedSpace()

  if (shell.sessionPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  // The map is what the device has downloaded; while nothing is, the
  // default is every section visible, the same answer the navigation gives.
  const visibility = snapshot.data?.space?.sections ?? ALL_SECTIONS_VISIBLE
  const screen =
    visibility.calendar === false ? (
      <Card>
        <Empty>
          <EmptyMedia>
            <Icon name="eye-off" />
          </EmptyMedia>
          <EmptyTitle>{t('calendar.errors.section_hidden')}</EmptyTitle>
          <EmptyDescription>{t('calendar.hiddenHint')}</EmptyDescription>
        </Empty>
      </Card>
    ) : (
      children
    )

  return (
    <MemberLayout
      space={shell.space}
      sections={shell.sections}
      activeId="calendar"
      sync={shell.sync}
      title={title}
      width={width}
      userMenuItems={shell.userMenuItems}
      desktopActions={visibility.calendar === false ? undefined : desktopActions}
      back={backTo === undefined ? undefined : <ShellBackLink to={backTo} />}
      onSpaceClick={shell.onSpaceClick}
      onSectionClick={shell.onSectionClick}
    >
      {screen}
    </MemberLayout>
  )
}
