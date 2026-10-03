import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { notFound } from '../../platform/errors.ts'
import {
  type AccessDeps,
  MemberHeadersSchema,
  memberSessionGuard,
  requireMemberActor,
} from '../access/index.ts'
import {
  PushPublicKeyDtoSchema,
  PushSubscriptionBodySchema,
  PushSubscriptionDetailsBodySchema,
  PushSubscriptionDtoSchema,
  PushSubscriptionParamsSchema,
  PushUnsubscribeBodySchema,
  PushUnsubscribeDtoSchema,
} from './contracts.ts'
import {
  ensureVapidKeys,
  type NotificationsActor,
  type NotificationsDeps,
  setNotifyDetails,
  subscribe,
  subscriptionOf,
  unsubscribe,
} from './service.ts'

export interface NotificationsRoutesOptions {
  deps: NotificationsDeps
  /** The access module's deps, for the member session guard it publishes. */
  access: AccessDeps
}

/**
 * The push subscriptions' member-facing routes (issue #22). Notifications
 * are not a section (ADR-0011) — they are the member's own devices — so
 * the routes carry the member session guard and nothing else. Every
 * subscription write rides a user gesture on that device, which the
 * browser has already enforced before the endpoint is even minted.
 */
export const notificationsRoutes: FastifyPluginAsyncTypebox<NotificationsRoutesOptions> = async (
  app,
  opts,
) => {
  await app.register(async (memberArea: FastifyInstance) => {
    const scoped = memberArea.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', memberSessionGuard(opts.access))

    // The installation's public half: what pushManager.subscribe signs the
    // device up against. The private half never leaves the server.
    scoped.get(
      '/notifications/push/public-key',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: PushPublicKeyDtoSchema },
        },
      },
      async () => {
        const vapid = await ensureVapidKeys(opts.deps)
        return { publicKey: vapid.publicKey }
      },
    )

    // The device's subscription, stored per member and endpoint; the
    // details opt-in rides the same write.
    scoped.put(
      '/notifications/push/subscription',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: PushSubscriptionBodySchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: NotificationsActor = requireMemberActor(request)
        await subscribe(opts.deps, actor, {
          endpoint: request.body.endpoint,
          p256dh: request.body.keys.p256dh,
          auth: request.body.keys.auth,
          notifyDetails: request.body.notifyDetails,
        })
        return reply.code(204).send(null)
      },
    )

    // The actor's own row for the browser's endpoint: what this member's
    // switches read, never another member's — one browser can hold several
    // members, and the physical subscription is the browser's, not theirs.
    scoped.get(
      '/notifications/push/subscription',
      {
        schema: {
          headers: MemberHeadersSchema,
          querystring: PushSubscriptionParamsSchema,
          response: { 200: PushSubscriptionDtoSchema },
        },
      },
      async (request) => {
        const actor: NotificationsActor = requireMemberActor(request)
        const row = await subscriptionOf(opts.deps.db, actor, request.query.endpoint)
        if (row === undefined) {
          // Another member's device answers like any invisible resource
          // (architecture.md, "Errors").
          throw notFound(
            'push_subscription_not_found',
            `No push subscription for endpoint ${request.query.endpoint}`,
          )
        }
        return { notifyDetails: row.notifyDetails }
      },
    )

    // The device's own opt-in to showing event details (ADR-0006).
    scoped.patch(
      '/notifications/push/subscription',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: PushSubscriptionDetailsBodySchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: NotificationsActor = requireMemberActor(request)
        await setNotifyDetails(opts.deps, actor, request.body.endpoint, request.body.notifyDetails)
        return reply.code(204).send(null)
      },
    )

    // The member's row goes; the answer tells the page whether nobody
    // holds the browser's physical subscription any more — another member
    // of the same browser may still share it.
    scoped.delete(
      '/notifications/push/subscription',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: PushUnsubscribeBodySchema,
          response: { 200: PushUnsubscribeDtoSchema },
        },
      },
      async (request) => {
        const actor: NotificationsActor = requireMemberActor(request)
        const releaseBrowserSubscription = await unsubscribe(
          opts.deps,
          actor,
          request.body.endpoint,
        )
        return { releaseBrowserSubscription }
      },
    )
  })
}
