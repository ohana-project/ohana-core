/**
 * The notifications module's public surface (issue #22): what the
 * composition roots mount and wire — the member-facing subscription
 * routes — what the calendar's reminder sender reads: a member's
 * subscriptions and the removal of an expired endpoint — and what the
 * members lifecycle calls in its own transactions (issue #23): the
 * deletion of a member's subscriptions on archiving, restore, and purge.
 * All else is the module's interior; tests import it directly.
 */

export {
  PushPublicKeyDtoSchema,
  PushSubscriptionBodySchema,
  PushSubscriptionDetailsBodySchema,
  PushSubscriptionDtoSchema,
  PushSubscriptionParamsSchema,
  PushUnsubscribeBodySchema,
  PushUnsubscribeDtoSchema,
} from './contracts.ts'
export { notificationsRoutes } from './routes.ts'
export {
  deleteMemberSubscriptionsInTx,
  ensureVapidKeys,
  listSubscriptionsForMember,
  type NotificationsActor,
  type NotificationsDeps,
  removeSubscriptionsByEndpointAcrossSpaces,
  setNotifyDetails,
  subscribe,
  subscriptionOf,
  unsubscribe,
  type VapidKeysRow,
} from './service.ts'
