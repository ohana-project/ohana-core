import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { type MemberSnapshot, readMemberSnapshot } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { onSyncApplied, triggerSync } from '@/data/sync-engine.ts'

/*
 * The member's synchronised partition (issue #14): one query over the
 * IndexedDB snapshot, invalidated when the sync engine applies a response.
 * The same read serves online and offline, from local data (ADR-0002).
 */

export function syncedSnapshotKey(memberId: string | undefined) {
  return ['member', memberId, 'synced'] as const
}

export function useSyncedSpace() {
  const memberId = getActiveMemberId()
  return useQuery({
    queryKey: syncedSnapshotKey(memberId),
    queryFn:
      memberId === undefined
        ? skipToken
        : (): Promise<MemberSnapshot> => readMemberSnapshot(memberId),
  })
}

/**
 * Runs and re-runs the sync while a member session is active: on entering
 * the member area and again whenever the connection returns. Mounted once,
 * by the member session gate, so every member surface shares one trigger
 * and one re-read — a screen that mounts the snapshot query twice must not
 * mount two engines (mutations trigger their own syncs besides this).
 */
export function useSyncLifecycle(active: boolean): void {
  const queryClient = useQueryClient()
  const memberId = getActiveMemberId()

  useEffect(() => {
    if (!active || memberId === undefined) return
    void triggerSync(memberId)
    const applied = onSyncApplied((who) => {
      if (who === memberId) {
        void queryClient.invalidateQueries({ queryKey: syncedSnapshotKey(memberId) })
      }
    })
    const backOnline = () => void triggerSync(memberId)
    window.addEventListener('online', backOnline)
    return () => {
      applied()
      window.removeEventListener('online', backOnline)
    }
  }, [active, memberId, queryClient])
}
