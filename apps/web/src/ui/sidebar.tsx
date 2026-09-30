import { cn } from 'cn'
import { useTranslation } from 'react-i18next'

import { Avatar } from '@/ui/avatar.tsx'
import { AvatarStack } from '@/ui/avatar-stack.tsx'
import { Icon } from '@/ui/icon.tsx'
import type { ShellSection, SpaceSummary } from '@/ui/shell.ts'
import { SyncStatus, type SyncStatusProps } from '@/ui/sync-status.tsx'

/*
 * Ohana sidebar (`.sidebar` in the prototype): solid paper, 232px,
 * shown from 920px up. The space switcher on top, the visible
 * sections, sync in the footer. Glass is never used here.
 */

export interface SidebarProps {
  space: SpaceSummary
  sections: ShellSection[]
  activeId?: string
  sync?: SyncStatusProps | null
  onSpaceClick?: () => void
  onSectionClick?: (id: string) => void
  className?: string
}

export function Sidebar({
  space,
  sections,
  activeId,
  sync,
  onSpaceClick,
  onSectionClick,
  className,
}: SidebarProps) {
  const { t } = useTranslation()

  return (
    <aside
      data-slot="sidebar"
      className={cn(
        'sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-border bg-background desktop:flex',
        className,
      )}
    >
      <button
        type="button"
        data-slot="side-space"
        onClick={onSpaceClick}
        className="flex w-full items-center gap-2.5 px-3.5 pt-3.5 pb-2.5 text-left transition-colors duration-(--t-fast) ease-(--ease) hover:bg-accent"
      >
        <AvatarStack>
          {space.marks.slice(0, 2).map((mark) => (
            <Avatar key={`${mark.initials}-${mark.hue}`} size="sm" hue={mark.hue}>
              {mark.initials}
            </Avatar>
          ))}
        </AvatarStack>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold">{space.name}</span>
          {space.membersLabel && (
            <span className="block truncate text-xs text-muted-foreground">
              {space.membersLabel}
            </span>
          )}
        </span>
        <Icon name="chevron-down" className="shrink-0 text-muted-foreground" />
      </button>

      <nav aria-label={t('layout.sections')} className="flex flex-col gap-0.5 px-2.5 py-1.5">
        {sections.map((section) => {
          const active = section.id === activeId
          return (
            <button
              key={section.id}
              type="button"
              data-slot="nav-item"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSectionClick?.(section.id)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[15px] font-medium transition-colors duration-(--t-fast) ease-(--ease) hover:bg-accent hover:text-foreground',
                active ? 'bg-primary-soft text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon name={section.icon} className="size-5 shrink-0" />
              <span className="truncate">{section.label}</span>
            </button>
          )
        })}
      </nav>

      {sync && (
        <div className="mt-auto flex flex-col gap-2.5 border-t border-border p-3">
          <SyncStatus {...sync} size="lg" />
        </div>
      )}
    </aside>
  )
}
