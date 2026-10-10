import { useTranslation } from 'react-i18next'
import { openSpacesSheet } from '@/features/accounts/spaces-sheet.tsx'
import { orderedActiveMembers } from '@/features/member/member-order.ts'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { useNavSections } from '@/features/member/use-nav-sections.ts'
import { useSectionNav } from '@/features/member/use-section-nav.ts'
import { useSyncStatus } from '@/features/member/use-sync-status.ts'
import { useSyncedSpace } from '@/features/member/use-synced-space.ts'
import { useMemberUserMenu } from '@/features/member/use-user-menu.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import type { ShellSection, ShellSyncState, ShellUserMenuItem, SpaceSummary } from '@/ui/shell.ts'

/*
 * One place builds the member shell's data (issue #62): the space with
 * the active members' monograms in the stack's order and the
 * member-count line
 * (docs/design/README.md, "Layout"; the prototype's `data-space` and
 * `data-space-sub`), the visible sections, the sync state, the user menu
 * and the section nav. Every member area — the home, the journal, the
 * calendar, the wishlist, the space settings — hands the same shapes to
 * the layout, so the top bar and the sidebar look the same everywhere and
 * no area passes an empty monogram list. The switcher's opener rides the
 * same shape (issue #64): the prototype's shell opens its account sheet
 * from one place (`data-menu="tpl-account"` on the top bar, the sidebar
 * and the menu item), so every screen opens the same sheet.
 */

export interface MemberShellData {
  /** True while the session probe is in flight; the area shows its spinner. */
  sessionPending: boolean
  space: SpaceSummary
  sections: ShellSection[]
  sync: ShellSyncState | null
  userMenuItems: ShellUserMenuItem[]
  /** Opens the «Пространства» sheet; the layout wires it to the switchers. */
  onSpaceClick: () => void
  onSectionClick: (id: string) => void
}

export function useMemberShell(): MemberShellData {
  const { t } = useTranslation()
  const session = useMemberSessionStatus()
  const snapshot = useSyncedSpace()
  const sections = useNavSections()
  const sync = useSyncStatus()
  const userMenuItems = useMemberUserMenu()
  const onSectionClick = useSectionNav()

  const me = session.me
  // The monograms are the space's, not the viewer's: the active members
  // in the stack's order — exactly the order the prototype's shell
  // builder stamps into the switcher (ohana.js, `SPACES[0].marks`) — and
  // the stack itself shows at most two, the display's own cap.
  const activeMembers = orderedActiveMembers(snapshot.data?.members ?? [])
  const marked = activeMembers.length > 0 ? activeMembers : me ? [me.member] : []
  const marks = marked.map((profile) => ({
    id: profile.id,
    initials: monogramOf(profile.displayName ?? profile.name),
    hue: hueFromId(profile.id),
  }))

  // The count line is what the device has downloaded: a partition that
  // never synced knows only the viewer, and a made-up count would be a
  // lie — the line waits, like the home's empty sections do (ADR-0002).
  const downloaded = snapshot.data?.revision !== undefined
  // The viewer's role is the probe's word — the same source the user
  // menu's settings entry gates on (use-user-menu.ts), so the line and
  // the menu answer "am I the owner" with one word. The stack's order
  // and the screens' owner badges read the synced snapshot instead, so
  // after a role change the two may disagree until both the probe and
  // the sync have caught up.
  const ownRole = me?.member.role
  const membersLabel = downloaded
    ? t('layout.spaceSub', {
        count: activeMembers.length,
        role: ownRole === 'owner' ? 'owner' : 'regular',
      })
    : undefined

  return {
    sessionPending: session.status === 'pending',
    space: {
      name: snapshot.data?.space?.name ?? me?.space.name ?? '',
      membersLabel,
      marks,
    },
    sections,
    sync,
    userMenuItems,
    onSpaceClick: openSpacesSheet,
    onSectionClick,
  }
}
