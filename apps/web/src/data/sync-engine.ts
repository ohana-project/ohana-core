import { api } from '@/data/api.ts'
import { applySyncResult, readMemberSnapshot, type SyncResult } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'

/*
 * The sync engine (issue #14, ADR-0014): for the active member it calls the
 * sync endpoint with the stored cursor and applies the answer to the
 * member's IndexedDB partition. Mutations trigger it after they succeed;
 * screens re-read their partition when it lands. The status it reports
 * drives the indicator (ADR-0002): initial, in progress, up to date,
 * offline, server unavailable, and error — cached data stays readable in
 * every one of them.
 */

export type SyncEngineState = 'first' | 'updating' | 'synced' | 'offline' | 'unreachable' | 'error'

export interface SyncStatus {
  state: SyncEngineState
  /** When the last sync for this member succeeded, in epoch milliseconds. */
  syncedAt?: number
}

const statuses = new Map<string, SyncStatus>()

type StatusListener = () => void
const statusListeners = new Set<StatusListener>()

type AppliedListener = (memberId: string) => void
const appliedListeners = new Set<AppliedListener>()

/** Subscribes to status changes; returns the unsubscribe function. */
export function subscribeSyncStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** The last status reported for the member; undefined before the first run. */
export function getSyncStatus(memberId: string): SyncStatus | undefined {
  return statuses.get(memberId)
}

/** Notified after a response was applied to the member's store. */
export function onSyncApplied(listener: AppliedListener): () => void {
  appliedListeners.add(listener)
  return () => appliedListeners.delete(listener)
}

function setStatus(memberId: string, status: SyncStatus): void {
  statuses.set(memberId, status)
  for (const listener of statusListeners) listener()
}

const inFlight = new Set<string>()

/**
 * Runs one sync for the member (default: the active one). Concurrent runs
 * for the same member collapse into the one already going, so a mutation
 * and a reconnect cannot race two responses into the store.
 */
export async function triggerSync(memberId?: string): Promise<void> {
  const who = memberId ?? getActiveMemberId()
  if (who === undefined || inFlight.has(who)) return
  inFlight.add(who)
  try {
    await runSync(who)
  } catch {
    // A failure the request handling did not expect — storage refusing to
    // open, for instance — is still a sync that failed.
    setStatus(who, { state: 'error', syncedAt: getSyncStatus(who)?.syncedAt })
  } finally {
    inFlight.delete(who)
  }
}

async function runSync(memberId: string): Promise<void> {
  const snapshot = await readMemberSnapshot(memberId)
  const hasData = snapshot.revision !== undefined

  if (!window.navigator.onLine) {
    setStatus(memberId, { state: 'offline', syncedAt: snapshot.syncedAt })
    return
  }

  setStatus(memberId, { state: hasData ? 'updating' : 'first', syncedAt: snapshot.syncedAt })

  let result: SyncResult
  try {
    const { data, error } = await api.GET('/api/v1/sync', {
      params: {
        query: { since: snapshot.revision ?? '0' },
        header: { 'x-ohana-member': memberId },
      },
    })
    if (error !== undefined || data === undefined) {
      // The server answered and refused: a dead session or an outage with
      // a response. The stored data stays as it is either way.
      setStatus(memberId, { state: 'error', syncedAt: snapshot.syncedAt })
      return
    }
    result = data
  } catch {
    // The request never produced an answer: no connection, or the server
    // did not respond at all.
    setStatus(memberId, {
      state: window.navigator.onLine ? 'unreachable' : 'offline',
      syncedAt: snapshot.syncedAt,
    })
    return
  }

  try {
    const storedRevision = await applySyncResult(memberId, result)
    setStatus(memberId, { state: 'synced', syncedAt: Date.now() })
    for (const listener of appliedListeners) listener(memberId)

    // A re-shown section reset the cursor to 0 inside the apply (ADR-0014):
    // the next sync, run right away, carries the section's full data again.
    if (storedRevision === '0') await runSync(memberId)
  } catch {
    // Applying failed locally — the response was fine, the store refused
    // it. The stored data is whatever the last successful apply left.
    setStatus(memberId, { state: 'error', syncedAt: snapshot.syncedAt })
  }
}
