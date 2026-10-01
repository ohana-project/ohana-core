import { useSyncExternalStore } from 'react'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { getSyncStatus, subscribeSyncStatus, triggerSync } from '@/data/sync-engine.ts'
import type { ShellSyncState } from '@/ui/shell.ts'

/*
 * The active member's sync status, shaped for the shell's indicator
 * (issue #14). The engine reports only settled facts; until the first
 * report for this member there is nothing to show, and the shell renders
 * no chip. The retry link is the component's own business — it shows it
 * in the failure states and calls back into the engine.
 */
export function useSyncStatus(): ShellSyncState | null {
  const memberId = getActiveMemberId()
  const status = useSyncExternalStore(subscribeSyncStatus, () => getSyncStatus(memberId ?? ''))
  if (memberId === undefined || status === undefined) return null
  return {
    state: status.state,
    syncedAt: status.syncedAt !== undefined ? new Date(status.syncedAt) : undefined,
    onRetry: () => void triggerSync(memberId),
  }
}
