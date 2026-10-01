import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { StoredJournalEntry, SyncResult } from './local-store.ts'
import { applySyncResult, deleteMemberData, readMemberSnapshot } from './local-store.ts'

/*
 * The journal in the per-member local store (issue #15, ADR-0002): the
 * entries the sync delivers land in the member's partition and read back
 * offline. A draft the server sent only to its author is stored the same
 * way; what the store holds is exactly what the server delivered, nothing
 * client-side re-filters.
 */

const ANYA = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

function entry(overrides?: Partial<StoredJournalEntry>): StoredJournalEntry {
  return {
    id: '01900000-0000-7000-8000-000000000101',
    authorId: ANYA,
    title: 'Осенний пикник',
    text: 'Собрались за час: бутерброды, термос, плед и Бублик.',
    state: 'published',
    publishedAt: '2026-09-21T14:00:00.000Z',
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
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

describe('the journal entries in the local store', () => {
  test('entries from a sync response are stored and read back', async () => {
    const draft = entry({
      id: '01900000-0000-7000-8000-000000000102',
      title: undefined,
      text: 'Черновик',
      state: 'draft',
      publishedAt: undefined,
    })
    await applySyncResult(
      ANYA,
      syncResult([
        { entity: 'journal_entry', entry: entry() },
        {
          entity: 'journal_entry',
          entry: draft,
        },
      ]),
    )

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.entries.map((row) => row.id)).toEqual([entry().id, draft.id])
    expect(snapshot.revision).toBe('7')
  })

  test('a delta replaces the changed entry and a tombstone removes it', async () => {
    const first = entry()
    const second = entry({
      id: '01900000-0000-7000-8000-000000000103',
      text: 'Вторая запись',
      publishedAt: '2026-09-22T14:00:00.000Z',
    })
    await applySyncResult(ANYA, syncResult([{ entity: 'journal_entry', entry: first }]))
    await applySyncResult(ANYA, syncResult([{ entity: 'journal_entry', entry: second }], '8'))
    await applySyncResult(ANYA, {
      revision: '9',
      changes: [
        {
          entity: 'journal_entry',
          entry: { ...first, text: 'Исправленный текст', updatedAt: '2026-09-23T09:00:00.000Z' },
        },
      ],
      tombstones: [{ entity: 'journal_entry', entityId: second.id, audience: 'all' }],
    })

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.entries.map((row) => row.id)).toEqual([first.id])
    expect(snapshot.entries[0]?.text).toBe('Исправленный текст')
  })

  test('an upsert outranks a tombstone of the same entry in one response', async () => {
    const row = entry()
    await applySyncResult(ANYA, {
      revision: '8',
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
        { entity: 'journal_entry', entry: row },
      ],
      tombstones: [{ entity: 'journal_entry', entityId: row.id, audience: 'all' }],
    })

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.entries.map((row) => row.id)).toEqual([row.id])
  })

  test('a space change that hides the journal drops the entries in the same apply', async () => {
    const row = entry()
    await applySyncResult(ANYA, syncResult([{ entity: 'journal_entry', entry: row }]))
    expect((await readMemberSnapshot(ANYA)).entries).toHaveLength(1)

    await applySyncResult(ANYA, {
      revision: '9',
      changes: [
        {
          entity: 'space',
          space: {
            id: SPACE_ID,
            name: 'Наша семья',
            timezone: 'Europe/Moscow',
            sections: { journal: false, calendar: true, wishlist: true },
          },
        },
      ],
      tombstones: [],
    })

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.entries).toEqual([])
    expect(snapshot.revision).toBe('9')
  })

  test('each member reads only their own entries, and sign-out deletes them whole', async () => {
    const row = entry()
    await applySyncResult(ANYA, syncResult([{ entity: 'journal_entry', entry: row }]))

    await deleteMemberData(ANYA)

    expect((await readMemberSnapshot(ANYA)).entries).toEqual([])
  })
})
