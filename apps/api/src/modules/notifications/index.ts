/**
 * The notifications module's public surface (issue #22): what the
 * composition roots mount and wire — the member-facing subscription
 * routes — and what the calendar's reminder sender reads: a member's
 * subscriptions and the removal of an expired endpoint. All else is the
 * module's interior; tests import it directly.
 */

export {
  PushPublicKeyDtoSchema,
  PushSubscriptionBodySchema,
  PushSubscriptionDetailsBodySchema,
  PushUnsubscribeBodySchema,
} from './contracts.ts'
export { notificationsRoutes } from './routes.ts'
export {
  ensureVapidKeys,
  listActiveSubscriptionsInTx,
  type NotificationsActor,
  type NotificationsDeps,
  publicKeyOf,
  removeExpiredSubscriptionInTx,
  setNotifyDetails,
  subscribe,
  unsubscribe,
  type VapidKeysRow,
} from './service.ts'
