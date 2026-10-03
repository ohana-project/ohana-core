import { and, eq, sql } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import {
  type PushSubscription,
  type PushVapidKeysRow,
  pushSubscriptions,
  pushVapidKeys,
} from './tables.ts'

/**
 * Every subscription query takes the space as its required first argument
 * (architecture.md, "Space scoping") — a subscription belongs to exactly
 * one member of exactly one space. The VAPID row is the installation's
 * singleton, the one deliberate cross-space read.
 */

export async function insertPushVapidKeys(
  tx: Tx,
  keys: { publicKey: string; privateKey: string; now: Date },
): Promise<PushVapidKeysRow | undefined> {
  // The conflict arms the singleton race: two processes starting together
  // both generate, one insert wins, the loser re-reads below.
  const inserted = await tx
    .insert(pushVapidKeys)
    .values({ publicKey: keys.publicKey, privateKey: keys.privateKey, createdAt: keys.now })
    .onConflictDoNothing()
    .returning()
  return inserted[0]
}

export async function getPushVapidKeys(executor: Executor): Promise<PushVapidKeysRow | undefined> {
  const rows = await executor.select().from(pushVapidKeys).limit(1)
  return rows[0]
}

export interface NewPushSubscription {
  endpoint: string
  p256dh: string
  auth: string
  notifyDetails: boolean
  now: Date
}

/**
 * The device's subscription, upserted per member and endpoint: a
 * re-subscription — the same browser subscribing again, possibly with
 * rotated keys or a changed opt-in — replaces the row's credentials in
 * place.
 */
export async function upsertPushSubscription(
  tx: Tx,
  spaceId: string,
  memberId: string,
  data: NewPushSubscription,
): Promise<PushSubscription> {
  const inserted = await tx
    .insert(pushSubscriptions)
    .values({
      spaceId,
      memberId,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      notifyDetails: data.notifyDetails,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.spaceId, pushSubscriptions.memberId, pushSubscriptions.endpoint],
      set: {
        p256dh: data.p256dh,
        auth: data.auth,
        notifyDetails: data.notifyDetails,
        updatedAt: data.now,
      },
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Upserting a push subscription returned no row')
  return row
}

export async function setSubscriptionNotifyDetails(
  tx: Tx,
  spaceId: string,
  memberId: string,
  endpoint: string,
  notifyDetails: boolean,
  now: Date,
): Promise<PushSubscription | undefined> {
  const updated = await tx
    .update(pushSubscriptions)
    .set({ notifyDetails, updatedAt: now })
    .where(
      and(
        eq(pushSubscriptions.spaceId, spaceId),
        eq(pushSubscriptions.memberId, memberId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning()
  return updated[0]
}

/** The row the member held for the endpoint, or undefined when they held
 *  none — the caller decides whether that absence is a 404 or a quiet
 *  answer. */
export async function deletePushSubscription(
  tx: Tx,
  spaceId: string,
  memberId: string,
  endpoint: string,
): Promise<PushSubscription | undefined> {
  const deleted = await tx
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.spaceId, spaceId),
        eq(pushSubscriptions.memberId, memberId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning()
  return deleted[0]
}

export async function getPushSubscription(
  executor: Executor,
  spaceId: string,
  memberId: string,
  endpoint: string,
): Promise<PushSubscription | undefined> {
  const rows = await executor
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.spaceId, spaceId),
        eq(pushSubscriptions.memberId, memberId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .limit(1)
  return rows[0]
}

/** How many members still hold the endpoint: the delete's answer about the
 *  browser's physical subscription, and the by-endpoint removal's reach. */
export async function countSubscriptionsByEndpointAcrossSpaces(
  tx: Tx,
  endpoint: string,
): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
  return rows[0]?.count ?? 0
}

/** The member's subscriptions — every device reminders may reach. */
export async function listPushSubscriptionsForMember(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<PushSubscription[]> {
  return executor
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.spaceId, spaceId), eq(pushSubscriptions.memberId, memberId)))
}

/** The subscription an expired endpoint answers for, wherever it sat —
 *  the push service speaks endpoints, not spaces (the by-hash reads'
 *  stated exception, architecture.md, "Space scoping"). */
export async function deletePushSubscriptionByEndpointAcrossSpaces(
  tx: Tx,
  endpoint: string,
): Promise<void> {
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
}

/**
 * The member's subscriptions, deleted whole (issue #23): the archiving
 * takes them in its own transaction — the archived member's devices
 * cannot unsubscribe themselves.
 */
export async function deletePushSubscriptionsForMember(
  tx: Tx,
  spaceId: string,
  memberId: string,
): Promise<void> {
  await tx
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.spaceId, spaceId), eq(pushSubscriptions.memberId, memberId)))
}
