import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { DomainError, notFound } from '../../platform/errors.ts'
import { requireVisibleSectionInTx } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import type { WriteWishBody } from './contracts.ts'
import { WISHLIST_WISH_SYNC_ENTITY } from './contracts.ts'
import { assertWishAuthoredBy } from './policy.ts'
import {
  clearWishReceived,
  deleteWish,
  getWishInSpace,
  insertWish,
  listChangedWishesVisibleTo,
  listWishesInSpace,
  markWishReceived,
  updateWish,
} from './repository.ts'
import type { Wish } from './tables.ts'

export interface WishlistDeps {
  db: Db
  clock: Clock
}

/**
 * The member a wishlist use case runs for: the space always comes from the
 * authenticated actor (architecture.md, request lifecycle). The routes pass
 * the access module's MemberActor, which satisfies this structurally — the
 * wishlist has no owner powers over another member's wish, so the role
 * rides along unused.
 */
export interface WishlistActor {
  memberId: string
  spaceId: string
}

/**
 * Adds a wish to the member's own wishlist (issue #76): visible to the
 * whole space from the moment it lands. The use case takes the space row
 * lock through the section recheck, so a hide that commits alongside the
 * write is still honoured, and the revision advances with the row in one
 * transaction.
 */
export async function createWish(
  deps: WishlistDeps,
  actor: WishlistActor,
  input: WriteWishBody,
): Promise<Wish> {
  const now = deps.clock.now()
  let created: Wish | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          created = await insertWish(writeTx, actor.spaceId, {
            authorMemberId: actor.memberId,
            title: normaliseTitle(input.title),
            details: normaliseDetails(input.details),
            link: normaliseLink(input.link),
            revision,
            now,
          })
        },
      },
      now,
    )
  })
  if (created === undefined) throw new Error('Creating a wish produced no row')
  return created
}

/**
 * The author's edit, a replace of the whole triple: an absent details or
 * link means "none", never "keep the old one". The wish is read after the
 * space lock, so the author decision is never made from a half-done
 * change; a wish the actor may not even see answers 404.
 */
export async function editWish(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
  input: WriteWishBody,
): Promise<Wish> {
  const now = deps.clock.now()
  let updated: Wish | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    const wish = await requireWishInSpace(tx, actor.spaceId, wishId)
    assertWishAuthoredBy(wish, actor)
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const row = await updateWish(
            writeTx,
            actor.spaceId,
            wishId,
            {
              title: normaliseTitle(input.title),
              details: normaliseDetails(input.details),
              link: normaliseLink(input.link),
            },
            revision,
            now,
          )
          if (row === undefined) {
            // The defensive backstop: the row was read under the same space
            // row lock, so it cannot vanish before the UPDATE — and a
            // refusal here spends no revision.
            throw notFound('wish_not_found', `Wish ${wishId} does not exist`)
          }
          updated = row
        },
      },
      now,
    )
  })
  if (updated === undefined) throw new Error('Editing a wish produced no row')
  return updated
}

/**
 * The removal (issue #77): the author's wish leaves for good — the
 * wishlist has no trash, so the delete writes the tombstone that carries
 * it out of every device's copy, audience everyone: the wish was visible
 * to the whole space, and every member that saw it must see it go.
 */
export async function removeWish(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    const wish = await requireWishInSpace(tx, actor.spaceId, wishId)
    assertWishAuthoredBy(wish, actor)
    const tombstone: TombstoneInput = {
      entity: WISHLIST_WISH_SYNC_ENTITY,
      entityId: wish.id,
      audience: { kind: 'all' },
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx) => {
          const row = await deleteWish(writeTx, actor.spaceId, wishId)
          if (row === undefined) {
            // The defensive backstop: the row was read under the same space
            // row lock, so it cannot vanish before the DELETE — and a
            // refusal here spends no revision.
            throw notFound('wish_not_found', `Wish ${wishId} does not exist`)
          }
        },
        tombstones: [tombstone],
      },
      now,
    )
  })
}

/**
 * The author marks their wish received (issue #84, CONTEXT.md, received
 * wish): the moment is stamped once, and the stamp rides the revision to
 * every device. The mark is refused before anything is written — the wish
 * was read under the space row lock, so the decision is never made from a
 * half-done change, and a refused mark spends no revision.
 */
export async function markReceived(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<Wish> {
  const now = deps.clock.now()
  let marked: Wish | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    const wish = await requireWishInSpace(tx, actor.spaceId, wishId)
    assertWishAuthoredBy(wish, actor)
    if (wish.receivedAt !== null) {
      throw new DomainError(
        'wish_already_received',
        `Wish ${wishId} is already marked received`,
        409,
      )
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const row = await markWishReceived(writeTx, actor.spaceId, wishId, now, revision, now)
          if (row === undefined) {
            // The defensive backstop: unreachable under the space row lock,
            // and revision-free even then.
            throw new DomainError(
              'wish_already_received',
              `Wish ${wishId} is already marked received`,
              409,
            )
          }
          marked = row
        },
      },
      now,
    )
  })
  if (marked === undefined) throw new Error('Marking a wish received produced no row')
  return marked
}

/**
 * The way back to open, from the edit sheet's switch (issue #18): the
 * author clears the mark, and the clearing rides the revision like the
 * mark did.
 */
export async function clearReceived(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<Wish> {
  const now = deps.clock.now()
  let cleared: Wish | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    const wish = await requireWishInSpace(tx, actor.spaceId, wishId)
    assertWishAuthoredBy(wish, actor)
    if (wish.receivedAt === null) {
      throw new DomainError('wish_not_received', `Wish ${wishId} is not marked received`, 409)
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const row = await clearWishReceived(writeTx, actor.spaceId, wishId, revision, now)
          if (row === undefined) {
            // The defensive backstop: unreachable under the space row lock,
            // and revision-free even then.
            throw new DomainError('wish_not_received', `Wish ${wishId} is not marked received`, 409)
          }
          cleared = row
        },
      },
      now,
    )
  })
  if (cleared === undefined) throw new Error("Clearing a wish's received mark produced no row")
  return cleared
}

/**
 * One wish, the way the requesting member may see it: every wish of the
 * space is visible to every member (policy.ts), so the only refusal is a
 * wish that is not in this space at all — 404, its existence in another
 * space unrevealed (architecture.md, "Errors").
 */
export async function getWish(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<Wish> {
  return requireWishInSpace(deps.db, actor.spaceId, wishId)
}

/**
 * The space's browse (issue #78): every member's wishes, creation order —
 * or one member's wishlist when the query names them. The rows go back
 * raw; the route maps them onto the wire shape.
 */
export async function listWishes(
  deps: WishlistDeps,
  actor: WishlistActor,
  authorMemberId: string | undefined,
): Promise<Wish[]> {
  return listWishesInSpace(deps.db, actor.spaceId, authorMemberId)
}

/** The sync contributor's delta: the wishes changed since the cursor. */
export async function listChangedWishes(
  tx: Parameters<typeof listChangedWishesVisibleTo>[0],
  spaceId: string,
  since: bigint,
): Promise<Wish[]> {
  return listChangedWishesVisibleTo(tx, spaceId, since)
}

async function requireWishInSpace(
  executor: Parameters<typeof getWishInSpace>[0],
  spaceId: string,
  wishId: string,
): Promise<Wish> {
  const wish = await getWishInSpace(executor, spaceId, wishId)
  if (wish === undefined) {
    throw notFound('wish_not_found', `Wish ${wishId} does not exist`)
  }
  return wish
}

/** The schema already validates the raw fields; this applies to what is stored. */
function normaliseTitle(title: string): string {
  return title.trim()
}

function normaliseDetails(details: string | undefined): string | null {
  const trimmed = details?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function normaliseLink(link: string | undefined): string | null {
  const trimmed = link?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}
