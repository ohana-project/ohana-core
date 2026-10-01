import type { paths } from '@ohana/api-client'

/*
 * The per-member local store (issue #14, architecture.md, web rules):
 * synchronised data lives in IndexedDB, one database per retained member.
 * A sign-out deletes the member's database whole, and nothing of one
 * member's space can surface under another's. The store is read and
 * written through whole-database transactions, so an applied response and
 * its cursor always commit together.
 */

/** The sync endpoint's response, taken from the generated contract (ADR-0013). */
export type SyncResult =
  paths['/api/v1/sync']['get']['responses'][200]['content']['application/json']

export interface StoredSpace {
  id: string
  name: string
  timezone: string
  sections: { journal: boolean; calendar: boolean; wishlist: boolean }
}

export interface StoredMemberProfile {
  id: string
  name: string
  displayName?: string
  email?: string
  phone?: string
  interfaceLanguage?: 'ru' | 'en'
  role: 'owner' | 'regular'
  createdAt: string
}

export interface MemberSnapshot {
  space: StoredSpace | undefined
  members: StoredMemberProfile[]
  /** The last revision the device has applied; undefined until the first sync lands. */
  revision: string | undefined
  /** When the last sync succeeded, in epoch milliseconds. */
  syncedAt: number | undefined
}

const DB_PREFIX = 'ohana.sync.'

function memberDbName(memberId: string): string {
  // The id is a UUID, so it is safe inside a database name.
  return `${DB_PREFIX}${memberId}`
}

function openMemberDb(memberId: string, create = true): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(memberDbName(memberId), 1)
    request.onupgradeneeded = () => {
      if (!create) {
        // The read path never creates: the database vanished between the
        // listing and this open (a concurrent sign-out), so the honest
        // answer is "nothing stored", not a fresh empty database.
        request.transaction?.abort()
        return
      }
      const db = request.result
      if (!db.objectStoreNames.contains('space')) db.createObjectStore('space', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('members')) {
        db.createObjectStore('members', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Opening the local store failed'))
  })
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The local store request failed'))
  })
}

/** Reads the member's whole partition; a device without data reads an empty snapshot. */
export async function readMemberSnapshot(memberId: string): Promise<MemberSnapshot> {
  if (typeof indexedDB === 'undefined' || !indexedDB.databases) {
    // Every browser this supports implements both; the guard keeps the
    // empty answer honest where storage does not exist at all.
    return { space: undefined, members: [], revision: undefined, syncedAt: undefined }
  }
  const names = await indexedDB.databases()
  if (!names.some((database) => database.name === memberDbName(memberId))) {
    return { space: undefined, members: [], revision: undefined, syncedAt: undefined }
  }
  const db = await openMemberDb(memberId, false).catch((error: unknown) => {
    // A database that vanished mid-read reads as nothing stored. The name
    // check is structural: AbortError is a DOMException, which is not an
    // Error instance in every implementation.
    if ((error as { name?: string } | undefined)?.name === 'AbortError') {
      return undefined
    }
    throw error
  })
  if (db === undefined) {
    return { space: undefined, members: [], revision: undefined, syncedAt: undefined }
  }
  try {
    const tx = db.transaction(['space', 'members', 'meta'], 'readonly')
    const [spaces, members, meta] = await Promise.all([
      requestAsPromise(tx.objectStore('space').getAll()),
      requestAsPromise(tx.objectStore('members').getAll()),
      requestAsPromise(tx.objectStore('meta').getAll()),
    ])
    const cursor = meta.find((row) => row.key === 'cursor')?.revision as string | undefined
    const syncedAt = meta.find((row) => row.key === 'syncedAt')?.at as number | undefined
    return {
      space: (spaces[0] as StoredSpace | undefined) ?? undefined,
      members: members as StoredMemberProfile[],
      revision: cursor,
      syncedAt,
    }
  } finally {
    db.close()
  }
}

type MetaRow = { key: 'cursor'; revision: string } | { key: 'syncedAt'; at: number }

/**
 * Applies a sync response in one transaction: the tombstoned rows go, the
 * upserts land over them, and the cursor is written with both — so an
 * interrupted apply leaves the previous revision and is simply retried,
 * and a row delivered with both an upsert and a tombstone in one response
 * ends up stored.
 *
 * When the new sections map shows a section that was hidden before, the
 * cursor is written as 0 instead of the response's revision (ADR-0014):
 * a delta cannot carry rows older than the cursor, so the next sync
 * fetches the section's full data. The same rule will make the client
 * drop a hidden section's rows when the section stores arrive — the map
 * is applied here, in the same transaction.
 */
export async function applySyncResult(memberId: string, result: SyncResult): Promise<string> {
  const db = await openMemberDb(memberId)
  try {
    // The stored cursor is only resolved once the transaction has committed.
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction(['space', 'members', 'meta'], 'readwrite')
      const spaceStore = tx.objectStore('space')
      const memberStore = tx.objectStore('members')
      const metaStore = tx.objectStore('meta')
      let storedRevision = result.revision

      // The previous map is read before anything is written, so the
      // hidden-to-visible decision sees the state the device had.
      const previousRequest = spaceStore.getAll()
      previousRequest.onsuccess = () => {
        const previous = previousRequest.result[0] as StoredSpace | undefined

        // Tombstones go first: within one response, an upsert of a row is
        // the newer fact (the contributor's rows are what exists now), so
        // it must outrank a tombstone of the same row — a resync from
        // revision 0 replays the space's whole tombstone history.
        for (const tombstone of result.tombstones) {
          if (tombstone.entity === 'member') memberStore.delete(tombstone.entityId)
        }
        for (const change of result.changes) {
          if (change.entity === 'space') spaceStore.put(change.space)
          if (change.entity === 'member') memberStore.put(change.member)
        }

        let revision = result.revision
        const nextSpace = result.changes.find((change) => change.entity === 'space')
        if (previous !== undefined && nextSpace !== undefined) {
          const reshow = (
            Object.keys(previous.sections) as Array<keyof StoredSpace['sections']>
          ).some((section) => !previous.sections[section] && nextSpace.space.sections[section])
          if (reshow) revision = '0'
        }
        storedRevision = revision
        const cursor: MetaRow = { key: 'cursor', revision }
        const stamped: MetaRow = { key: 'syncedAt', at: Date.now() }
        metaStore.put(cursor)
        metaStore.put(stamped)
      }
      previousRequest.onerror = () => reject(previousRequest.error ?? new Error('The read failed'))
      tx.oncomplete = () => resolve(storedRevision)
      tx.onerror = () => reject(tx.error ?? new Error('Applying the sync result failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Applying the sync result was aborted'))
    })
  } finally {
    db.close()
  }
}

/** Removes the member's whole partition — the sign-out cleanup (ADR-0005). */
export function deleteMemberData(memberId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(memberDbName(memberId))
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Deleting the local store failed'))
    request.onblocked = () => resolve()
  })
}
