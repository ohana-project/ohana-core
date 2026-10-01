import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import {
  createTestHarness,
  type RecordingJobSender,
  type TestHarness,
} from '../../testing/harness.ts'
import { updateSettings } from '../admin/index.ts'
import { instanceSettings } from '../admin/tables.ts'
import { getSpace } from '../spaces/index.ts'
import { syncTombstones } from '../sync/tables.ts'
import { purgeDueTrashedEntries, purgeTrashedEntry } from './jobs.ts'
import { getEntryInSpace } from './repository.ts'
import type { JournalActor, JournalDeps } from './service.ts'
import { createDraft, publishDraft, restoreTrashedEntry, trashEntry } from './service.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

// The installation settings are a singleton other test files may have
// changed (the files share one database); the tests below assume the
// 30-day default until one of them grows it on purpose.
await harness.db.delete(instanceSettings)

const DAY_MS = 24 * 60 * 60 * 1000

/*
 * The worker handlers (issue #16): every handler runs against the real
 * PostgreSQL the harness provides, over the harness's controllable clock —
 * and every handler runs twice, because queue delivery is at-least-once
 * (ADR-0009): the second run must answer without writing, not fail.
 *
 * Each entry in these tests carries two tombstones once it is purged: the
 * one its trash wrote (the removal the devices apply first) and the one
 * its purge wrote (the telling that it is gone for good). The tests count
 * both.
 */

function jobDeps() {
  return { db: harness.db, clock: harness.clock }
}

function serviceDeps(jobs: RecordingJobSender): JournalDeps {
  return { db: harness.db, clock: harness.clock, jobs }
}

async function trashedDraft(author: JournalActor): Promise<string> {
  const deps = serviceDeps(harness.jobs)
  const created = await createDraft(deps, author, { text: 'черновик под нож' })
  const { entry } = await trashEntry(deps, author, created.id)
  return entry.id
}

async function trashedPublished(author: JournalActor): Promise<string> {
  const deps = serviceDeps(harness.jobs)
  const created = await createDraft(deps, author, { text: 'публикация под нож' })
  await publishDraft(deps, author, created.id)
  const { entry } = await trashEntry(deps, author, created.id)
  return entry.id
}

/** The entry's tombstones, oldest revision first: the trash's, then the purge's. */
async function tombstonesFor(spaceId: string, entryId: string) {
  const rows = await harness.db
    .select()
    .from(syncTombstones)
    .where(and(eq(syncTombstones.spaceId, spaceId), eq(syncTombstones.entityId, entryId)))
  return rows.sort((a, b) => (a.revision < b.revision ? -1 : 1))
}

describe('purgeTrashedEntry (the per-entry job)', () => {
  test('purges a due trashed entry once; the second run writes nothing', async () => {
    const space = await harness.createSpace({ name: 'Один запуск' })
    const author = await harness.createMember(space.id, { name: 'Аня' })
    const actor: JournalActor = { memberId: author.id, spaceId: space.id, role: 'regular' }
    const draftId = await trashedDraft(actor)
    const publishedId = await trashedPublished(actor)

    const revisionBefore = (await getSpace({ db: harness.db, clock: harness.clock }, space.id))
      .revision

    // The retention runs out: the clock moves past the default 30 days.
    harness.clock.advance(31 * DAY_MS)
    await purgeTrashedEntry(jobDeps(), { spaceId: space.id, entryId: draftId })
    await purgeTrashedEntry(jobDeps(), { spaceId: space.id, entryId: publishedId })

    // Both rows are gone for good.
    expect(await getEntryInSpace(harness.db, space.id, draftId)).toBeUndefined()
    expect(await getEntryInSpace(harness.db, space.id, publishedId)).toBeUndefined()

    // Each purge told its audience: everyone for the ex-published entry,
    // the author alone for the draft. Trash's tombstone comes first, the
    // purge's second, on later revisions.
    const draftRows = await tombstonesFor(space.id, draftId)
    expect(draftRows).toHaveLength(2)
    expect(draftRows[1]).toMatchObject({ audience: 'member', memberId: author.id })
    const publishedRows = await tombstonesFor(space.id, publishedId)
    expect(publishedRows).toHaveLength(2)
    expect(publishedRows[1]).toMatchObject({ audience: 'all', memberId: null })

    // The purges spent revisions: the tombstones ride the space's clock.
    const revisionAfter = (await getSpace({ db: harness.db, clock: harness.clock }, space.id))
      .revision
    expect(revisionAfter > revisionBefore).toBe(true)

    // The repeat: at-least-once delivery runs every handler twice — the
    // rows are already gone, so the second pass answers without writing
    // (no error, no new tombstone, no new revision).
    await purgeTrashedEntry(jobDeps(), { spaceId: space.id, entryId: draftId })
    expect(await tombstonesFor(space.id, draftId)).toHaveLength(2)
    expect((await getSpace({ db: harness.db, clock: harness.clock }, space.id)).revision).toBe(
      revisionAfter,
    )
  })

  test('an entry that is not due yet — the retention grew — is left alone', async () => {
    const space = await harness.createSpace({ name: 'Рано' })
    const author = await harness.createMember(space.id, { name: 'Аня' })
    const actor: JournalActor = { memberId: author.id, spaceId: space.id, role: 'regular' }
    const entryId = await trashedDraft(actor)

    // The retention grows to 90 days; the job scheduled at 30 fires early.
    await updateSettings({ db: harness.db, clock: harness.clock }, { trashRetentionDays: 90 })
    harness.clock.advance(31 * DAY_MS)
    await purgeTrashedEntry(jobDeps(), { spaceId: space.id, entryId })

    // Not due: the row stays, and the only tombstone is the trash's.
    expect((await getEntryInSpace(harness.db, space.id, entryId))?.state).toBe('trashed')
    expect(await tombstonesFor(space.id, entryId)).toHaveLength(1)

    // The sweep re-checks with the retention of the moment: 60 days later
    // the entry goes.
    harness.clock.advance(60 * DAY_MS)
    await purgeDueTrashedEntries(jobDeps())
    expect(await getEntryInSpace(harness.db, space.id, entryId)).toBeUndefined()
    expect(await tombstonesFor(space.id, entryId)).toHaveLength(2)

    // The file's later tests assume the default again: the setting is an
    // installation-wide singleton, and the grow was this test's doing.
    await updateSettings({ db: harness.db, clock: harness.clock }, { trashRetentionDays: 30 })
  })

  test('a restored entry is never purged, however late the job arrives', async () => {
    const space = await harness.createSpace({ name: 'Вернули' })
    const author = await harness.createMember(space.id, { name: 'Аня' })
    const actor: JournalActor = { memberId: author.id, spaceId: space.id, role: 'regular' }
    const deps = serviceDeps(harness.jobs)
    const created = await createDraft(deps, actor, { text: 'передумали' })
    await trashEntry(deps, actor, created.id)
    await restoreTrashedEntry(deps, actor, created.id)

    harness.clock.advance(90 * DAY_MS)
    await purgeTrashedEntry(jobDeps(), { spaceId: space.id, entryId: created.id })
    await purgeDueTrashedEntries(jobDeps())

    // The entry lives on as a draft; the only tombstone is the trash's.
    expect((await getEntryInSpace(harness.db, space.id, created.id))?.state).toBe('draft')
    expect(await tombstonesFor(space.id, created.id)).toHaveLength(1)
  })
})

describe('purgeDueTrashedEntries (the recurring sweep)', () => {
  test('purges every due entry of every space once; the second pass finds nothing', async () => {
    const first = await harness.createSpace({ name: 'Первое пространство' })
    const second = await harness.createSpace({ name: 'Второе пространство' })
    const anyaFirst = await harness.createMember(first.id, { name: 'Аня' })
    const dimaFirst = await harness.createMember(first.id, { name: 'Дима' })
    const anyaSecond = await harness.createMember(second.id, { name: 'Аня' })

    const firstPublished = await trashedPublished({
      memberId: anyaFirst.id,
      spaceId: first.id,
      role: 'regular',
    })
    const firstDraft = await trashedDraft({
      memberId: dimaFirst.id,
      spaceId: first.id,
      role: 'regular',
    })
    const secondDraft = await trashedDraft({
      memberId: anyaSecond.id,
      spaceId: second.id,
      role: 'regular',
    })

    harness.clock.advance(31 * DAY_MS)
    await purgeDueTrashedEntries(jobDeps())

    for (const [spaceId, entryId] of [
      [first.id, firstPublished],
      [first.id, firstDraft],
      [second.id, secondDraft],
    ] as const) {
      expect(await getEntryInSpace(harness.db, spaceId, entryId), entryId).toBeUndefined()
      const rows = await tombstonesFor(spaceId, entryId)
      expect(rows, entryId).toHaveLength(2)
    }

    // The repeat run: the sweep is safe to repeat, and nothing is left to do.
    const tombstonesBefore = await harness.db.select().from(syncTombstones)
    await purgeDueTrashedEntries(jobDeps())
    expect(await harness.db.select().from(syncTombstones)).toEqual(tombstonesBefore)
  })

  test('an entry whose retention has not run out stays', async () => {
    const space = await harness.createSpace({ name: 'Ещё рано' })
    const author = await harness.createMember(space.id, { name: 'Аня' })
    const entryId = await trashedDraft({
      memberId: author.id,
      spaceId: space.id,
      role: 'regular',
    })

    harness.clock.advance(29 * DAY_MS)
    await purgeDueTrashedEntries(jobDeps())

    expect((await getEntryInSpace(harness.db, space.id, entryId))?.state).toBe('trashed')
    expect(await tombstonesFor(space.id, entryId)).toHaveLength(1)

    harness.clock.advance(2 * DAY_MS)
    await purgeDueTrashedEntries(jobDeps())
    expect(await getEntryInSpace(harness.db, space.id, entryId)).toBeUndefined()
    expect(await tombstonesFor(space.id, entryId)).toHaveLength(2)
  })
})
