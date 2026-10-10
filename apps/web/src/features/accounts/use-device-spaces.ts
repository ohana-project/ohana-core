import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { type MemberSnapshot, readMemberSnapshot } from '@/data/local-store.ts'
import {
  getActiveMemberId,
  listStoredSessions,
  type StoredMemberSession,
} from '@/data/session-registry.ts'
import { orderedActiveMembers } from '@/features/member/member-order.ts'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { syncedSnapshotKey } from '@/features/member/use-synced-space.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import type { MemberMark } from '@/ui/shell.ts'

/*
 * One row of data per sign-in kept on this device (issue #64): the Spaces
 * sheet and the accounts screen's rows both read this one hook, so the two
 * displays can never disagree. The stack and the count line are each
 * partition's own — every retained sign-in keeps its synchronised
 * partition on this device (ADR-0005), and reading it is a local read, the
 * same one the offline identity assembles itself from. A space whose
 * partition was never downloaded names its signed-in member instead of
 * inventing a count, like the sidebar's line waits (ADR-0002).
 */

export interface DeviceSpace {
  /** The retained sign-in the row answers for. */
  session: StoredMemberSession
  /** The device's active sign-in, already checked in the sheet's rows. */
  active: boolean
  /** The space's active members in the stack's order; the signed-in member alone when nothing is downloaded. */
  marks: MemberMark[]
  /** The translated count line once the partition is downloaded; undefined before that. */
  membersLabel?: string
  /** The partition's last successful sync, in epoch milliseconds; undefined when it never synced. */
  syncedAt?: number
}

export function useDeviceSpaces(): DeviceSpace[] {
  const { t } = useTranslation()
  const sessions = listStoredSessions()
  const activeMemberId = getActiveMemberId()
  // The active member's role is the probe's word — the same source the
  // sidebar's count line reads (use-member-shell.ts), so the sheet's open
  // row and the line above it answer "am I the owner" with one word. The
  // other rows have no probe: their partition's own row is all there is.
  const { me } = useMemberSessionStatus()
  // One snapshot query per retained sign-in, keyed exactly like the
  // synced-space read: the sync engine's invalidations flow to these rows
  // for free, and a cache the active member's screens already hold is
  // reused, not fetched twice.
  const snapshots = useQueries({
    queries: sessions.map((session) => ({
      queryKey: syncedSnapshotKey(session.memberId),
      queryFn: (): Promise<MemberSnapshot> => readMemberSnapshot(session.memberId),
    })),
  })

  return sessions.map((session, index) => {
    const snapshot = snapshots[index]?.data
    const active = session.memberId === activeMemberId
    // The stack never rides an empty seat: until the partition lands, the
    // signed-in member stands in, exactly like the shell builder's
    // fallback (use-member-shell.ts).
    const stacked =
      snapshot !== undefined && snapshot.members.length > 0
        ? orderedActiveMembers(snapshot.members)
        : []
    const marks = (
      stacked.length > 0
        ? stacked
        : [
            {
              id: session.memberId,
              name: session.displayName ?? session.name,
              role: 'regular' as const,
              createdAt: '',
            },
          ]
    ).map((profile) => ({
      id: profile.id,
      initials: monogramOf(profile.displayName ?? profile.name),
      hue: hueFromId(profile.id),
    }))

    // The count line is what the row's own partition has downloaded. The
    // owner note follows the probe on the active row (above); after a role
    // change the other rows may trail until their sync catches up, as
    // documented in use-member-shell.ts.
    const downloaded = snapshot?.revision !== undefined
    const ownRole =
      session.memberId === me?.member.id
        ? me.member.role
        : snapshot?.members.find((profile) => profile.id === session.memberId)?.role
    const membersLabel = downloaded
      ? t('layout.spaceSub', {
          count: stacked.length,
          role: ownRole === 'owner' ? 'owner' : 'regular',
        })
      : undefined

    return { session, active, marks, membersLabel, syncedAt: snapshot?.syncedAt }
  })
}
