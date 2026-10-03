import { Readable } from 'node:stream'
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { issueAccessCode } from '../access/index.ts'
import { instanceSettings } from '../admin/tables.ts'
import { purgeDraftsOfMemberInTx } from '../journal/jobs.ts'
import {
  createDraft,
  type JournalActor,
  type JournalDeps,
  touchEntryRevision,
} from '../journal/service.ts'
import { journalEntries } from '../journal/tables.ts'
import { MEDIA_DELETE_JOB, type MediaDeleteJobData } from '../media/index.ts'
import { uploadEntryImage } from '../media/service.ts'
import { pushSubscriptions } from '../notifications/tables.ts'
import { syncTombstones } from '../sync/tables.ts'
import {
  archiveWishlistOfMemberInTx,
  createWish,
  favoriteWish,
  purgeGiftFavoritesOfMemberInTx,
  reserveWish,
  restampWishesOfMemberInTx,
  type WishlistActor,
  type WishlistDeps,
} from '../wishlist/service.ts'
import { giftFavorites, wishes } from '../wishlist/tables.ts'
import { findMemberInSpace } from './index.ts'
import { type MemberPurgeJobsDeps, purgeDuePrivateState } from './jobs.ts'
import { archiveMember, type MemberWishlistPort } from './service.ts'
import { members } from './tables.ts'

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
 * The private-state purge (issue #23): the worker handler runs against the
 * real PostgreSQL the harness provides, over the harness's controllable
 * clock — and it runs twice in the idempotence test, because queue delivery
 * is at-least-once (ADR-0009): the second run must answer without writing.
 */

/** The real ports, wired exactly as the composition roots wire them. */
const wishlistPort: MemberWishlistPort = {
  archiveInTx: archiveWishlistOfMemberInTx,
  restampWishesInTx: restampWishesOfMemberInTx,
  purgeFavoritesInTx: purgeGiftFavoritesOfMemberInTx,
}

function purgeDeps(): MemberPurgeJobsDeps {
  return {
    db: harness.db,
    clock: harness.clock,
    jobs: harness.jobs,
    wishlist: wishlistPort,
    journal: { purgeDraftsInTx: purgeDraftsOfMemberInTx },
  }
}

function wishlistDeps(): WishlistDeps {
  return { db: harness.db, clock: harness.clock }
}

function journalDeps(): JournalDeps {
  return { db: harness.db, clock: harness.clock, jobs: harness.jobs }
}

async function tombstonesFor(spaceId: string, entityId: string) {
  return harness.db
    .select()
    .from(syncTombstones)
    .where(and(eq(syncTombstones.spaceId, spaceId), eq(syncTombstones.entityId, entityId)))
}

function subscriptionRowsForMember(memberId: string) {
  return harness.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.memberId, memberId))
}

interface Arranged {
  spaceId: string
  memberId: string
  wishId: string
  draftId: string
  favoriteId: string
  reservationId: string
}

/**
 * A space whose member has every kind of state: a wish (kept), a draft
 * (purged), a gift favorite of someone else's wish (purged), and a
 * reservation of someone else's wish (released by the archiving itself).
 * The archiving runs through the service, the way the routes run it.
 */
async function arrangeArchivedMember(): Promise<Arranged> {
  const space = await harness.createSpace()
  const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
  const other = await harness.createMember(space.id, { name: 'Люда', role: 'regular' })
  const memberActor: WishlistActor = { memberId: member.id, spaceId: space.id }
  const otherActor: WishlistActor = { memberId: other.id, spaceId: space.id }
  const memberJournalActor: JournalActor = {
    memberId: member.id,
    spaceId: space.id,
    role: 'regular',
  }

  const wish = await createWish(wishlistDeps(), memberActor, { title: 'Велосипед' })
  const draft = await createDraft(journalDeps(), memberJournalActor, {
    title: 'Черновик',
    text: 'Личное',
  })
  await uploadEntryImage(
    {
      db: harness.db,
      storage: harness.storage,
      clock: harness.clock,
      jobs: harness.jobs,
      touchEntry: touchEntryRevision,
    },
    { memberId: member.id, spaceId: space.id, role: 'regular' },
    draft.id,
    { stream: Readable.from(Buffer.from('кадр черновика')), contentType: 'image/jpeg' },
    {
      authorize: async () => undefined,
      authorizeInTx: async () => undefined,
      maxBytes: 26_214_400,
    },
  )

  const othersWish = await createWish(wishlistDeps(), otherActor, { title: 'Книга' })
  const favorite = await favoriteWish(wishlistDeps(), memberActor, othersWish.id)
  const reservation = await reserveWish(wishlistDeps(), otherActor, wish.id)

  await archiveMember({ db: harness.db, clock: harness.clock }, wishlistPort, space.id, member.id)

  // A subscribe request that raced the archiving may have written its row
  // after it: the straggler the purge sweeps with everything else private.
  await harness.db.insert(pushSubscriptions).values({
    spaceId: space.id,
    memberId: member.id,
    endpoint: `https://fcm.googleapis.com/fcm/send/straggler-${member.id}`,
    p256dh: 'p256dh-straggler',
    auth: 'auth-straggler',
    notifyDetails: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return {
    spaceId: space.id,
    memberId: member.id,
    wishId: wish.id,
    draftId: draft.id,
    favoriteId: favorite.id,
    reservationId: reservation.id,
  }
}

describe('the private-state purge (issue #23)', () => {
  test('a member whose retention has not run out is left untouched', async () => {
    const arranged = await arrangeArchivedMember()
    // The archiving just happened; the retention has not run out.
    await purgeDuePrivateState(purgeDeps())

    const drafts = await harness.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, arranged.draftId))
    expect(drafts).toHaveLength(1)
    const rows = await harness.db.select().from(members).where(eq(members.id, arranged.memberId))
    expect(rows[0]?.privateStatePurgedAt).toBeNull()
    // The subscription straggler waits with everything else private. This
    // is a control for the purge test below, not a requirement in itself —
    // closing the subscribe race would remove the straggler entirely.
    expect(await subscriptionRowsForMember(arranged.memberId)).toHaveLength(1)
  })

  test('the purge removes the drafts and favorites, keeps the wishes, and stamps the member', async () => {
    const arranged = await arrangeArchivedMember()
    harness.clock.advance(31 * DAY_MS)

    await purgeDuePrivateState(purgeDeps())

    // The drafts are gone; the wish stays (hidden, but kept).
    const drafts = await harness.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.spaceId, arranged.spaceId),
          eq(journalEntries.authorMemberId, arranged.memberId),
        ),
      )
    expect(drafts).toHaveLength(0)
    const keptWishes = await harness.db.select().from(wishes).where(eq(wishes.id, arranged.wishId))
    expect(keptWishes).toHaveLength(1)

    // The favorites are gone.
    const favorites = await harness.db
      .select()
      .from(giftFavorites)
      .where(eq(giftFavorites.id, arranged.favoriteId))
    expect(favorites).toHaveLength(0)

    // The subscription straggler goes with the purge — the member's end.
    expect(await subscriptionRowsForMember(arranged.memberId)).toEqual([])

    // The member is stamped purged — restoration is no longer offered.
    const rows = await harness.db.select().from(members).where(eq(members.id, arranged.memberId))
    expect(rows[0]?.privateStatePurgedAt).not.toBeNull()

    // The drafts' photos' cleanup rides the transaction as the job.
    const mediaJobs = harness.jobs.submissions.filter(
      (submission) =>
        submission.name === MEDIA_DELETE_JOB &&
        (submission.data as MediaDeleteJobData).spaceId === arranged.spaceId,
    )
    expect(mediaJobs.length).toBeGreaterThan(0)
    const jobData = mediaJobs[0]?.data as MediaDeleteJobData | undefined
    expect(jobData?.imageIds.length).toBeGreaterThan(0)
  })

  test('the purge writes tombstones for the purged drafts and favorites', async () => {
    const arranged = await arrangeArchivedMember()
    harness.clock.advance(31 * DAY_MS)
    await purgeDuePrivateState(purgeDeps())

    const draftTombstones = await tombstonesFor(arranged.spaceId, arranged.draftId)
    expect(draftTombstones).toHaveLength(1)
    expect(draftTombstones[0]).toMatchObject({
      entity: 'journal_entry',
      audience: 'member',
      memberId: arranged.memberId,
    })

    const favoriteTombstones = await tombstonesFor(arranged.spaceId, arranged.favoriteId)
    expect(favoriteTombstones).toHaveLength(1)
    expect(favoriteTombstones[0]).toMatchObject({
      entity: 'wishlist_gift_favorite',
      audience: 'member',
      memberId: arranged.memberId,
    })
  })

  test('a second run answers without writing (at-least-once delivery)', async () => {
    const arranged = await arrangeArchivedMember()
    harness.clock.advance(31 * DAY_MS)
    await purgeDuePrivateState(purgeDeps())
    const submissionsAfterFirst = harness.jobs.submissions.length
    const firstTombstones = await tombstonesFor(arranged.spaceId, arranged.draftId)

    await purgeDuePrivateState(purgeDeps())

    expect(harness.jobs.submissions).toHaveLength(submissionsAfterFirst)
    expect(await tombstonesFor(arranged.spaceId, arranged.draftId)).toHaveLength(
      firstTombstones.length,
    )
  })

  test('after the purge, restoration is no longer offered', async () => {
    const arranged = await arrangeArchivedMember()
    harness.clock.advance(31 * DAY_MS)
    await purgeDuePrivateState(purgeDeps())

    await expect(
      issueAccessCode(
        {
          db: harness.db,
          clock: harness.clock,
          findMemberInSpace: (executor, spaceId, memberId) =>
            findMemberInSpace(executor, spaceId, memberId),
          restoreArchivedMember: async () => undefined,
        },
        arranged.spaceId,
        arranged.memberId,
        { kind: 'administrator', administratorId: crypto.randomUUID() },
      ),
    ).rejects.toMatchObject({ code: 'member_purged' })
  })
})
