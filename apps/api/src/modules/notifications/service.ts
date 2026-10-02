import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor, Tx } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import { generateVapidKeys } from '../../platform/push/webpush.ts'
import {
  deletePushSubscription,
  deletePushSubscriptionByEndpointAcrossSpaces,
  getPushVapidKeys,
  insertPushVapidKeys,
  listPushSubscriptionsForMember,
  setSubscriptionNotifyDetails,
  upsertPushSubscription,
} from './repository.ts'
import type { PushSubscription, PushVapidKeysRow } from './tables.ts'

/*
 * The notifications module's use cases (issue #22): the device's
 * subscription lifecycle and the installation's VAPID identity. There are
 * no permission decisions of their own here — a member manages only their
 * own devices, because the actor's space and id come from the
 * authenticated member (architecture.md, request lifecycle) and every
 * query is scoped to them.
 */

export interface NotificationsDeps {
  db: Db
  clock: Clock
}

/** The member a notifications use case runs for (the access module's shape,
 *  satisfied structurally like the calendar's actor). */
export interface NotificationsActor {
  memberId: string
  spaceId: string
}

/**
 * The installation's VAPID keys, generated on first start and persisted
 * (the acceptance criteria): an INSERT that arms the singleton's unique
 * index, so two entrypoints starting together generate twice and agree on
 * the winner. Every later start reads the persisted pair.
 */
export async function ensureVapidKeys(deps: NotificationsDeps): Promise<VapidKeysRow> {
  const existing = await getPushVapidKeys(deps.db)
  if (existing !== undefined) return existing
  await deps.db.transaction(async (tx) => {
    await insertPushVapidKeys(tx, { ...generateVapidKeys(), now: deps.clock.now() })
  })
  const row = await getPushVapidKeys(deps.db)
  if (row === undefined) throw new Error('Ensuring the VAPID keys produced no row')
  return row
}

/** The public half the browser subscribes with — the private half never
 *  leaves the server. */
export function publicKeyOf(row: PushVapidKeysRow): string {
  return row.publicKey
}

export interface SubscribeInput {
  endpoint: string
  p256dh: string
  auth: string
  notifyDetails: boolean
}

/** The device's subscription, stored per member and endpoint. */
export async function subscribe(
  deps: NotificationsDeps,
  actor: NotificationsActor,
  input: SubscribeInput,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await upsertPushSubscription(tx, actor.spaceId, actor.memberId, {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      notifyDetails: input.notifyDetails,
      now,
    })
  })
}

/** The device's own opt-in to showing event details (ADR-0006). */
export async function setNotifyDetails(
  deps: NotificationsDeps,
  actor: NotificationsActor,
  endpoint: string,
  notifyDetails: boolean,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    const row = await setSubscriptionNotifyDetails(
      tx,
      actor.spaceId,
      actor.memberId,
      endpoint,
      notifyDetails,
      now,
    )
    if (row === undefined) {
      // A device that was never subscribed (or signed in as someone else)
      // has nothing to opt in on.
      throw new DomainError(
        'push_subscription_not_found',
        `No push subscription for endpoint ${endpoint}`,
        404,
      )
    }
  })
}

/** The device's departure: the browser has usually unsubscribed already —
 *  the delete is idempotent either way. */
export async function unsubscribe(
  deps: NotificationsDeps,
  actor: NotificationsActor,
  endpoint: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await deletePushSubscription(tx, actor.spaceId, actor.memberId, endpoint)
  })
}

// The VAPID row is the module's own shape; the alias keeps the public
// surface honest about what ensureVapidKeys returns without exporting the
// table object (architecture.md, dependency rules).
export type VapidKeysRow = PushVapidKeysRow

/*
 * The reads and removals the calendar's reminder sender (issue #22) takes
 * through this module's public surface — the same shape the members
 * module's listMemberIdsInTx publishes for its audience fan-outs.
 */

/** The member's devices: every subscription a reminder delivers to. */
export function listActiveSubscriptionsInTx(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<PushSubscription[]> {
  return listPushSubscriptionsForMember(executor, spaceId, memberId)
}

/**
 * The removal of an endpoint the push service rejected as expired — the
 * one cross-space subscription write, because the push service speaks
 * endpoints, not spaces.
 */
export function removeExpiredSubscriptionInTx(tx: Tx, endpoint: string): Promise<void> {
  return deletePushSubscriptionByEndpointAcrossSpaces(tx, endpoint)
}
