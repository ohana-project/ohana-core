import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult, readMemberSnapshot } from '@/data/local-store.ts'
import {
  forgetSync,
  getSyncStatus,
  onMemberRefused,
  onSyncApplied,
  type SyncStatus,
  triggerSync,
} from './sync-engine.ts'

/*
 * The sync engine (issue #14): one request per member with the stored
 * cursor, applied to the per-member store, with the status the indicator
 * shows (ADR-0002: initial, in progress, up to date, offline, server
 * unavailable, error).
 *
 * Every test uses its own member id: the engine holds statuses, in-flight
 * runs, and queued reruns in module-level maps keyed by member, and a
 * leaked run from one test must never be observable in the next.
 */

vi.mock('@/data/api.ts', () => ({ api: { GET: vi.fn() } }))

const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

const apiGet = vi.mocked(api.GET)

let memberCounter = 0

function makeMember(): string {
  return `01900000-0000-7000-8000-${String(++memberCounter).padStart(12, '0')}`
}

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
        id: '01900000-0000-7000-8000-0000000000fe',
        name: 'Аня',
        role: 'owner' as const,
        createdAt: '2026-08-12T10:00:00.000Z',
      },
    },
  ],
  tombstones: [],
}

function seedRegistry(memberId: string) {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([{ memberId, spaceId: SPACE_ID, spaceName: 'Наша семья', name: 'Аня' }]),
  )
  window.localStorage.setItem('ohana.activeMember', memberId)
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  window.localStorage.clear()
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
    const memberId = makeMember()
    await triggerSync(memberId)

    expect(apiGet).toHaveBeenCalledWith('/api/v1/sync', {
      params: { query: { since: '0' }, header: { 'x-ohana-member': memberId } },
    })
    const status: SyncStatus | undefined = getSyncStatus(memberId)
    expect(status?.state).toBe('synced')
    expect(status?.syncedAt).toBe(Date.parse('2026-10-01T09:00:00.000Z'))
    const snapshot = await readMemberSnapshot(memberId)
    expect(snapshot.space?.id).toBe(SPACE_ID)
  })

  test('a refresh with stored data continues from the cursor', async () => {
    const memberId = makeMember()
    await applySyncResult(memberId, ANYA_SYNC)

    await triggerSync(memberId)

    expect(apiGet).toHaveBeenCalledWith('/api/v1/sync', {
      params: { query: { since: '7' }, header: { 'x-ohana-member': memberId } },
    })
  })

  test('a device that is offline asks for nothing and reports offline', async () => {
    const memberId = makeMember()
    vi.stubGlobal('navigator', { onLine: false })

    await triggerSync(memberId)

    expect(apiGet).not.toHaveBeenCalled()
    expect(getSyncStatus(memberId)?.state).toBe('offline')
  })

  test('a request that never reaches the server reports it unreachable', async () => {
    const memberId = makeMember()
    apiGet.mockRejectedValue(new TypeError('Network request failed'))

    await triggerSync(memberId)

    expect(getSyncStatus(memberId)?.state).toBe('unreachable')
  })

  test('an offline failure keeps the cached data readable and reports offline', async () => {
    const memberId = makeMember()
    await applySyncResult(memberId, ANYA_SYNC)
    apiGet.mockRejectedValue(new TypeError('Network request failed'))
    vi.stubGlobal('navigator', { onLine: false })

    await triggerSync(memberId)

    expect(getSyncStatus(memberId)?.state).toBe('offline')
    const snapshot = await readMemberSnapshot(memberId)
    expect(snapshot.space?.id).toBe(SPACE_ID)
  })

  test('an API rejection reports an error and keeps the stored data', async () => {
    const memberId = makeMember()
    await applySyncResult(memberId, ANYA_SYNC)
    apiGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'unexpected', message: 'The request is not valid' } },
      response: new Response(null, { status: 400 }),
    })

    await triggerSync(memberId)

    expect(getSyncStatus(memberId)?.state).toBe('error')
    expect((await readMemberSnapshot(memberId)).revision).toBe('7')
  })

  test('a server unavailable (5xx) reads as unreachable, not an error', async () => {
    const memberId = makeMember()
    await applySyncResult(memberId, ANYA_SYNC)
    apiGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'unexpected', message: 'Bad gateway' } },
      response: new Response(null, { status: 502 }),
    })

    await triggerSync(memberId)

    expect(getSyncStatus(memberId)?.state).toBe('unreachable')
    expect((await readMemberSnapshot(memberId)).revision).toBe('7')
  })

  test('a refused session (401) emits the refusal and forgets the member', async () => {
    const memberId = makeMember()
    seedRegistry(memberId)
    await applySyncResult(memberId, ANYA_SYNC)
    apiGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'unauthorized', message: 'A member session is required' } },
      response: new Response(null, { status: 401 }),
    })
    const refused: string[] = []
    const stop = onMemberRefused((who) => refused.push(who))

    await triggerSync(memberId)
    stop()

    // The engine forgets the run and hands the member to the one cleanup
    // path, which removes them as a sign-out would (ADR-0005); the purge
    // itself is the seam test's business (use-member-session).
    expect(refused).toEqual([memberId])
    expect(getSyncStatus(memberId)).toBeUndefined()
    // Nothing of the refused exchange touched the stored partition.
    expect((await readMemberSnapshot(memberId)).revision).toBe('7')
  })

  test('a storage failure during a forgotten run stays forgotten', async () => {
    const memberId = makeMember()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal('indexedDB', {
      databases: () =>
        gate.then(() => {
          throw new Error('storage refused')
        }),
    })

    const running = triggerSync(memberId)
    // The member signs out while the run is still waiting on storage, and
    // the storage then fails outright: the engine's unexpected-failure
    // guard must not invent a status for the forgotten member.
    forgetSync(memberId)
    release?.()
    await running

    expect(getSyncStatus(memberId)).toBeUndefined()
    expect(apiGet).not.toHaveBeenCalled()
  })

  test('a forgotten run does not clean the member up on its stale 401', async () => {
    const memberId = makeMember()
    seedRegistry(memberId)
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    apiGet.mockImplementationOnce(async () => {
      await gate
      return {
        data: undefined,
        error: { error: { code: 'unauthorized', message: 'A member session is required' } },
        response: new Response(null, { status: 401 }),
      }
    })
    const refused: string[] = []
    const stop = onMemberRefused((who) => refused.push(who))

    const running = triggerSync(memberId)
    // The sign-out lands first and the server answers the hung request
    // with a 401 afterwards: the stale refusal must stay stale.
    forgetSync(memberId)
    release?.()
    await running
    stop()

    expect(refused).toEqual([])
  })

  test('a sync in flight during sign-out never applies its answer', async () => {
    const memberId = makeMember()
    const stale = { ...ANYA_SYNC, revision: '5' }
    await applySyncResult(memberId, stale)
    let releaseRequest: (() => void) | undefined
    const request = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    apiGet.mockImplementationOnce(async () => {
      await request
      return {
        data: ANYA_SYNC,
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    })

    const running = triggerSync(memberId)
    // The member signs out while the request is in the air — properly in
    // flight, not merely queued behind the snapshot read.
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())
    expect(getSyncStatus(memberId)?.state).toBe('updating')
    forgetSync(memberId)
    releaseRequest?.()
    await running

    // The answer of a departed member is never written back, and the run
    // that was forgotten left no status behind.
    expect((await readMemberSnapshot(memberId)).revision).toBe('5')
    expect(getSyncStatus(memberId)).toBeUndefined()
  })

  test('a trigger during a running sync takes its own turn', async () => {
    const memberId = makeMember()
    const release: Array<() => void> = []
    apiGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          release.push(() =>
            resolve({
              data: ANYA_SYNC,
              error: undefined,
              response: new Response(null, { status: 200 }),
            }),
          )
        }),
    )

    const first = triggerSync(memberId)
    void triggerSync(memberId) // asked for while the first is running
    await vi.waitFor(() => expect(release.length).toBeGreaterThan(0))
    release[0]?.()
    await first

    // The second trigger was queued, not dropped, and runs its own request.
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(release.length).toBe(2))
    release[1]?.()
    await vi.waitFor(() => expect(getSyncStatus(memberId)?.state).toBe('synced'))
  })

  test('an interrupted resync restarts from revision 0 on the next run', async () => {
    const memberId = makeMember()
    // The journal is hidden and re-shown: the re-show apply sits on a
    // cursor of 0 with the replay promise open (ADR-0014).
    await applySyncResult(memberId, {
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
    await applySyncResult(memberId, {
      ...ANYA_SYNC,
      revision: '8',
      changes: ANYA_SYNC.changes.filter((change) => change.entity === 'space'),
    })

    apiGet.mockRejectedValueOnce(new TypeError('Network request failed'))
    await triggerSync(memberId)
    expect(getSyncStatus(memberId)?.state).toBe('unreachable')
    expect((await readMemberSnapshot(memberId)).revision).toBe('0')
    expect((await readMemberSnapshot(memberId)).pendingReplay).toEqual(['journal'])

    // The next run asks from the beginning again, and the full data lands:
    // the replay promise clears with the new cursor.
    apiGet.mockResolvedValue({
      data: ANYA_SYNC,
      error: undefined,
      response: new Response(null, { status: 200 }),
    })
    await triggerSync(memberId)
    expect(apiGet).toHaveBeenLastCalledWith('/api/v1/sync', {
      params: { query: { since: '0' }, header: { 'x-ohana-member': memberId } },
    })
    expect((await readMemberSnapshot(memberId)).revision).toBe('7')
    expect((await readMemberSnapshot(memberId)).pendingReplay).toEqual([])
  })

  test('a failing applied listener does not skip the resync', async () => {
    const memberId = makeMember()
    await applySyncResult(memberId, {
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

    const applied: string[] = []
    const stopBroken = onSyncApplied(() => {
      throw new Error('the first listener is broken')
    })
    const stopRecording = onSyncApplied((who) => applied.push(who))

    await triggerSync(memberId)
    stopBroken()
    stopRecording()

    // Both listeners were told about the first apply despite the throwing
    // one, and the resync the apply asked for still ran to 'synced'.
    expect(applied).toEqual([memberId, memberId])
    expect(apiGet.mock.calls.filter((call) => call[0] === '/api/v1/sync')).toHaveLength(2)
    expect(getSyncStatus(memberId)?.state).toBe('synced')
    expect((await readMemberSnapshot(memberId)).revision).toBe('7')
  })

  test('a re-shown section resyncs from revision 0 right away', async () => {
    const memberId = makeMember()
    await applySyncResult(memberId, {
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
    await triggerSync(memberId)

    // The apply reset the cursor to 0 (ADR-0014), and the engine ran the
    // resync immediately: the second call asked from the beginning and the
    // full data landed again.
    const calls = apiGet.mock.calls.map((call) => {
      const options = call[1] as { params: { query: { since: string } } }
      return options.params.query.since
    })
    expect(calls).toEqual(['7', '0'])
    const snapshot = await readMemberSnapshot(memberId)
    expect(snapshot.revision).toBe('7')
    expect(snapshot.pendingReplay).toEqual([])
    expect(snapshot.space?.sections.journal).toBe(true)
  })

  test('notifies an applied listener so screens can re-read their partition', async () => {
    const memberId = makeMember()
    const applied: string[] = []
    const stop = onSyncApplied((who) => applied.push(who))

    await triggerSync(memberId)

    expect(applied).toEqual([memberId])
    stop()
  })
})
