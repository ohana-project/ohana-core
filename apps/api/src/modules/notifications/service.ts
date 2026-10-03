import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor, Tx } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import type { VapidKeys } from '../../platform/push/index.ts'
import {
  countSubscriptionsByEndpointAcrossSpaces,
  deletePushSubscription,
  deletePushSubscriptionByEndpointAcrossSpaces,
  getPushSubscription,
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
 * query is scoped to them. The subscription is the *member's device*: a
 * browser that holds several members' sign-ins carries one physical
 * subscription that several rows share, and each member's switch answers
 * for their own row alone.
 */

export interface NotificationsDeps {
  db: Db
  clock: Clock
  /**
   * The VAPID pair generator, the platform's own (architecture.md,
   * "Composition": services receive their dependencies explicitly).
   */
  generateKeys: () => VapidKeys
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
    await insertPushVapidKeys(tx, { ...deps.generateKeys(), now: deps.clock.now() })
  })
  const row = await getPushVapidKeys(deps.db)
  if (row === undefined) throw new Error('Ensuring the VAPID keys produced no row')
  return row
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
  assertRoutableEndpoint(input.endpoint)
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

/** The actor's own row for an endpoint: what this member's switches read,
 *  never another member's — one browser can hold several members. */
export async function subscriptionOf(
  executor: Executor,
  actor: NotificationsActor,
  endpoint: string,
): Promise<PushSubscription | undefined> {
  return getPushSubscription(executor, actor.spaceId, actor.memberId, endpoint)
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

/**
 * The device's departure for this member. The answer tells the client
 * whether the *browser's* physical subscription is now held by nobody —
 * another member of the same browser may still share the endpoint, and
 * only then may the page call the browser's own unsubscribe.
 */
export async function unsubscribe(
  deps: NotificationsDeps,
  actor: NotificationsActor,
  endpoint: string,
): Promise<boolean> {
  let releaseBrowserSubscription = false
  await deps.db.transaction(async (tx) => {
    const removed = await deletePushSubscription(tx, actor.spaceId, actor.memberId, endpoint)
    // The endpoint stays a secret of the one who held it: a member that
    // never subscribed learns nothing about who else does.
    if (removed !== undefined) {
      const remaining = await countSubscriptionsByEndpointAcrossSpaces(tx, endpoint)
      releaseBrowserSubscription = remaining === 0
    }
  })
  return releaseBrowserSubscription
}

/**
 * The push services a browser's subscription can name: the allowlist is
 * the SSRF answer, not a blocklist — a blocklist fights the whole space
 * of odd hostnames (trailing dots, DNS names that resolve inward). The
 * worker POSTs every reminder to whatever endpoint a row carries, so
 * only these hosts, on their default port, are accepted.
 */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome / Android (Firebase Cloud Messaging).
  'updates.push.services.mozilla.com', // Firefox.
  'web.push.apple.com', // Safari, including Home Screen web apps on iOS.
  'push.services.mozilla.com', // Firefox's legacy host.
] as const

/** Windows' WNS shards its endpoints per region
 *  (`wns2-bn3p.notify.windows.com`), so the Windows/Edge service matches
 *  by suffix. */
const PUSH_SERVICE_HOST_SUFFIXES = ['notify.windows.com'] as const

/**
 * The endpoint is where the worker's sends go: an https URL on one of the
 * public push services. Anything else is refused at the door.
 */
function assertRoutableEndpoint(endpoint: string): void {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new DomainError('invalid_push_endpoint', `“${endpoint}” is not a URL`, 400)
  }
  if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443')) {
    throw new DomainError(
      'invalid_push_endpoint',
      `“${endpoint}” is not an https endpoint on a public push service`,
      400,
    )
  }
  // A trailing dot is the root's own spelling of the same host.
  const host = url.hostname.replace(/\.$/, '')
  const known =
    (PUSH_SERVICE_HOSTS as readonly string[]).includes(host) ||
    PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  if (!known) {
    throw new DomainError(
      'invalid_push_endpoint',
      `“${endpoint}” does not name a public push service`,
      400,
    )
  }
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
export function listSubscriptionsForMember(
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
export function removeSubscriptionsByEndpointAcrossSpaces(tx: Tx, endpoint: string): Promise<void> {
  return deletePushSubscriptionByEndpointAcrossSpaces(tx, endpoint)
}
