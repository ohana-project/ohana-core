import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult, readMemberSnapshot } from '@/data/local-store.ts'
import { getSyncStatus, onSyncApplied, type SyncStatus, triggerSync } from './sync-engine.ts'

/*
 * The sync engine (issue #14): one request per member with the stored
 * cursor, applied to the per-member store, with the status the indicator
 * shows (ADR-0002: initial, in progress, up to date, offline, server
 * unavailable, error).
 */

vi.mock('@/data/api.ts', () => ({ api: { GET: vi.fn() } }))

const ANYA = '01900000-0000-7000-8000-000000000001'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

const apiGet = vi.mocked(api.GET)

const ANYA_SYNC = {
  revision: '7',
  changes: [
    {
      entity: 'space' as const,
      space: {
        id: SPACE_ID,
        name: 'Наша семья',
        timezone: 'Europe/Moscow',
        sections: { journal: true, calendar: true, wishlist: true },
      },
    },
    {
      entity: 'member' as const,
      member: {
        id: ANYA,
        name: 'Аня',
        role: 'owner' as const,
        createdAt: '2026-08-12T10:00:00.000Z',
      },
    },
  ],
  tombstones: [],
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'))
  vi.stubGlobal('navigator', { onLine: true })
  apiGet.mockReset()
  apiGet.mockResolvedValue({
    data: ANYA_SYNC,
    error: undefined,
    response: new Response(null, { status: 200 }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the sync engine', () => {
  test('the first sync runs from revision 0 and lands as synced', async () => {
    await triggerSync(ANYA)

    expect(apiGet).toHaveBeenCalledWith('/api/v1/sync', {
      params: { query: { since: '0' }, header: { 'x-ohana-member': ANYA } },
    })
    const status: SyncStatus | undefined = getSyncStatus(ANYA)
    expect(status?.state).toBe('synced')
    expect(status?.syncedAt).toBe(Date.parse('2026-10-01T09:00:00.000Z'))
    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.space?.id).toBe(SPACE_ID)
  })

  test('a refresh with stored data continues from the cursor', async () => {
    await applySyncResult(ANYA, ANYA_SYNC)

    await triggerSync(ANYA)

    expect(apiGet).toHaveBeenCalledWith('/api/v1/sync', {
      params: { query: { since: '7' }, header: { 'x-ohana-member': ANYA } },
    })
  })

  test('a device that is offline asks for nothing and reports offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    await triggerSync(ANYA)

    expect(apiGet).not.toHaveBeenCalled()
    expect(getSyncStatus(ANYA)?.state).toBe('offline')
  })

  test('a request that never reaches the server reports it unreachable', async () => {
    apiGet.mockRejectedValue(new TypeError('Network request failed'))

    await triggerSync(ANYA)

    expect(getSyncStatus(ANYA)?.state).toBe('unreachable')
  })

  test('an offline failure keeps the cached data readable and reports offline', async () => {
    await applySyncResult(ANYA, ANYA_SYNC)
    apiGet.mockRejectedValue(new TypeError('Network request failed'))
    vi.stubGlobal('navigator', { onLine: false })

    await triggerSync(ANYA)

    expect(getSyncStatus(ANYA)?.state).toBe('offline')
    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.space?.id).toBe(SPACE_ID)
  })

  test('an API rejection reports an error and keeps the stored data', async () => {
    await applySyncResult(ANYA, ANYA_SYNC)
    apiGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'unauthorized', message: 'A member session is required' } },
      response: new Response(null, { status: 401 }),
    })

    await triggerSync(ANYA)

    expect(getSyncStatus(ANYA)?.state).toBe('error')
    expect((await readMemberSnapshot(ANYA)).revision).toBe('7')
  })

  test('a re-shown section resyncs from revision 0 right away', async () => {
    await applySyncResult(ANYA, {
      ...ANYA_SYNC,
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
    })

    apiGet.mockResolvedValue({
      data: ANYA_SYNC,
      error: undefined,
      response: new Response(null, { status: 200 }),
    })
    await triggerSync(ANYA)

    // The apply reset the cursor to 0 (ADR-0014), and the engine ran the
    // resync immediately: the second call asked from the beginning and the
    // full data landed again.
    const calls = apiGet.mock.calls.map((call) => {
      const options = call[1] as { params: { query: { since: string } } }
      return options.params.query.since
    })
    expect(calls).toEqual(['7', '0'])
    const snapshot = await readMemberSnapshot(ANYA)
    expect(snapshot.revision).toBe('7')
    expect(snapshot.space?.sections.journal).toBe(true)
  })

  test('notifies an applied listener so screens can re-read their partition', async () => {
    const applied: string[] = []
    const stop = onSyncApplied((memberId) => applied.push(memberId))

    await triggerSync(ANYA)

    expect(applied).toEqual([ANYA])
    stop()
  })
})
