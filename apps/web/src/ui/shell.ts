import type { IconName } from '@/ui/icon.tsx'
import type { SyncStatusProps } from '@/ui/sync-status.tsx'

/*
 * Data the app shells take as props. Sign-in, section visibility and
 * sync are wired by their own tickets (#9, #13, #14) — the layouts
 * stay pure presentations of this shape.
 */

/** A member monogram: initials plus the warm avatar hue. */
export interface MemberMark {
  initials: string
  hue: number
}

export interface SpaceSummary {
  name: string
  /** e.g. «4 участника · вы владелец», already translated. */
  membersLabel?: string
  marks: MemberMark[]
}

export interface ShellSection {
  id: string
  label: string
  icon: IconName
}

export interface ShellSyncState {
  state: SyncStatusProps['state']
  syncedAt?: SyncStatusProps['syncedAt']
  onRetry?: () => void
}

export interface ShellUserMenuItem {
  id: string
  label: string
  icon: IconName
  danger?: boolean
  /**
   * The accessible name when it differs from the visible label — the
   * theme item names the theme it leads to, like the prototype's
   * `data-action="theme"` buttons (issue #63).
   */
  ariaLabel?: string
  /** Draws the prototype's hairline above the item (the user menu's grouping, issue #63). */
  separatorBefore?: boolean
  onSelect?: () => void
}
