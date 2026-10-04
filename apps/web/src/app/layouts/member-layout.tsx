import type * as React from 'react'
import { UpdatePrompt } from '@/features/update/update-prompt.tsx'
import { cn } from '@/lib/cn'
import type { ShellSection, ShellSyncState, ShellUserMenuItem, SpaceSummary } from '@/ui/shell.ts'
import { Sidebar } from '@/ui/sidebar.tsx'
import { TabBar } from '@/ui/tab-bar.tsx'
import { TopBar } from '@/ui/top-bar.tsx'

/*
 * Member shell (docs/design/README.md, "Layout"): a glass tab bar
 * below 920px, a solid 232px sidebar from 920px up, the top bar on
 * both. Content is centred and reserves room for the tab bar and the
 * FAB — and, when a screen mounts the shared action bar (issue #61),
 * for the bar itself: its `--action-bar-h` (64px) plus a 16px gap on
 * top of the tab bar reserve and the safe-area inset the bar clears.
 * One visible section
 * must hold on its own — hidden sections simply disappear from the
 * navigation.
 */

export interface MemberLayoutProps {
  space: SpaceSummary
  sections: ShellSection[]
  activeId?: string
  sync?: ShellSyncState | null
  userMenuItems?: ShellUserMenuItem[]
  actions?: React.ReactNode
  back?: React.ReactNode
  title?: string
  width?: 'default' | 'narrow' | 'wide'
  onSpaceClick?: () => void
  onSectionClick?: (id: string) => void
  /** The screen mounts its own FAB; the layout reserves space for it. */
  children: React.ReactNode
}

export function MemberLayout({
  space,
  sections,
  activeId,
  sync = null,
  userMenuItems = [],
  actions,
  back,
  title,
  width = 'default',
  onSpaceClick,
  onSectionClick,
  children,
}: MemberLayoutProps) {
  const topBarTitle =
    title ?? sections.find((section) => section.id === activeId)?.label ?? space.name

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        space={space}
        sections={sections}
        activeId={activeId}
        sync={sync ? { ...sync } : null}
        onSpaceClick={onSpaceClick}
        onSectionClick={onSectionClick}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={topBarTitle}
          space={space}
          actions={actions}
          back={back}
          sync={sync ? { ...sync } : null}
          userMenuItems={userMenuItems}
          onSpaceClick={onSpaceClick}
        />
        <main
          className={cn(
            'mx-auto w-full px-(--pad) pb-[calc(var(--tabbar-h)+28px)] has-data-[slot=fab]:pb-[calc(var(--tabbar-h)+96px)] has-data-[slot=action-bar]:pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+var(--action-bar-h)+16px)] desktop:pb-12 desktop:has-data-[slot=fab]:pb-12 desktop:has-data-[slot=action-bar]:pb-12',
            width === 'default' && 'max-w-[var(--content-w)]',
            width === 'narrow' && 'max-w-[var(--content-w-narrow)]',
            width === 'wide' && 'max-w-[var(--content-w-wide)]',
          )}
        >
          <UpdatePrompt className="pt-4" />
          {children}
        </main>
      </div>
      <TabBar sections={sections} activeId={activeId} onSectionClick={onSectionClick} />
    </div>
  )
}
