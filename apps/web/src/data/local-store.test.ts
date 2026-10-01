import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { seedVersionOnePartition } from '../testing/fixtures.ts'
import type { StoredJournalEntry, SyncResult } from './local-store.ts'
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

function syncResult(
  overrides?: Partial<SyncResult>,
  extraChanges: SyncResult['changes'] = [],
): SyncResult {
  const base: SyncResult = {
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
  }
  return {
    ...base,
    changes: [...base.changes, ...extraChanges],
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
      pendingReplay: [],
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

  test('a journal re-show writes the replay promise, and the replay clears it', async () => {
    const row = entry()
    await applySyncResult(ANYA, syncResult(undefined, [{ entity: 'journal_entry', entry: row }]))

    // The owner hides the journal: the rows go, the cursor moves on.
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
    const hidden = await readMemberSnapshot(ANYA)
    expect(hidden.entries).toEqual([])
    expect(hidden.revision).toBe('8')
    expect(hidden.pendingReplay).toEqual([])

    // The re-show writes the promise: until the replay lands, the device
    // may hold only a fraction of the journal, and the screens say so.
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
    const promised = await readMemberSnapshot(ANYA)
    expect(promised.revision).toBe('0')
    expect(promised.pendingReplay).toEqual(['journal'])

    // The replay lands whole: the promise is cleared with the new cursor.
    await applySyncResult(ANYA, {
      revision: '10',
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
      tombstones: [],
    })
    const replayed = await readMemberSnapshot(ANYA)
    expect(replayed.revision).toBe('10')
    expect(replayed.pendingReplay).toEqual([])
    expect(replayed.entries).toHaveLength(1)
  })

  test('a stale response for a cursor the store moved past writes nothing', async () => {
    const row = entry()
    const spaceAt = (journal: boolean): SyncResult['changes'] => [
      {
        entity: 'space',
        space: {
          id: SPACE_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal, calendar: true, wishlist: true },
        },
      },
    ]

    // The journal hides at revision 7; two tabs then ask from that cursor.
    // Tab A's re-show response lands; tab B's is the same request, but by
    // the time its answer arrives the store has moved on — nothing of it
    // may land, and the promise stays as the first apply wrote it.
    await applySyncResult(ANYA, { revision: '7', changes: spaceAt(false), tombstones: [] })
    const reshow: SyncResult = {
      revision: '9',
      changes: [...spaceAt(true), { entity: 'journal_entry', entry: row }],
      tombstones: [],
    }
    const first = await applySyncResult(ANYA, reshow, '7')
    const before = await readMemberSnapshot(ANYA)
    // The clock moves on: a stale apply that rewrote syncedAt would show.
    vi.setSystemTime(new Date('2026-10-01T09:05:00.000Z'))
    // Tab B's answer carries a row and a revision of its own — the stale
    // apply must not deliver them.
    const staleTab: SyncResult = {
      revision: '11',
      changes: [
        ...spaceAt(true),
        {
          entity: 'journal_entry',
          entry: { ...row, id: '01900000-0000-7000-8000-000000000102', text: 'позже' },
        },
      ],
      tombstones: [],
    }
    const second = await applySyncResult(ANYA, staleTab, '7')

    expect(first).toEqual({ cursor: '0', applied: true })
    expect(second).toEqual({ cursor: '0', applied: false })
    const after = await readMemberSnapshot(ANYA)
    expect(after.revision).toBe('0')
    expect(after.pendingReplay).toEqual(['journal'])
    expect(after.entries.map((entry) => entry.id)).toEqual(before.entries.map((entry) => entry.id))
    expect(after.syncedAt).toBe(before.syncedAt)
  })

  test('a re-show writes its own promise, and the replay answers for the space whole', async () => {
    // The journal and the calendar hide; the calendar then re-shows and
    // leaves the store on a cursor of 0 with the journal still hidden and
    // its replay owed.
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
    await applySyncResult(ANYA, {
      revision: '9',
      changes: [
        {
          entity: 'space',
          space: {
            id: SPACE_ID,
            name: 'Наша семья',
            timezone: 'Europe/Moscow',
            sections: { journal: false, calendar: false, wishlist: true },
          },
        },
      ],
      tombstones: [],
    })
    const calendarReshow = await applySyncResult(
      ANYA,
      {
        revision: '10',
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
      },
      '9',
    )
    expect(calendarReshow).toEqual({ cursor: '0', applied: true })
    expect((await readMemberSnapshot(ANYA)).pendingReplay).toEqual(['calendar'])

    // The replay answers a request from revision 0 — and re-shows the
    // journal inside itself, carrying it whole: the cursor moves to the
    // response's revision, no promise stays open, and the row it carried
    // lands.
    const row = entry()
    const replay = await applySyncResult(
      ANYA,
      {
        revision: '10',
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
        tombstones: [],
      },
      '0',
    )
    expect(replay).toEqual({ cursor: '10', applied: true })
    const replayed = await readMemberSnapshot(ANYA)
    expect(replayed.pendingReplay).toEqual([])
    expect(replayed.revision).toBe('10')
    expect(replayed.entries.map((entry) => entry.id)).toEqual([row.id])
  })

  test('a version 1 partition upgrades in place: data reads, the cursor resets for the journal', async () => {
    // A device that synced before the journal existed holds a version 1
    // database: space, members, meta, no entries store — and a cursor that
    // advanced past journal_entry revisions the old client ignored.
    await seedVersionOnePartition(ANYA, { id: SPACE_ID, name: 'Наша семья' }, [
      {
        id: MISHA_ID,
        name: 'Миша',
        role: 'regular',
        createdAt: '2026-08-14T10:00:00.000Z',
      },
    ])

    // The read upgrades the partition instead of answering empty: the
    // space and members still read offline (ADR-0002), the entries store
    // appears empty, and the cursor has been reset so the next sync
    // replays the journal from revision 0.
    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.space?.id).toBe(SPACE_ID)
    expect(snapshot.members.map((member) => member.name)).toEqual(['Миша'])
    expect(snapshot.entries).toEqual([])
    expect(snapshot.revision).toBe('0')
    expect(snapshot.pendingReplay).toEqual(['journal'])

    // The replay lands the journal entries and moves the cursor forward.
    await applySyncResult(ANYA, {
      revision: '7',
      changes: [
        ...syncResult().changes,
        {
          entity: 'journal_entry',
          entry: {
            id: '01900000-0000-7000-8000-000000000101',
            authorId: MISHA_ID,
            title: 'Поход',
            text: 'Вид стоит каждого шага.',
            state: 'published',
            publishedAt: '2026-09-21T14:00:00.000Z',
            createdAt: '2026-09-21T12:00:00.000Z',
            updatedAt: '2026-09-21T14:00:00.000Z',
          },
        },
      ],
      tombstones: [],
    })
    const upgraded = await readMemberSnapshot(ANYA)
    expect(upgraded.entries).toHaveLength(1)
    expect(upgraded.revision).toBe('7')
  })

  test('a version 1 partition without a cursor stays honestly empty after the upgrade', async () => {
    // A device whose first apply never committed holds the stores but no
    // cursor; the upgrade must not write one, or the screens would claim
    // empty sections for data the device does not hold.
    await seedVersionOnePartition(ANYA, { id: SPACE_ID, name: 'Наша семья' }, [], {
      cursor: null,
    })

    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.revision).toBeUndefined()
    expect(snapshot.entries).toEqual([])
    expect(snapshot.members).toEqual([])
    expect(snapshot.pendingReplay).toEqual([])
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
      pendingReplay: [],
    })
    const dima = await readMemberSnapshot(DIMA)
    expect(dima.space?.id).toBe(SPACE_ID)
    expect(dima.members).toHaveLength(2)
  })
})
