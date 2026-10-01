import { api } from '@/data/api.ts'
import { responseStatus } from '@/data/api-error.ts'
import {
  applySyncResult,
  deleteMemberData,
  readMemberSnapshot,
  type SyncResult,
} from '@/data/local-store.ts'
import { getActiveMemberId, removeSession } from '@/data/session-registry.ts'

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
// Bumped whenever a member is forgotten, so a sync in flight during
// sign-out knows its answer is no longer wanted.
const generations = new Map<string, number>()

type StatusListener = () => void
const statusListeners = new Set<StatusListener>()

type AppliedListener = (memberId: string) => void
const appliedListeners = new Set<AppliedListener>()

type RefusedListener = (memberId: string) => void
const refusedListeners = new Set<RefusedListener>()

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

/**
 * Notified when the API refused the member's session (401). The data-side
 * cleanup happens here in the engine; the screens' caches and the session
 * probe are reset by the member layer that subscribes to this — one
 * cleanup path for every way a member leaves the device.
 */
export function onMemberRefused(listener: RefusedListener): () => void {
  refusedListeners.add(listener)
  return () => refusedListeners.delete(listener)
}

function setStatus(memberId: string, status: SyncStatus): void {
  statuses.set(memberId, status)
  for (const listener of statusListeners) listener()
}

const inFlight = new Set<string>()
// Members whose sync was asked for while one was already running: the
// mutation or reconnect that came second still gets its own run.
const rerun = new Set<string>()

/**
 * Forgets everything the engine holds for the member: a running sync will
 * not apply its answer to a partition that was deleted meanwhile, and the
 * status does not outlive the member. Called when the member signs out and
 * when the API refuses their session.
 */
export function forgetSync(memberId: string): void {
  generations.set(memberId, (generations.get(memberId) ?? 0) + 1)
  rerun.delete(memberId)
  statuses.delete(memberId)
  for (const listener of statusListeners) listener()
}

/**
 * Runs one sync for the member (default: the active one). A run asked for
 * while one is already going is queued, not dropped: a mutation's sync
 * must not lose its turn to the mount's or the reconnect's.
 */
export async function triggerSync(memberId?: string): Promise<void> {
  const who = memberId ?? getActiveMemberId()
  if (who === undefined) return
  if (inFlight.has(who)) {
    rerun.add(who)
    return
  }
  const generation = generations.get(who) ?? 0
  inFlight.add(who)
  try {
    await runSync(who)
  } catch {
    // A failure the request handling did not expect — storage refusing to
    // open, for instance — is still a sync that failed. A member forgotten
    // mid-run stays forgotten.
    if ((generations.get(who) ?? 0) === generation) {
      setStatus(who, { state: 'error', syncedAt: getSyncStatus(who)?.syncedAt })
    }
  } finally {
    inFlight.delete(who)
    if (rerun.delete(who)) void triggerSync(who)
  }
}

async function runSync(memberId: string): Promise<void> {
  const generation = generations.get(memberId) ?? 0
  // A member forgotten mid-run (a sign-out, a refused session) leaves no
  // status behind and receives no writes.
  const forgotten = () => (generations.get(memberId) ?? 0) !== generation
  const snapshot = await readMemberSnapshot(memberId)
  if (forgotten()) return
  const hasData = snapshot.revision !== undefined

  if (!window.navigator.onLine) {
    setStatus(memberId, { state: 'offline', syncedAt: snapshot.syncedAt })
    return
  }

  setStatus(memberId, { state: hasData ? 'updating' : 'first', syncedAt: snapshot.syncedAt })

  let result: SyncResult
  try {
    const { data, error, response } = await api.GET('/api/v1/sync', {
      params: {
        query: { since: snapshot.revision ?? '0' },
        header: { 'x-ohana-member': memberId },
      },
    })
    if (error !== undefined || data === undefined) {
      // The server answered and refused. A 401 ends the member's presence
      // on the device; a 5xx behind a restarting proxy is the server being
      // unavailable, not an error of this device (ADR-0002); anything else
      // is an error. The stored data stays as it is either way.
      const status = responseStatus(response)
      if (status === 401) {
        forgetSync(memberId)
        // The session is gone — revoked or expired. The retained sign-in
        // and the synchronised partition go with it, the way a sign-out
        // would (ADR-0005); the member layer resets the screens' caches.
        removeSession(memberId)
        void deleteMemberData(memberId).catch(() => {})
        for (const listener of refusedListeners) listener(memberId)
        return
      }
      if (forgotten()) return
      setStatus(memberId, {
        state: status >= 500 ? 'unreachable' : 'error',
        syncedAt: snapshot.syncedAt,
      })
      return
    }
    result = data
  } catch {
    // The request never produced an answer: no connection, or the server
    // did not respond at all.
    if (forgotten()) return
    setStatus(memberId, {
      state: window.navigator.onLine ? 'unreachable' : 'offline',
      syncedAt: snapshot.syncedAt,
    })
    return
  }

  try {
    // The answer of a departed member is never written back.
    if (forgotten()) return
    const storedRevision = await applySyncResult(memberId, result)
    if (forgotten()) return
    setStatus(memberId, { state: 'synced', syncedAt: Date.now() })
    for (const listener of appliedListeners) listener(memberId)

    // A re-shown section reset the cursor to 0 inside the apply (ADR-0014):
    // the next sync, run right away, carries the section's full data again.
    if (storedRevision === '0') await runSync(memberId)
  } catch {
    // Applying failed locally — the response was fine, the store refused
    // it. The stored data is whatever the last successful apply left.
    if (forgotten()) return
    setStatus(memberId, { state: 'error', syncedAt: snapshot.syncedAt })
  }
}
