import type * as React from 'react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

import { Avatar } from '@/ui/avatar.tsx'
import { AvatarStack } from '@/ui/avatar-stack.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu.tsx'
import { Icon } from '@/ui/icon.tsx'
import { LogoRound } from '@/ui/logo.tsx'
import type { ShellUserMenuItem, SpaceSummary } from '@/ui/shell.ts'
import { SyncStatus, type SyncStatusProps } from '@/ui/sync-status.tsx'

/*
 * Ohana top bar (`.topbar` in the prototype): glass, sticky. The
 * space switcher and the sync chip are mobile-only; the round mark
 * opens the user menu built from the items prop.
 */

export interface TopBarProps {
  title: string
  space: SpaceSummary
  actions?: React.ReactNode
  back?: React.ReactNode
  sync?: SyncStatusProps | null
  userMenuItems?: ShellUserMenuItem[]
  onSpaceClick?: () => void
  className?: string
}

export function TopBar({
  title,
  space,
  actions,
  back,
  sync,
  userMenuItems = [],
  onSpaceClick,
  className,
}: TopBarProps) {
  const { t } = useTranslation()

  return (
    <header
      data-slot="topbar"
      className={cn(
        'glass-bar sticky top-0 z-30 flex min-h-14 items-center gap-3 px-(--pad) py-2 desktop:border-b desktop:border-border',
        className,
      )}
    >
      {back}
      <button
        type="button"
        data-slot="topbar-space"
        aria-label={t('layout.space')}
        onClick={onSpaceClick}
        className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full px-1.5 transition-colors duration-(--t-fast) ease-(--ease) hover:bg-accent desktop:hidden"
      >
        <AvatarStack className="-ml-1">
          {space.marks.slice(0, 2).map((mark) => (
            <Avatar key={`${mark.initials}-${mark.hue}`} size="sm" hue={mark.hue}>
              {mark.initials}
            </Avatar>
          ))}
        </AvatarStack>
      </button>
      <span className="truncate font-display text-h2 font-semibold tracking-[-0.01em]">
        {title}
      </span>
      {sync && (
        <span className="shrink-0 desktop:hidden">
          <SyncStatus {...sync} />
        </span>
      )}
      <span className="min-w-0 flex-1" />
      {actions}
      {userMenuItems.length > 0 && <UserMenu items={userMenuItems} />}
    </header>
  )
}

function UserMenu({ items }: { items: ShellUserMenuItem[] }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t('layout.userMenu')}
            aria-haspopup="menu"
            className="grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-(--t-fast) ease-(--ease) hover:bg-accent"
          />
        }
      >
        <LogoRound className="size-[30px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <Fragment key={item.id}>
            {item.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={item.danger ? 'destructive' : 'default'}
              aria-label={item.ariaLabel}
              onClick={item.onSelect}
            >
              <Icon name={item.icon} />
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
