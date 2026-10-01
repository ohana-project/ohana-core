import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { DomainError } from '../../platform/errors.ts'
import { AdminMarkerHeadersSchema, adminMarkerGuard, adminSessionGuard } from '../admin/index.ts'
import {
  AccessCodeDtoSchema,
  AccessCodeIssueParamsSchema,
  AccessCodeParamsSchema,
  IssuedAccessCodeDtoSchema,
  MEMBER_HEADER,
  MemberHeadersSchema,
  MemberIdParamsSchema,
  MemberSessionDtoSchema,
  type MemberSessionHeaders,
  MemberSessionHeadersSchema,
  MemberSessionParamsSchema,
  MemberSessionReviewDtoSchema,
  RedeemBodySchema,
  RedeemResponseSchema,
  SpaceIdParamsSchema,
} from './contracts.ts'
import {
  type AccessCodeListItem,
  type AccessDeps,
  authenticateMember,
  getMemberAccessCode,
  issueAccessCode,
  listAccessCodes,
  listMemberSessions,
  type MemberActor,
  redeemAccessCode,
  revokeAccessCode,
  revokeMemberAccessCode,
  revokeMemberSession,
  revokeMemberSessions,
  signOutMember,
} from './service.ts'

export const MEMBER_SESSION_COOKIE_PREFIX = 'ohana_member_session_'

/** Each retained sign-in has its own cookie, named per member (ADR-0005). */
export function memberSessionCookieName(memberId: string): string {
  return `${MEMBER_SESSION_COOKIE_PREFIX}${memberId}`
}

// /api, not /api/v1: the cookie must reach every member route.
const cookieOptions = {
  path: '/api',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
} as const

/**
 * Validates the member session: the X-Ohana-Member header names the member,
 * and only that member's own session cookie authorises the request. Used as
 * an onRequest hook by every member-facing route (architecture.md, request
 * lifecycle) — the access module publishes it the way the admin module
 * publishes the administrative guards.
 */
export function memberSessionGuard(deps: AccessDeps): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const memberId = request.headers[MEMBER_HEADER]
    const headerValue = Array.isArray(memberId) ? memberId[0] : memberId
    const token = request.cookies?.[memberSessionCookieName(headerValue ?? '')]
    const actor = await authenticateMember(deps, headerValue, token)
    if (actor === undefined) {
      throw new DomainError('unauthorized', 'A member session is required', 401)
    }
    request.actor = actor
  }
}

/** Narrows the request actor inside a member-guarded route. */
export function requireMemberActor(request: FastifyRequest): MemberActor {
  if (request.actor === undefined || request.actor.kind !== 'member') {
    throw new DomainError('unauthorized', 'A member session is required', 401)
  }
  return request.actor
}

/**
 * Narrows the actor to an owner, for the space-management routes (issue #12,
 * ADR-0005: an owner's authority ends at their own space — the space itself
 * always comes from the actor). A regular member's own data stays reachable,
 * so this is a 403 about the operation, not a 404 about visibility.
 */
export function requireOwnerActor(request: FastifyRequest): MemberActor {
  const actor = requireMemberActor(request)
  if (actor.role !== 'owner') {
    throw new DomainError('owner_required', 'An owner role is required', 403)
  }
  return actor
}

function toAccessCodeDto(item: AccessCodeListItem) {
  return {
    id: item.id,
    memberId: item.memberId,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    expiresAt: item.expiresAt.toISOString(),
    statusChangedAt: item.statusChangedAt.toISOString(),
  }
}

export interface AccessRoutesOptions {
  deps: AccessDeps
}

function toMemberSessionDto(
  item: {
    id: string
    browser: string
    platform: string
    createdAt: Date
    lastUsedAt: Date
  },
  currentSessionId: string,
) {
  return {
    id: item.id,
    browser: item.browser,
    platform: item.platform,
    createdAt: item.createdAt.toISOString(),
    lastUsedAt: item.lastUsedAt.toISOString(),
    current: item.id === currentSessionId,
  }
}

export const accessRoutes: FastifyPluginAsyncTypebox<AccessRoutesOptions> = async (app, opts) => {
  // Redemption is the one unauthenticated member route: the code is the
  // credential. SameSite cookies and same-origin serving stay the CSRF
  // defence — a cross-origin attacker still needs a valid code.
  app.post(
    '/access-codes/redeem',
    {
      schema: {
        body: RedeemBodySchema,
        response: { 200: RedeemResponseSchema },
      },
    },
    async (request, reply) => {
      const userAgent = request.headers['user-agent']
      const result = await redeemAccessCode(
        opts.deps,
        request.body.code,
        Array.isArray(userAgent) ? userAgent[0] : userAgent,
      )
      reply.setCookie(memberSessionCookieName(result.memberId), result.token, {
        ...cookieOptions,
        expires: result.expiresAt,
      })
      return {
        member: {
          id: result.memberId,
          name: result.name,
          displayName: result.displayName ?? undefined,
          role: result.role,
        },
        space: { id: result.spaceId, name: result.spaceName },
        needsOnboarding: result.needsOnboarding,
      }
    },
  )

  await app.register((administrative: FastifyInstance) => {
    const scoped = administrative.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', adminSessionGuard(opts.deps))
    scoped.addHook('onRequest', adminMarkerGuard)

    scoped.get(
      '/spaces/:spaceId/access-codes',
      {
        schema: {
          params: SpaceIdParamsSchema,
          response: { 200: Type.Array(AccessCodeDtoSchema) },
        },
      },
      async (request) => {
        const { spaceId } = request.params
        const rows = await listAccessCodes(opts.deps, spaceId)
        return rows.map(toAccessCodeDto)
      },
    )

    scoped.post(
      '/spaces/:spaceId/members/:memberId/access-codes',
      {
        schema: {
          params: AccessCodeIssueParamsSchema,
          headers: AdminMarkerHeadersSchema,
          response: { 201: IssuedAccessCodeDtoSchema },
        },
      },
      async (request, reply) => {
        const { spaceId, memberId } = request.params
        const administrator = request.actor
        if (administrator === undefined || administrator.kind !== 'admin') {
          throw new DomainError('unauthorized', 'An administrative session is required', 401)
        }
        const issued = await issueAccessCode(opts.deps, spaceId, memberId, {
          kind: 'administrator',
          administratorId: administrator.administratorId,
        })
        return reply.code(201).send({
          id: issued.id,
          memberId: issued.memberId,
          code: issued.code,
          status: issued.status,
          createdAt: issued.createdAt.toISOString(),
          expiresAt: issued.expiresAt.toISOString(),
          statusChangedAt: issued.statusChangedAt.toISOString(),
        })
      },
    )

    scoped.post(
      '/spaces/:spaceId/access-codes/:codeId/revoke',
      {
        schema: {
          params: AccessCodeParamsSchema,
          headers: AdminMarkerHeadersSchema,
          response: { 200: AccessCodeDtoSchema },
        },
      },
      async (request) => {
        const { spaceId, codeId } = request.params
        const revoked = await revokeAccessCode(opts.deps, spaceId, codeId)
        return toAccessCodeDto(revoked)
      },
    )
  })

  // The member's own device review (ADR-0005): the guard is the same one
  // other modules mount, published here for the access module's own
  // member-facing routes. The space and member always come from the actor.
  await app.register((memberArea: FastifyInstance) => {
    const scoped = memberArea.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', memberSessionGuard(opts.deps))

    scoped.get(
      '/me/sessions',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: Type.Array(MemberSessionDtoSchema) },
        },
      },
      async (request) => {
        const actor = requireMemberActor(request)
        const rows = await listMemberSessions(opts.deps, actor.spaceId, actor.memberId)
        return rows.map((row) => toMemberSessionDto(row, actor.sessionId))
      },
    )

    scoped.delete(
      '/me/sessions/:sessionId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: MemberSessionParamsSchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor = requireMemberActor(request)
        const { sessionId } = request.params
        await revokeMemberSession(opts.deps, actor.spaceId, actor.memberId, sessionId)
        // Revoking the session that made the request is also a sign-out on
        // this device: the cookie goes with it.
        if (sessionId === actor.sessionId) {
          reply.clearCookie(memberSessionCookieName(actor.memberId), cookieOptions)
        }
        return reply.code(204).send(null)
      },
    )

    // The owner's member management (issue #12, ADR-0005): codes issued,
    // replaced by reissuing, and revoked; devices reviewed and disconnected.
    // The member named in the path is resolved inside the actor's own space,
    // so an owner's authority ends at that space. The issuer of record is
    // the acting owner.
    scoped.post(
      '/members/:memberId/access-code',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: MemberIdParamsSchema,
          response: { 201: IssuedAccessCodeDtoSchema },
        },
      },
      async (request, reply) => {
        const actor = requireOwnerActor(request)
        const issued = await issueAccessCode(opts.deps, actor.spaceId, request.params.memberId, {
          kind: 'member',
          memberId: actor.memberId,
        })
        return reply.code(201).send({
          id: issued.id,
          memberId: issued.memberId,
          code: issued.code,
          status: issued.status,
          createdAt: issued.createdAt.toISOString(),
          expiresAt: issued.expiresAt.toISOString(),
          statusChangedAt: issued.statusChangedAt.toISOString(),
        })
      },
    )

    scoped.get(
      '/members/:memberId/access-code',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: MemberIdParamsSchema,
          response: { 200: AccessCodeDtoSchema },
        },
      },
      async (request) => {
        const actor = requireOwnerActor(request)
        const code = await getMemberAccessCode(opts.deps, actor.spaceId, request.params.memberId)
        return toAccessCodeDto(code)
      },
    )

    scoped.delete(
      '/members/:memberId/access-code',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: MemberIdParamsSchema,
          response: { 200: AccessCodeDtoSchema },
        },
      },
      async (request) => {
        const actor = requireOwnerActor(request)
        const revoked = await revokeMemberAccessCode(
          opts.deps,
          actor.spaceId,
          request.params.memberId,
        )
        return toAccessCodeDto(revoked)
      },
    )

    scoped.get(
      '/members/:memberId/sessions',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: MemberIdParamsSchema,
          response: { 200: Type.Array(MemberSessionReviewDtoSchema) },
        },
      },
      async (request) => {
        const actor = requireOwnerActor(request)
        const rows = await listMemberSessions(opts.deps, actor.spaceId, request.params.memberId)
        return rows.map((row) => ({
          id: row.id,
          browser: row.browser,
          platform: row.platform,
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt.toISOString(),
        }))
      },
    )

    scoped.delete(
      '/members/:memberId/sessions',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: MemberIdParamsSchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor = requireOwnerActor(request)
        await revokeMemberSessions(opts.deps, actor.spaceId, request.params.memberId)
        return reply.code(204).send(null)
      },
    )
  })

  // Sign-out is deliberately not session-guarded: a stale or expired cookie
  // must still be cleared, so the route only names the member and deletes
  // the session when the token is still live.
  app.delete(
    '/me/session',
    {
      schema: {
        headers: MemberSessionHeadersSchema,
        response: { 204: Type.Null() },
      },
    },
    async (request, reply) => {
      const { 'x-ohana-member': memberId } = request.headers as MemberSessionHeaders
      await signOutMember(opts.deps, memberId, request.cookies?.[memberSessionCookieName(memberId)])
      reply.clearCookie(memberSessionCookieName(memberId), cookieOptions)
      return reply.code(204).send(null)
    },
  )
}
