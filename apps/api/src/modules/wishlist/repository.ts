import { and, asc, desc, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { type Wish, wishes } from './tables.ts'

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
 * The one-way mark into received (CONTEXT.md, received wish): the moment
 * is stamped once, and a wish already received returns no row — the use
 * case refuses, mirroring the journal's one-way publish guard.
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
 * moment ties.
 */
export async function listWishesInSpace(
  executor: Executor,
  spaceId: string,
  authorMemberId: string | undefined,
): Promise<Wish[]> {
  return executor
    .select()
    .from(wishes)
    .where(
      and(
        eq(wishes.spaceId, spaceId),
        authorMemberId === undefined ? undefined : eq(wishes.authorMemberId, authorMemberId),
      ),
    )
    .orderBy(asc(wishes.createdAt), asc(wishes.id))
}

/**
 * The rows changed after `since` that the requesting member may see — the
 * sync contributor's delta (issue #14). Every wish of the space travels to
 * every member (policy.ts), so the filter is the space scope alone.
 */
export async function listChangedWishesVisibleTo(
  tx: Tx,
  spaceId: string,
  since: bigint,
): Promise<Wish[]> {
  return tx
    .select()
    .from(wishes)
    .where(and(eq(wishes.spaceId, spaceId), gt(wishes.revision, since)))
    .orderBy(desc(wishes.revision), desc(wishes.id))
}
