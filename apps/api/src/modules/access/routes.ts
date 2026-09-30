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
  RedeemBodySchema,
  RedeemResponseSchema,
  SpaceIdParamsSchema,
} from './contracts.ts'
import {
  type AccessCodeListItem,
  type AccessDeps,
  authenticateMember,
  issueAccessCode,
  listAccessCodes,
  type MemberActor,
  redeemAccessCode,
  revokeAccessCode,
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
      const result = await redeemAccessCode(opts.deps, request.body.code)
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

  // Sign-out is deliberately not session-guarded: a stale or expired cookie
  // must still be cleared, so the route only names the member and deletes
  // the session when the token is still live.
  app.delete(
    '/me/session',
    {
      schema: {
        headers: MemberHeadersSchema,
        response: { 204: Type.Null() },
      },
    },
    async (request, reply) => {
      const memberId = request.headers['x-ohana-member'] as string
      await signOutMember(opts.deps, request.cookies?.[memberSessionCookieName(memberId)])
      reply.clearCookie(memberSessionCookieName(memberId), cookieOptions)
      return reply.code(204).send(null)
    },
  )
}
