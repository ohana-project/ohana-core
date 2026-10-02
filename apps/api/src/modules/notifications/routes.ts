import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
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
  PushUnsubscribeBodySchema,
} from './contracts.ts'
import {
  ensureVapidKeys,
  type NotificationsActor,
  type NotificationsDeps,
  setNotifyDetails,
  subscribe,
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

    // The device's departure, after the browser's own unsubscribe.
    scoped.delete(
      '/notifications/push/subscription',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: PushUnsubscribeBodySchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: NotificationsActor = requireMemberActor(request)
        await unsubscribe(opts.deps, actor, request.body.endpoint)
        return reply.code(204).send(null)
      },
    )
  })
}
