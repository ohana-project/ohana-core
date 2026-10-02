import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { DomainError, notFound } from '../../platform/errors.ts'
import { listMemberIdsInTx } from '../members/index.ts'
import { requireVisibleSectionInTx } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import type { WriteWishBody } from './contracts.ts'
import {
  WISHLIST_GIFT_FAVORITE_SYNC_ENTITY,
  WISHLIST_GIFT_RESERVATION_SYNC_ENTITY,
  WISHLIST_WISH_SYNC_ENTITY,
} from './contracts.ts'
import {
  assertWishAuthoredBy,
  assertWishNotAuthoredBy,
  reservationVisibleTo,
  wishVisibleTo,
} from './policy.ts'
import {
  clearWishReceived,
  deleteGiftFavorite,
  deleteGiftFavoritesOfWish,
  deleteGiftReservation,
  deleteWish,
  getGiftFavoriteInSpace,
  getGiftReservationInSpace,
  getWishInSpace,
  insertGiftFavorite,
  insertGiftReservation,
  insertWish,
  listChangedGiftFavoritesVisibleTo,
  listChangedGiftReservationsVisibleTo,
  listChangedWishesVisibleTo,
  listGiftFavoritesOfMember,
  listGiftFavoritesOfWish,
  listGiftReservationsVisibleTo,
  listWishesInSpace,
  markWishReceived,
  updateWish,
} from './repository.ts'
import type { GiftFavorite, GiftReservation, Wish } from './tables.ts'

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
 * Adds a wish to the member's own wishlist (issue #18): visible to the
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
    const wish = await requireWishInSpace(tx, actor, wishId)
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
 * The removal (issue #18): the author's wish leaves for good — the
 * wishlist has no trash, so the delete writes the tombstone that carries
 * it out of every device's copy, audience everyone: the wish was visible
 * to the whole space, and every member that saw it must see it go. The
 * removal also ends everything held against the wish (issue #19): its
 * reservation — tombstoned per member, every member but the author, who
 * must never learn a reservation existed — and every member's gift
 * favorite of it, tombstoned to the member who made each.
 */
export async function removeWish(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    const wish = await requireWishInSpace(tx, actor, wishId)
    assertWishAuthoredBy(wish, actor)
    // Read under the space row lock: what the removal takes with it.
    const reservation = await getGiftReservationInSpace(tx, actor.spaceId, wishId)
    const favorites = await listGiftFavoritesOfWish(tx, actor.spaceId, wishId)
    const tombstones: TombstoneInput[] = [
      { entity: WISHLIST_WISH_SYNC_ENTITY, entityId: wish.id, audience: { kind: 'all' } },
      ...(reservation
        ? await tombstonesForReservationEnding(
            tx,
            actor.spaceId,
            reservation.id,
            wish.authorMemberId,
          )
        : []),
      ...favorites.map(
        (favorite): TombstoneInput => ({
          entity: WISHLIST_GIFT_FAVORITE_SYNC_ENTITY,
          entityId: favorite.id,
          audience: { kind: 'member', memberId: favorite.memberId },
        }),
      ),
    ]
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx) => {
          if (reservation !== undefined) {
            await deleteGiftReservation(writeTx, actor.spaceId, reservation.id)
          }
          await deleteGiftFavoritesOfWish(writeTx, actor.spaceId, wishId)
          const row = await deleteWish(writeTx, actor.spaceId, wishId)
          if (row === undefined) {
            // The defensive backstop: the row was read under the same space
            // row lock, so it cannot vanish before the DELETE — and a
            // refusal here spends no revision.
            throw notFound('wish_not_found', `Wish ${wishId} does not exist`)
          }
        },
        tombstones,
      },
      now,
    )
  })
}

/**
 * The author marks their wish received (issue #18, CONTEXT.md, received
 * wish): the moment is stamped once, and the stamp rides the revision to
 * every device. The mark is refused before anything is written — the wish
 * was read under the space row lock, so the decision is never made from a
 * half-done change, and a refused mark spends no revision. A wish's
 * receiving also ends its reservation (issue #19): the row goes, and every
 * member but the author — who must never learn a reservation existed —
 * receives the member-scoped tombstone of its ending.
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
    const wish = await requireWishInSpace(tx, actor, wishId)
    assertWishAuthoredBy(wish, actor)
    if (wish.receivedAt !== null) {
      throw new DomainError(
        'wish_already_received',
        `Wish ${wishId} is already marked received`,
        409,
      )
    }
    // Read under the space row lock requireVisibleSectionInTx took: the
    // reservation this mark ends, if one is held at all.
    const reservation = await getGiftReservationInSpace(tx, actor.spaceId, wishId)
    const tombstones: TombstoneInput[] = reservation
      ? await tombstonesForReservationEnding(tx, actor.spaceId, reservation.id, wish.authorMemberId)
      : []
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          if (reservation !== undefined) {
            await deleteGiftReservation(writeTx, actor.spaceId, reservation.id)
          }
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
        tombstones,
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
    const wish = await requireWishInSpace(tx, actor, wishId)
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
  return requireWishInSpace(deps.db, actor, wishId)
}

/**
 * The space's browse (issue #18): every member's wishes, creation order —
 * or one member's wishlist when the query names them. The rows go back
 * raw; the route maps them onto the wire shape.
 */
export async function listWishes(
  deps: WishlistDeps,
  actor: WishlistActor,
  authorMemberId: string | undefined,
): Promise<Wish[]> {
  return listWishesInSpace(deps.db, actor.spaceId, actor.memberId, authorMemberId)
}

/** The sync contributor's delta: the wishes changed since the cursor. */
export async function listChangedWishes(
  tx: Parameters<typeof listChangedWishesVisibleTo>[0],
  actor: { memberId: string; spaceId: string },
  since: bigint,
): Promise<Wish[]> {
  return listChangedWishesVisibleTo(tx, actor.spaceId, actor.memberId, since)
}

/**
 * The member's private bookmark of someone else's wish (issue #19,
 * CONTEXT.md, gift favorite): only they will ever see it, and it reserves
 * nothing. The use case takes the space row lock through the section
 * recheck; the wish is read after the lock, so a wish that is not in this
 * space answers 404 and the member's own wish refuses — both before
 * anything is written.
 */
export async function favoriteWish(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<GiftFavorite> {
  const now = deps.clock.now()
  let created: GiftFavorite | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    const wish = await requireWishInSpace(tx, actor, wishId)
    assertWishNotAuthoredBy(wish, actor, 'favorite_own_wish')
    const existing = await getGiftFavoriteInSpace(tx, actor.spaceId, actor.memberId, wishId)
    if (existing !== undefined) {
      throw new DomainError(
        'wish_already_favorited',
        `Wish ${wishId} is already favorited by this member`,
        409,
      )
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          created = await insertGiftFavorite(writeTx, actor.spaceId, {
            memberId: actor.memberId,
            wishId,
            revision,
            now,
          })
        },
      },
      now,
    )
  })
  if (created === undefined) throw new Error('Favoriting a wish produced no row')
  return created
}

/**
 * Taking the bookmark back (issue #19): the row goes, and the
 * member-scoped tombstone carries it out of that member's devices — the
 * only devices it was ever on. No favorite to remove is a 409, the
 * toggling client's stale view being the only way to get there.
 */
export async function unfavoriteWish(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    await requireWishInSpace(tx, actor, wishId)
    const favorite = await getGiftFavoriteInSpace(tx, actor.spaceId, actor.memberId, wishId)
    if (favorite === undefined) {
      throw new DomainError('wish_not_favorited', `Wish ${wishId} is not favorited`, 409)
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx) => {
          await deleteGiftFavorite(writeTx, actor.spaceId, favorite.id)
        },
        tombstones: [
          {
            entity: WISHLIST_GIFT_FAVORITE_SYNC_ENTITY,
            entityId: favorite.id,
            audience: { kind: 'member', memberId: actor.memberId },
          },
        ],
      },
      now,
    )
  })
}

/**
 * The member's own favorites, creation order — the one listing that
 * exists: the routes and the sync contributor deliver a member nobody's
 * favorites but their own (issue #19).
 */
export async function listGiftFavorites(
  deps: WishlistDeps,
  actor: WishlistActor,
): Promise<GiftFavorite[]> {
  return listGiftFavoritesOfMember(deps.db, actor.spaceId, actor.memberId)
}

/**
 * The member reserves a wish they intend to give (issue #19, CONTEXT.md,
 * gift reservation): visible to every member except the wish's author from
 * the moment it lands, so that relatives do not buy the same gift. A wish
 * has at most one active reservation — the row exists exactly while it is
 * held — and the wish's own state guards the rest: the author's wish
 * refuses, a received wish refuses, a wish already held refuses.
 */
export async function reserveWish(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<GiftReservation> {
  const now = deps.clock.now()
  let created: GiftReservation | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    const wish = await requireWishInSpace(tx, actor, wishId)
    assertWishNotAuthoredBy(wish, actor, 'reserve_own_wish')
    if (wish.receivedAt !== null) {
      throw new DomainError(
        'wish_already_received',
        `Wish ${wishId} is already marked received`,
        409,
      )
    }
    const existing = await getGiftReservationInSpace(tx, actor.spaceId, wishId)
    if (existing !== undefined) {
      throw new DomainError(
        'wish_already_reserved',
        `Wish ${wishId} already has an active reservation`,
        409,
      )
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          created = await insertGiftReservation(writeTx, actor.spaceId, {
            memberId: actor.memberId,
            wishId,
            revision,
            now,
          })
        },
      },
      now,
    )
  })
  if (created === undefined) throw new Error('Reserving a wish produced no row')
  return created
}

/**
 * Only the reserving member cancels the reservation (issue #19), and the
 * wish's author learns nothing on the way: their own wish's cancel answers
 * exactly what an unreserved wish answers — the same 409 `wish_not_reserved`,
 * whatever the truth is — so probing the route reveals no reservation.
 * Another member's reaching for the cancel is a plain 403: they could see
 * the reservation anyway, so confirming it tells them nothing new.
 */
export async function cancelReservation(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'wishlist')
    const wish = await requireWishInSpace(tx, actor, wishId)
    if (!reservationVisibleTo({ wishAuthorMemberId: wish.authorMemberId }, actor.memberId)) {
      // The author's probe answers what an unreserved wish answers: the
      // same refusal whether or not a reservation is held.
      throw new DomainError('wish_not_reserved', `Wish ${wishId} is not reserved`, 409)
    }
    const reservation = await getGiftReservationInSpace(tx, actor.spaceId, wishId)
    if (reservation === undefined) {
      throw new DomainError('wish_not_reserved', `Wish ${wishId} is not reserved`, 409)
    }
    if (reservation.memberId !== actor.memberId) {
      throw new DomainError(
        'reservation_holder_required',
        'Only the member who reserved a wish can cancel the reservation',
        403,
      )
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx) => {
          await deleteGiftReservation(writeTx, actor.spaceId, reservation.id)
        },
        tombstones: await tombstonesForReservationEnding(
          tx,
          actor.spaceId,
          reservation.id,
          wish.authorMemberId,
        ),
      },
      now,
    )
  })
}

/**
 * One wish's reservation, the way the requesting member may see it: the
 * author's own wishes answer 404 `reservation_not_found` — the same answer
 * an unreserved wish gives anyone, so the author probing the read learns
 * nothing — and an unreserved wish answers the same 404 (architecture.md,
 * "Errors": resources the actor cannot see return 404).
 */
export async function getWishReservation(
  deps: WishlistDeps,
  actor: WishlistActor,
  wishId: string,
): Promise<GiftReservation> {
  const wish = await requireWishInSpace(deps.db, actor, wishId)
  if (!reservationVisibleTo({ wishAuthorMemberId: wish.authorMemberId }, actor.memberId)) {
    // The author's probe answers what an unreserved wish answers, whether
    // or not a reservation is held.
    throw notFound('reservation_not_found', `Wish ${wishId} has no active reservation`)
  }
  const reservation = await getGiftReservationInSpace(deps.db, actor.spaceId, wishId)
  if (reservation === undefined) {
    throw notFound('reservation_not_found', `Wish ${wishId} has no active reservation`)
  }
  return reservation
}

/** The reservations the requesting member may see, creation order (issue #19). */
export async function listGiftReservations(
  deps: WishlistDeps,
  actor: WishlistActor,
): Promise<Array<{ reservation: GiftReservation; wishAuthorMemberId: string }>> {
  return listGiftReservationsVisibleTo(deps.db, actor.spaceId, actor.memberId)
}

/** The sync contributor's delta: the favorites changed since the cursor. */
export async function listChangedGiftFavorites(
  tx: Parameters<typeof listChangedGiftFavoritesVisibleTo>[0],
  actor: { memberId: string; spaceId: string },
  since: bigint,
): Promise<GiftFavorite[]> {
  return listChangedGiftFavoritesVisibleTo(tx, actor.spaceId, actor.memberId, since)
}

/** The sync contributor's delta: the reservations changed since the cursor. */
export async function listChangedGiftReservations(
  tx: Parameters<typeof listChangedGiftReservationsVisibleTo>[0],
  actor: { memberId: string; spaceId: string },
  since: bigint,
): Promise<Array<{ reservation: GiftReservation; wishAuthorMemberId: string }>> {
  return listChangedGiftReservationsVisibleTo(tx, actor.spaceId, actor.memberId, since)
}

/**
 * The tombstones of a reservation's ending (issue #19): one per member of
 * the space except the wish's author, read under the same space row lock
 * the ending runs behind. No `all` tombstone can carry a reservation — it
 * would land on the author's devices too, and the author must never learn
 * a reservation existed, not even that one ended.
 */
async function tombstonesForReservationEnding(
  tx: Parameters<typeof listMemberIdsInTx>[0],
  spaceId: string,
  reservationId: string,
  authorMemberId: string,
): Promise<TombstoneInput[]> {
  const memberIds = await listMemberIdsInTx(tx, spaceId)
  return memberIds
    .filter((memberId) => memberId !== authorMemberId)
    .map(
      (memberId): TombstoneInput => ({
        entity: WISHLIST_GIFT_RESERVATION_SYNC_ENTITY,
        entityId: reservationId,
        audience: { kind: 'member', memberId },
      }),
    )
}

async function requireWishInSpace(
  executor: Parameters<typeof getWishInSpace>[0],
  actor: WishlistActor,
  wishId: string,
): Promise<Wish> {
  const wish = await getWishInSpace(executor, actor.spaceId, wishId)
  if (wish === undefined || !wishVisibleTo(wish, actor.memberId)) {
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

/**
 * Unlike the details, the link needs no trim here: its contract pattern
 * (`^https?://` and not a whitespace in sight) already refuses padded,
 * empty, and whitespace-only values, so a link that arrives is stored as
 * sent — only its absence becomes null.
 */
function normaliseLink(link: string | undefined): string | null {
  return link ?? null
}
