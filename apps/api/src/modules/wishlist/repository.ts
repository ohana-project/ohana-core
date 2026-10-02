import { and, asc, desc, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { favoriteVisibleToSql, reservationVisibleToSql, wishVisibleToSql } from './policy.ts'
import {
  type GiftFavorite,
  type GiftReservation,
  giftFavorites,
  giftReservations,
  type Wish,
  wishes,
} from './tables.ts'

export interface NewWish {
  authorMemberId: string
  title: string
  details: string | null
  link: string | null
  revision: bigint
  now: Date
}

/**
 * Every query on this space-owned table takes the space as its required
 * first argument (architecture, "Space scoping"): there is no unscoped
 * wishlist access on the normal path.
 */
export async function insertWish(tx: Tx, spaceId: string, data: NewWish): Promise<Wish> {
  const inserted = await tx
    .insert(wishes)
    .values({
      spaceId,
      authorMemberId: data.authorMemberId,
      title: data.title,
      details: data.details,
      link: data.link,
      receivedAt: null,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a wish returned no row')
  return row
}

export async function getWishInSpace(
  executor: Executor,
  spaceId: string,
  wishId: string,
): Promise<Wish | undefined> {
  const rows = await executor
    .select()
    .from(wishes)
    .where(and(eq(wishes.spaceId, spaceId), eq(wishes.id, wishId)))
    .limit(1)
  return rows[0]
}

/**
 * The author's replace of the whole title-details-link triple, stamped with
 * the transaction's revision. No row means the wish is not in this space —
 * the use case decides what that answers.
 */
export async function updateWish(
  tx: Tx,
  spaceId: string,
  wishId: string,
  changes: { title: string; details: string | null; link: string | null },
  revision: bigint,
  now: Date,
): Promise<Wish | undefined> {
  const updated = await tx
    .update(wishes)
    .set({
      title: changes.title,
      details: changes.details,
      link: changes.link,
      revision,
      updatedAt: now,
    })
    .where(and(eq(wishes.spaceId, spaceId), eq(wishes.id, wishId)))
    .returning()
  return updated[0]
}

/**
 * The mark into received (issue #18, CONTEXT.md, received wish): the
 * moment is stamped once, and a wish already received returns no row — the
 * use case refuses, mirroring the journal's publish guard. The mark is
 * not one-way: the author can return the wish to open from the edit
 * sheet's switch (clearWishReceived below), a decision recorded in
 * CONTEXT.md.
 */
export async function markWishReceived(
  tx: Tx,
  spaceId: string,
  wishId: string,
  receivedAt: Date,
  revision: bigint,
  now: Date,
): Promise<Wish | undefined> {
  const updated = await tx
    .update(wishes)
    .set({ receivedAt, revision, updatedAt: now })
    .where(and(eq(wishes.spaceId, spaceId), eq(wishes.id, wishId), isNull(wishes.receivedAt)))
    .returning()
  return updated[0]
}

/**
 * The way back to open: the author clears the mark from the edit sheet's
 * switch. A wish that is not received returns no row and the use case
 * refuses.
 */
export async function clearWishReceived(
  tx: Tx,
  spaceId: string,
  wishId: string,
  revision: bigint,
  now: Date,
): Promise<Wish | undefined> {
  const updated = await tx
    .update(wishes)
    .set({ receivedAt: null, revision, updatedAt: now })
    .where(and(eq(wishes.spaceId, spaceId), eq(wishes.id, wishId), isNotNull(wishes.receivedAt)))
    .returning()
  return updated[0]
}

/**
 * The removal (issue #18): a wish leaves for good — no trash holds it, the
 * tombstone beside the delete carries it out of every device's copy. The
 * row comes back so the caller knows what it removed; undefined means the
 * wish is not in this space.
 */
export async function deleteWish(
  tx: Tx,
  spaceId: string,
  wishId: string,
): Promise<Wish | undefined> {
  const deleted = await tx
    .delete(wishes)
    .where(and(eq(wishes.spaceId, spaceId), eq(wishes.id, wishId)))
    .returning()
  return deleted[0]
}

/**
 * One wishlist's rows, or the whole space's browse: creation order is the
 * wishlist's order, oldest first, with the id breaking creation-in-one-
 * moment ties. The visibility filter is the ordinary read's rule
 * (policy.ts, in its SQL dialect) beside the space scope and the optional
 * author narrowing.
 */
export async function listWishesInSpace(
  executor: Executor,
  spaceId: string,
  memberId: string,
  authorMemberId: string | undefined,
): Promise<Wish[]> {
  return executor
    .select()
    .from(wishes)
    .where(
      and(
        eq(wishes.spaceId, spaceId),
        authorMemberId === undefined ? undefined : eq(wishes.authorMemberId, authorMemberId),
        wishVisibleToSql(memberId),
      ),
    )
    .orderBy(asc(wishes.createdAt), asc(wishes.id))
}

/**
 * The rows changed after `since` that the requesting member may see — the
 * sync contributor's delta (issue #14). The visibility filter is the
 * ordinary read's rule (policy.ts); today it narrows nothing beyond the
 * space scope, every wish of the space travelling to every member.
 */
export async function listChangedWishesVisibleTo(
  tx: Tx,
  spaceId: string,
  memberId: string,
  since: bigint,
): Promise<Wish[]> {
  return tx
    .select()
    .from(wishes)
    .where(and(eq(wishes.spaceId, spaceId), gt(wishes.revision, since), wishVisibleToSql(memberId)))
    .orderBy(desc(wishes.revision), desc(wishes.id))
}

/*
 * The gift favorites (issue #19): a member's private bookmarks. Every
 * query narrows to the requesting member — the module's one visibility
 * rule for favorites (policy.ts, in its SQL dialect) beside the space
 * scope — so another member's favorites cannot leave the server through
 * any read, the sync contributor's included.
 */

export interface NewGiftFavorite {
  memberId: string
  wishId: string
  revision: bigint
  now: Date
}

export async function insertGiftFavorite(
  tx: Tx,
  spaceId: string,
  data: NewGiftFavorite,
): Promise<GiftFavorite> {
  const inserted = await tx
    .insert(giftFavorites)
    .values({
      spaceId,
      memberId: data.memberId,
      wishId: data.wishId,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a gift favorite returned no row')
  return row
}

/** The member's own bookmark of the wish, or undefined when it is not favorited. */
export async function getGiftFavoriteInSpace(
  executor: Executor,
  spaceId: string,
  memberId: string,
  wishId: string,
): Promise<GiftFavorite | undefined> {
  const rows = await executor
    .select()
    .from(giftFavorites)
    .where(
      and(
        eq(giftFavorites.spaceId, spaceId),
        eq(giftFavorites.memberId, memberId),
        eq(giftFavorites.wishId, wishId),
      ),
    )
    .limit(1)
  return rows[0]
}

export async function deleteGiftFavorite(
  tx: Tx,
  spaceId: string,
  favoriteId: string,
): Promise<GiftFavorite | undefined> {
  const deleted = await tx
    .delete(giftFavorites)
    .where(and(eq(giftFavorites.spaceId, spaceId), eq(giftFavorites.id, favoriteId)))
    .returning()
  return deleted[0]
}

/**
 * One member's favorites, creation order — the whole listing that exists:
 * the routes and the sync contributor deliver a member nobody's favorites
 * but their own.
 */
export async function listGiftFavoritesOfMember(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<GiftFavorite[]> {
  return executor
    .select()
    .from(giftFavorites)
    .where(and(eq(giftFavorites.spaceId, spaceId), favoriteVisibleToSql(memberId)))
    .orderBy(asc(giftFavorites.createdAt), asc(giftFavorites.id))
}

/** The favorites changed after `since` that the requesting member may see. */
export async function listChangedGiftFavoritesVisibleTo(
  tx: Tx,
  spaceId: string,
  memberId: string,
  since: bigint,
): Promise<GiftFavorite[]> {
  return tx
    .select()
    .from(giftFavorites)
    .where(
      and(
        eq(giftFavorites.spaceId, spaceId),
        gt(giftFavorites.revision, since),
        favoriteVisibleToSql(memberId),
      ),
    )
    .orderBy(desc(giftFavorites.revision), desc(giftFavorites.id))
}

/** The wish's favorites, whoever made them — the wish's removal ends each one. */
export async function listGiftFavoritesOfWish(
  tx: Tx,
  spaceId: string,
  wishId: string,
): Promise<GiftFavorite[]> {
  return tx
    .select()
    .from(giftFavorites)
    .where(and(eq(giftFavorites.spaceId, spaceId), eq(giftFavorites.wishId, wishId)))
}

export async function deleteGiftFavoritesOfWish(
  tx: Tx,
  spaceId: string,
  wishId: string,
): Promise<void> {
  await tx
    .delete(giftFavorites)
    .where(and(eq(giftFavorites.spaceId, spaceId), eq(giftFavorites.wishId, wishId)))
}

/*
 * The gift reservations (issue #19): a wish has at most one active
 * reservation — the row exists exactly while it is held — visible to every
 * member except the wish's author. Every read joins the wish, because the
 * visibility rule is about the wish's author (policy.ts, in its SQL
 * dialect); the space scope is applied before that rule.
 */

export interface NewGiftReservation {
  memberId: string
  wishId: string
  revision: bigint
  now: Date
}

export async function insertGiftReservation(
  tx: Tx,
  spaceId: string,
  data: NewGiftReservation,
): Promise<GiftReservation> {
  const inserted = await tx
    .insert(giftReservations)
    .values({
      spaceId,
      memberId: data.memberId,
      wishId: data.wishId,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a gift reservation returned no row')
  return row
}

/** A reservation row together with the author of the wish it holds. */
export interface GiftReservationWithWishAuthor {
  reservation: GiftReservation
  wishAuthorMemberId: string
}

/**
 * The wish's active reservation, or undefined when free. The visibility
 * rule is not applied here — every caller holds the wish in hand and
 * applies policy.ts's rule with its author — so the single-table lookup by
 * the wish's unique key is all the answer needs.
 */
export async function getGiftReservationInSpace(
  executor: Executor,
  spaceId: string,
  wishId: string,
): Promise<GiftReservation | undefined> {
  const rows = await executor
    .select()
    .from(giftReservations)
    .where(and(eq(giftReservations.spaceId, spaceId), eq(giftReservations.wishId, wishId)))
    .limit(1)
  return rows[0]
}

/**
 * The reservations the requesting member may see — on every member's
 * wishes but their own (policy.ts), creation order. The author's own
 * wishes' reservations never enter the answer, so the author probing the
 * listing learns nothing.
 */
export async function listGiftReservationsVisibleTo(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<GiftReservationWithWishAuthor[]> {
  return executor
    .select({
      reservation: giftReservations,
      wishAuthorMemberId: wishes.authorMemberId,
    })
    .from(giftReservations)
    .innerJoin(
      wishes,
      and(eq(wishes.spaceId, giftReservations.spaceId), eq(wishes.id, giftReservations.wishId)),
    )
    .where(and(eq(giftReservations.spaceId, spaceId), reservationVisibleToSql(memberId)))
    .orderBy(asc(giftReservations.createdAt), asc(giftReservations.id))
}

/** The reservations changed after `since` that the requesting member may see. */
export async function listChangedGiftReservationsVisibleTo(
  tx: Tx,
  spaceId: string,
  memberId: string,
  since: bigint,
): Promise<GiftReservationWithWishAuthor[]> {
  return tx
    .select({
      reservation: giftReservations,
      wishAuthorMemberId: wishes.authorMemberId,
    })
    .from(giftReservations)
    .innerJoin(
      wishes,
      and(eq(wishes.spaceId, giftReservations.spaceId), eq(wishes.id, giftReservations.wishId)),
    )
    .where(
      and(
        eq(giftReservations.spaceId, spaceId),
        gt(giftReservations.revision, since),
        reservationVisibleToSql(memberId),
      ),
    )
    .orderBy(desc(giftReservations.revision), desc(giftReservations.id))
}

export async function deleteGiftReservation(
  tx: Tx,
  spaceId: string,
  reservationId: string,
): Promise<GiftReservation | undefined> {
  const deleted = await tx
    .delete(giftReservations)
    .where(and(eq(giftReservations.spaceId, spaceId), eq(giftReservations.id, reservationId)))
    .returning()
  return deleted[0]
}
