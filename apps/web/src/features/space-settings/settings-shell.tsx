import type { ReactNode } from 'react'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { ShellBackLink } from '@/features/member/shell-back-link.tsx'
import { useMemberShell } from '@/features/member/use-member-shell.ts'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The space settings area's shell (docs/design/screens/members.html,
 * member-card.html, invite.html, space-settings.html): the member shell
 * with the screen's title in the top bar and a back arrow — the
 * prototype's 44px round `.m-only` button, below 920px only — to the
 * members screen inside the area, to home at its edge (issue #62). The
 * shell data — monograms included, like every member area — comes from
 * the one builder; the section navigation is the space's own visible
 * sections (issue #13) and the sync state travels with the shell, so the
 * footer's indicator answers offline exactly as the home's does.
 */

export function SettingsShell({
  title,
  backTo = '/',
  width = 'narrow',
  desktopActions,
  children,
}: {
  title: string
  backTo?: '/' | '/members'
  width?: 'default' | 'narrow'
  /** The screen's desktop-only top-bar actions, like the prototype's `d-only`. */
  desktopActions?: ReactNode
  children: ReactNode
}) {
  const shell = useMemberShell()

  if (shell.sessionPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <MemberLayout
      space={shell.space}
      sections={shell.sections}
      sync={shell.sync}
      title={title}
      width={width}
      userMenuItems={shell.userMenuItems}
      desktopActions={desktopActions}
      back={<ShellBackLink to={backTo} />}
      onSpaceClick={shell.onSpaceClick}
      onSectionClick={shell.onSectionClick}
    >
      {children}
    </MemberLayout>
  )
}
