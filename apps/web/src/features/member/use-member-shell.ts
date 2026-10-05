import { useTranslation } from 'react-i18next'
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
 * the first two active members' monograms and the member-count line
 * (docs/design/README.md, "Layout"; the prototype's `data-space` and
 * `data-space-sub`), the visible sections, the sync state, the user menu
 * and the section nav. Every member area — the home, the journal, the
 * calendar, the wishlist, the space settings — hands the same shapes to
 * the layout, so the top bar and the sidebar look the same everywhere and
 * no area passes an empty monogram list.
 */

export interface MemberShellData {
  /** True while the session probe is in flight; the area shows its spinner. */
  sessionPending: boolean
  space: SpaceSummary
  sections: ShellSection[]
  sync: ShellSyncState | null
  userMenuItems: ShellUserMenuItem[]
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
  // The monograms are the space's, not the viewer's: the first two active
  // members, exactly what the prototype's shell builder stamps into the
  // switcher (ohana.js, `SPACES[0].marks`) — the owner leading, then the
  // elders by creation. An archived member has left the space (issue #23)
  // and takes no seat. The store reads rows in key order, so the order is
  // decided here, not by the storage.
  const activeMembers = (snapshot.data?.members ?? [])
    .filter((profile) => profile.archivedAt === undefined)
    .sort((a, b) => {
      if ((a.role === 'owner') !== (b.role === 'owner')) return a.role === 'owner' ? -1 : 1
      return a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt.localeCompare(b.createdAt)
    })
  const marked = activeMembers.length > 0 ? activeMembers : me ? [me.member] : []
  const marks = marked.slice(0, 2).map((profile) => ({
    initials: monogramOf(profile.displayName ?? profile.name),
    hue: hueFromId(profile.id),
  }))

  // The count line is what the device has downloaded: a partition that
  // never synced knows only the viewer, and a made-up count would be a
  // lie — the line waits, like the home's empty sections do (ADR-0002).
  const downloaded = snapshot.data?.revision !== undefined
  const owner = me?.member.role === 'owner'
  const membersLabel = downloaded
    ? t('layout.spaceSub', { count: activeMembers.length, role: owner ? 'owner' : 'regular' })
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
    onSectionClick,
  }
}
