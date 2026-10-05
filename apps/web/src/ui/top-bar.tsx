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
  /**
   * The screen's desktop-only actions (the prototype's `d-only`): they
   * mount into the bar from 920px up and render nothing below, where the
   * screen's FAB or action bar carries them instead (issue #62).
   */
  desktopActions?: React.ReactNode
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
  desktopActions,
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
        // the prototype's .topbar: a 1px fg 8% hairline below 920px; from
        // 920px up the hairline takes the border token
        // (assets/ohana.css, .topbar and its 920px media query)
        'glass-bar sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-[color-mix(in_oklch,var(--fg)_8%,transparent)] px-(--pad) py-2 desktop:border-border',
        className,
      )}
    >
      {back}
      {/* the prototype's `.topbar .topbar-space`: `width: auto; padding:
          0 6px; margin: 0 -6px` on the 44px round — the button is as
          wide as its stack, and no outer margin sits on the stack
          itself */}
      <button
        type="button"
        data-slot="topbar-space"
        aria-label={t('layout.space')}
        onClick={onSpaceClick}
        className="-mx-1.5 grid h-11 w-auto shrink-0 place-items-center rounded-full px-1.5 transition-colors duration-(--t-fast) ease-(--ease) hover:bg-accent desktop:hidden"
      >
        <AvatarStack>
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
        // the chip goes icon-only at 430px and below here and only here
        // (.topbar .sync .sync-text); the media query is spelled out
        // because Tailwind's max-* compiles to a strict width<430px and
        // the prototype hides at max-width: 430px inclusive. sr-only
        // keeps the words for screen readers, where the prototype's
        // display:none dropped them
        <span className="shrink-0 desktop:hidden [@media(max-width:430px)]:[&_[data-slot=sync-status-label]]:sr-only">
          <SyncStatus {...sync} />
        </span>
      )}
      <span className="min-w-0 flex-1" />
      {actions}
      {desktopActions && (
        // the prototype's .d-only: no display below 920px, the actions
        // as direct flex items above (display: contents)
        <span data-slot="topbar-actions-desktop" className="hidden desktop:contents">
          {desktopActions}
        </span>
      )}
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
