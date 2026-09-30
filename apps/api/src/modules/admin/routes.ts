import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyRequest } from 'fastify'
import { DomainError } from '../../platform/errors.ts'
import {
  AdminMarkerHeadersSchema,
  ChangePasswordBodySchema,
  SignInBodySchema,
} from './contracts.ts'
import {
  type AdminActor,
  type AdminDeps,
  authenticateAdmin,
  changeAdminPassword,
  signInAdmin,
  signOutAdmin,
} from './service.ts'

export const ADMIN_SESSION_COOKIE = 'ohana_admin_session'
export const ADMIN_MARKER_HEADER = 'x-ohana-admin'

// /api, not /api/v1/admin: the cookie must also reach every other
// administrative route, such as the space-management routes.
const cookieOptions = {
  path: '/api',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
} as const

declare module 'fastify' {
  interface FastifyRequest {
    actor?: AdminActor
  }
}

/**
 * Administrative state-changing requests must carry the X-Ohana-Admin marker
 * header. Together with the SameSite cookie and same-origin serving this is
 * the CSRF defence: cross-origin requests cannot set custom headers.
 */
export async function adminMarkerGuard(request: FastifyRequest): Promise<void> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return
  if (request.headers[ADMIN_MARKER_HEADER] === undefined) {
    throw new DomainError(
      'missing_admin_header',
      `State-changing administrative requests must carry the ${ADMIN_MARKER_HEADER} header`,
      403,
    )
  }
}

/** Validates the administrative session cookie and attaches the admin actor. */
export function adminSessionGuard(deps: AdminDeps): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const token = request.cookies?.[ADMIN_SESSION_COOKIE]
    const actor = await authenticateAdmin(deps, token)
    if (actor === undefined) {
      throw new DomainError('unauthorized', 'An administrative session is required', 401)
    }
    request.actor = actor
  }
}

export interface AdminRoutesOptions {
  deps: AdminDeps
}

const noContentSchema = { 204: Type.Null() }

export const adminRoutes: FastifyPluginAsyncTypebox<AdminRoutesOptions> = async (app, opts) => {
  app.post(
    '/session',
    {
      schema: {
        body: SignInBodySchema,
        headers: AdminMarkerHeadersSchema,
        response: noContentSchema,
      },
      onRequest: adminMarkerGuard,
    },
    async (request, reply) => {
      const grant = await signInAdmin(opts.deps, request.body.password)
      reply.setCookie(ADMIN_SESSION_COOKIE, grant.token, {
        ...cookieOptions,
        expires: grant.expiresAt,
      })
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/session',
    { schema: { response: noContentSchema }, onRequest: adminSessionGuard(opts.deps) },
    async (_request, reply) => reply.code(204).send(null),
  )

  app.delete(
    '/session',
    {
      schema: { headers: AdminMarkerHeadersSchema, response: noContentSchema },
      onRequest: [adminMarkerGuard, adminSessionGuard(opts.deps)],
    },
    async (request, reply) => {
      await signOutAdmin(opts.deps, request.cookies?.[ADMIN_SESSION_COOKIE])
      reply.clearCookie(ADMIN_SESSION_COOKIE, cookieOptions)
      return reply.code(204).send(null)
    },
  )

  app.post(
    '/password',
    {
      schema: {
        body: ChangePasswordBodySchema,
        headers: AdminMarkerHeadersSchema,
        response: noContentSchema,
      },
      onRequest: [adminMarkerGuard, adminSessionGuard(opts.deps)],
    },
    async (request, reply) => {
      await changeAdminPassword(opts.deps, request.body.currentPassword, request.body.newPassword)
      return reply.code(204).send(null)
    },
  )
}
