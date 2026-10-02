import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { StoredWish, SyncResult } from './local-store.ts'
import { applySyncResult, deleteMemberData, readMemberSnapshot } from './local-store.ts'

/*
 * The wishlist in the per-member local store (issue #18, ADR-0002): the
 * wishes the sync delivers land in the member's partition and read back
 * offline. Every member's wishes travel to every member, so what the store
 * holds is the space's whole visible wishlist; a removal arrives as a
 * tombstone and takes the row out of every device's copy.
 */

const ANYA = '01900000-0000-7000-8000-000000000001'
const DIMA = '01900000-0000-7000-8000-000000000002'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

function wish(overrides?: Partial<StoredWish>): StoredWish {
  return {
    id: '01900000-0000-7000-8000-000000000301',
    authorId: ANYA,
    title: 'Налобный фонарь',
    details: 'чтобы ходить в горы в темноте',
    link: 'https://www.wildberries.ru/catalog/lamp',
    createdAt: '2026-09-25T12:00:00.000Z',
    updatedAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  }
}

function syncResult(changes: SyncResult['changes'], revision = '7'): SyncResult {
  return {
    revision,
    changes: [
      {
        entity: 'space',
        space: {
          id: SPACE_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal: true, calendar: true, wishlist: true },
        },
      },
      ...changes,
    ],
    tombstones: [],
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  // Only Date is faked: fake-indexeddb schedules its own callbacks on the
  // real event loop, and stubbing the timer functions deadlocks it.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the wishes in the local store', () => {
  test('wishes from a sync response are stored and read back', async () => {
    const mine = wish()
    const theirs = wish({
      id: '01900000-0000-7000-8000-000000000302',
      authorId: DIMA,
      title: 'Термос',
      details: undefined,
      link: undefined,
    })
    await applySyncResult(ANYA, syncResult([{ entity: 'wishlist_wish', wish: mine }], '7'))
    await applySyncResult(ANYA, syncResult([{ entity: 'wishlist_wish', wish: theirs }], '8'))

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.wishes.map((row) => row.id)).toEqual([mine.id, theirs.id])
    expect(snapshot.revision).toBe('8')
  })

  test('a delta replaces the changed wish and a tombstone removes it', async () => {
    const row = wish()
    const other = wish({ id: '01900000-0000-7000-8000-000000000303', title: 'Ремень' })
    await applySyncResult(ANYA, syncResult([{ entity: 'wishlist_wish', wish: row }]))
    await applySyncResult(
      ANYA,
      syncResult([
        { entity: 'wishlist_wish', wish: { ...row, receivedAt: '2026-09-30T10:00:00.000Z' } },
      ]),
    )
    await applySyncResult(ANYA, {
      revision: '9',
      changes: [
        {
          entity: 'wishlist_wish',
          wish: { ...row, receivedAt: undefined, updatedAt: '2026-10-01T08:00:00.000Z' },
        },
      ],
      tombstones: [{ entity: 'wishlist_wish', entityId: other.id, audience: 'all' }],
    })

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.wishes.map((candidate) => candidate.id)).toEqual([row.id])
    expect(snapshot.wishes[0]?.receivedAt).toBeUndefined()
    expect(snapshot.wishes[0]?.updatedAt).toBe('2026-10-01T08:00:00.000Z')
  })

  test('a space change that hides the wishlist drops the wishes in the same apply', async () => {
    const row = wish()
    await applySyncResult(ANYA, syncResult([{ entity: 'wishlist_wish', wish: row }]))
    expect((await readMemberSnapshot(ANYA)).wishes).toHaveLength(1)

    await applySyncResult(ANYA, {
      revision: '9',
      changes: [
        {
          entity: 'space',
          space: {
            id: SPACE_ID,
            name: 'Наша семья',
            timezone: 'Europe/Moscow',
            sections: { journal: true, calendar: true, wishlist: false },
          },
        },
      ],
      tombstones: [],
    })

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.wishes).toEqual([])
    expect(snapshot.revision).toBe('9')
  })

  test('a version 2 partition upgrades in place: the cursor resets for the wishlist', async () => {
    // Seed a version 2 partition the way a device that synced before the
    // wishes store existed holds one — no wishes store at all.
    const openVersionTwo = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`ohana.sync.${ANYA}`, 2)
      request.onupgradeneeded = () => {
        const upgrading = request.result
        upgrading.createObjectStore('space', { keyPath: 'id' })
        upgrading.createObjectStore('members', { keyPath: 'id' })
        upgrading.createObjectStore('entries', { keyPath: 'id' })
        upgrading.createObjectStore('meta', { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Seeding version 2 failed'))
    })
    const seed = async (db: IDBDatabase): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['space', 'meta'], 'readwrite')
        tx.objectStore('space').put({
          id: SPACE_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal: true, calendar: true, wishlist: true },
        })
        tx.objectStore('meta').put({ key: 'cursor', revision: '5' })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('Seeding version 2 failed'))
      })
    const two = await openVersionTwo
    try {
      await seed(two)
    } finally {
      two.close()
    }

    // The next read upgrades in place: the wishes store appears, the
    // cursor resets to 0, and the replay promise names the wishlist
    // (ADR-0014) — the same move a re-shown section makes.
    const upgraded = await readMemberSnapshot(ANYA)
    expect(upgraded.revision).toBe('0')
    expect(upgraded.pendingReplay).toEqual(['wishlist'])
  })

  test('a version 2 partition keeps its journal replay promise beside the wishlist one', async () => {
    const openVersionTwo = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`ohana.sync.${ANYA}`, 2)
      request.onupgradeneeded = () => {
        const upgrading = request.result
        upgrading.createObjectStore('space', { keyPath: 'id' })
        upgrading.createObjectStore('members', { keyPath: 'id' })
        upgrading.createObjectStore('entries', { keyPath: 'id' })
        upgrading.createObjectStore('meta', { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Seeding version 2 failed'))
    })
    const seed = async (db: IDBDatabase): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['meta'], 'readwrite')
        tx.objectStore('meta').put({ key: 'cursor', revision: '5' })
        tx.objectStore('meta').put({ key: 'pendingReplay', sections: ['journal'] })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('Seeding version 2 failed'))
      })
    const two = await openVersionTwo
    try {
      await seed(two)
    } finally {
      two.close()
    }

    const upgraded = await readMemberSnapshot(ANYA)
    expect(upgraded.revision).toBe('0')
    expect(upgraded.pendingReplay).toEqual(['journal', 'wishlist'])
  })

  test('a version 1 partition upgrading straight to version 3 replays both sections', async () => {
    // A device that synced before the journal entries store existed and
    // skipped version 2 entirely: the one upgrade adds both stores, so the
    // replay promise names the journal and the wishlist together.
    const openVersionOne = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`ohana.sync.${ANYA}`, 1)
      request.onupgradeneeded = () => {
        const upgrading = request.result
        upgrading.createObjectStore('space', { keyPath: 'id' })
        upgrading.createObjectStore('members', { keyPath: 'id' })
        upgrading.createObjectStore('meta', { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Seeding version 1 failed'))
    })
    const seed = async (db: IDBDatabase): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['space', 'meta'], 'readwrite')
        tx.objectStore('space').put({
          id: SPACE_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal: true, calendar: true, wishlist: true },
        })
        tx.objectStore('meta').put({ key: 'cursor', revision: '5' })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('Seeding version 1 failed'))
      })
    const one = await openVersionOne
    try {
      await seed(one)
    } finally {
      one.close()
    }

    const upgraded = await readMemberSnapshot(ANYA)
    expect(upgraded.revision).toBe('0')
    expect(upgraded.pendingReplay).toEqual(['journal', 'wishlist'])
  })

  test('each member reads only their own wishes, and sign-out deletes them whole', async () => {
    const row = wish()
    await applySyncResult(ANYA, syncResult([{ entity: 'wishlist_wish', wish: row }]))

    await deleteMemberData(ANYA)

    expect((await readMemberSnapshot(ANYA)).wishes).toEqual([])
  })
})
