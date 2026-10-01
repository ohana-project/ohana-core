import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SyncResult } from './local-store.ts'
import { applySyncResult, deleteMemberData, readMemberSnapshot } from './local-store.ts'

/*
 * The per-member local store (issue #14, ADR-0002): one IndexedDB database
 * per retained member, so a sign-out deletes the member's whole cache with
 * one call and nothing of one space can surface under another.
 */

const ANYA = '01900000-0000-7000-8000-000000000001'
const DIMA = '01900000-0000-7000-8000-000000000002'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'
const MISHA_ID = '01900000-0000-7000-8000-000000000003'

function syncResult(overrides?: Partial<SyncResult>): SyncResult {
  return {
    revision: '7',
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
      {
        entity: 'member',
        member: {
          id: ANYA,
          name: 'Аня',
          displayName: 'Аня Смирнова',
          role: 'owner',
          createdAt: '2026-08-12T10:00:00.000Z',
        },
      },
      {
        entity: 'member',
        member: {
          id: MISHA_ID,
          name: 'Миша',
          role: 'regular',
          createdAt: '2026-08-14T10:00:00.000Z',
        },
      },
    ],
    tombstones: [],
    ...overrides,
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

describe('the per-member local store', () => {
  test('a device with nothing downloaded reads an empty snapshot', async () => {
    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot).toEqual({
      space: undefined,
      members: [],
      entries: [],
      revision: undefined,
      syncedAt: undefined,
    })
  })

  test('applying a sync response stores the space, the profiles, and the cursor', async () => {
    await applySyncResult(ANYA, syncResult())

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.space).toMatchObject({ id: SPACE_ID, name: 'Наша семья' })
    expect(snapshot.members.map((member) => member.name)).toEqual(['Аня', 'Миша'])
    expect(snapshot.revision).toBe('7')
    expect(snapshot.syncedAt).toBe(Date.parse('2026-10-01T09:00:00.000Z'))
  })

  test('a delta applies changed rows and removes tombstoned ones', async () => {
    await applySyncResult(ANYA, syncResult())

    await applySyncResult(ANYA, {
      revision: '8',
      changes: [
        {
          entity: 'member',
          member: {
            id: MISHA_ID,
            name: 'Миша',
            displayName: 'Миша Петров',
            role: 'regular',
            createdAt: '2026-08-14T10:00:00.000Z',
          },
        },
      ],
      tombstones: [],
    })
    await applySyncResult(ANYA, {
      revision: '9',
      changes: [],
      tombstones: [{ entity: 'member', entityId: MISHA_ID, audience: 'all' }],
    })

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.members.map((member) => member.displayName)).toEqual(['Аня Смирнова'])
    expect(snapshot.revision).toBe('9')
  })

  test('an upsert outranks a tombstone of the same row in one response', async () => {
    // A resync from revision 0 replays the space's whole tombstone history
    // next to the current rows; the stored row must be the current one.
    await applySyncResult(ANYA, {
      revision: '8',
      changes: [
        {
          entity: 'member',
          member: {
            id: MISHA_ID,
            name: 'Миша',
            role: 'regular',
            createdAt: '2026-08-14T10:00:00.000Z',
          },
        },
      ],
      tombstones: [{ entity: 'member', entityId: MISHA_ID, audience: 'all' }],
    })

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.members.map((member) => member.id)).toEqual([MISHA_ID])
  })

  test('a section shown again resets the cursor to 0 inside the same apply', async () => {
    await applySyncResult(ANYA, syncResult())

    await applySyncResult(ANYA, {
      revision: '8',
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
    expect((await readMemberSnapshot(ANYA)).revision).toBe('8')

    // The owner shows the journal again: the delta cannot carry the rows
    // older than the cursor, so the next sync starts from revision 0 —
    // stored atomically with the new map (ADR-0014).
    await applySyncResult(ANYA, {
      revision: '9',
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
      ],
      tombstones: [],
    })
    expect((await readMemberSnapshot(ANYA)).revision).toBe('0')

    // The resync from 0 lands with the whole data again and moves the
    // cursor forward.
    await applySyncResult(ANYA, syncResult({ revision: '9' }))
    expect((await readMemberSnapshot(ANYA)).revision).toBe('9')
  })

  test('a plain space change moves the cursor to the response revision', async () => {
    await applySyncResult(ANYA, syncResult())
    await applySyncResult(ANYA, {
      revision: '10',
      changes: [
        {
          entity: 'space',
          space: {
            id: SPACE_ID,
            name: 'Наш уголок',
            timezone: 'Europe/Moscow',
            sections: { journal: true, calendar: true, wishlist: true },
          },
        },
      ],
      tombstones: [],
    })
    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.revision).toBe('10')
    expect(snapshot.space?.name).toBe('Наш уголок')
  })

  test('each member reads only their own partition, and sign-out deletes it whole', async () => {
    await applySyncResult(ANYA, syncResult())
    await applySyncResult(DIMA, syncResult())

    await deleteMemberData(ANYA)

    expect(await readMemberSnapshot(ANYA)).toEqual({
      space: undefined,
      members: [],
      entries: [],
      revision: undefined,
      syncedAt: undefined,
    })
    const dima = await readMemberSnapshot(DIMA)
    expect(dima.space?.id).toBe(SPACE_ID)
    expect(dima.members).toHaveLength(2)
  })
})
