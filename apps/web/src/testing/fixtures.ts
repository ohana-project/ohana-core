import type { StoredMemberProfile } from '@/data/local-store.ts'
import type { ApiHealthReport } from '@/features/health/use-api-health.ts'

export const okHealthReport = {
  status: 'ok',
  checks: { database: 'up', storage: 'up' },
} satisfies ApiHealthReport

export const degradedHealthReport = {
  status: 'degraded',
  checks: { database: 'up', storage: 'down' },
} satisfies ApiHealthReport

/**
 * Seeds a version 1 partition the way a device that synced before the
 * journal entries store existed holds one: the space row, the profiles it
 * names, a cursor — and no entries store. The store's next read upgrades
 * it in place: the entries store appears, the cursor resets to 0, and the
 * replay promise names the journal (ADR-0014).
 */
export async function seedVersionOnePartition(
  memberId: string,
  space: { id: string; name: string; timezone?: string },
  members: StoredMemberProfile[] = [],
  options: { cursor?: string | null } = {},
): Promise<void> {
  const openVersionOne = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`ohana.sync.${memberId}`, 1)
    request.onupgradeneeded = () => {
      const upgrading = request.result
      upgrading.createObjectStore('space', { keyPath: 'id' })
      upgrading.createObjectStore('members', { keyPath: 'id' })
      upgrading.createObjectStore('meta', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Seeding version 1 failed'))
  })
  const writeRows = async (db: IDBDatabase): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['space', 'members', 'meta'], 'readwrite')
      tx.objectStore('space').put({
        id: space.id,
        name: space.name,
        timezone: space.timezone ?? 'Europe/Moscow',
        sections: { journal: true, calendar: true, wishlist: true },
      })
      for (const member of members) tx.objectStore('members').put(member)
      // A partition whose first apply never committed holds no cursor at
      // all — the honest empty answer after the upgrade.
      if (options.cursor !== null) {
        tx.objectStore('meta').put({ key: 'cursor', revision: options.cursor ?? '5' })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Seeding version 1 failed'))
    })
  const db = await openVersionOne
  try {
    await writeRows(db)
  } finally {
    db.close()
  }
}

/**
 * Seeds a version 4 partition the way a device that synced before the
 * calendar's events store existed holds one (issues #19 and #20): every
 * store but `events`, and a cursor that advanced past calendar_event
 * revisions the old client ignored. The store's next read upgrades it in
 * place: the events store appears, the cursor resets to 0, and the replay
 * promise names the calendar (ADR-0014).
 */
export async function seedVersionFourPartition(
  memberId: string,
  space: { id: string; name: string; timezone?: string },
  members: StoredMemberProfile[] = [],
  options: { cursor?: string | null } = {},
): Promise<void> {
  const openVersionFour = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`ohana.sync.${memberId}`, 4)
    request.onupgradeneeded = () => {
      const upgrading = request.result
      upgrading.createObjectStore('space', { keyPath: 'id' })
      upgrading.createObjectStore('members', { keyPath: 'id' })
      upgrading.createObjectStore('entries', { keyPath: 'id' })
      upgrading.createObjectStore('wishes', { keyPath: 'id' })
      upgrading.createObjectStore('giftFavorites', { keyPath: 'id' })
      upgrading.createObjectStore('giftReservations', { keyPath: 'id' })
      upgrading.createObjectStore('meta', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Seeding version 4 failed'))
  })
  const writeRows = async (db: IDBDatabase): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['space', 'members', 'meta'], 'readwrite')
      tx.objectStore('space').put({
        id: space.id,
        name: space.name,
        timezone: space.timezone ?? 'Europe/Moscow',
        sections: { journal: true, calendar: true, wishlist: true },
      })
      for (const member of members) tx.objectStore('members').put(member)
      if (options.cursor !== null) {
        tx.objectStore('meta').put({ key: 'cursor', revision: options.cursor ?? '9' })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Seeding version 4 failed'))
    })
  const db = await openVersionFour
  try {
    await writeRows(db)
  } finally {
    db.close()
  }
}
