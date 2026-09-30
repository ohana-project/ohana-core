import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  AdminMarkerHeadersSchema,
  type ChangePasswordBody,
  ChangePasswordBodySchema,
  type SignInBody,
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

const cookieOptions = {
  path: '/api/v1/admin',
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
export async function adminMarkerGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return
  if (request.headers[ADMIN_MARKER_HEADER] === undefined) {
    return reply.code(403).send({
      error: {
        code: 'missing_admin_header',
        message: `State-changing administrative requests must carry the ${ADMIN_MARKER_HEADER} header`,
      },
    })
  }
}

/** Validates the administrative session cookie and attaches the admin actor. */
export function adminSessionGuard(
  deps: AdminDeps,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const token = request.cookies?.[ADMIN_SESSION_COOKIE]
    const actor = await authenticateAdmin(deps, token)
    if (actor === undefined) {
      return reply.code(401).send({
        error: {
          code: 'unauthorized',
          message: 'An administrative session is required',
        },
      })
    }
    request.actor = actor
  }
}

export interface AdminRoutesOptions {
  deps: AdminDeps
}

const noContentSchema = { 204: Type.Null() }

export const adminRoutes: FastifyPluginAsyncTypebox<AdminRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const scoped = app.withTypeProvider<TypeBoxTypeProvider>()

  scoped.post(
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
      const grant = await signInAdmin(opts.deps, (request.body as SignInBody).password)
      reply.setCookie(ADMIN_SESSION_COOKIE, grant.token, {
        ...cookieOptions,
        expires: grant.expiresAt,
      })
      return reply.code(204).send(null)
    },
  )

  scoped.get(
    '/session',
    { schema: { response: noContentSchema }, onRequest: adminSessionGuard(opts.deps) },
    async (_request, reply) => reply.code(204).send(null),
  )

  scoped.delete(
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

  scoped.post(
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
      const body = request.body as ChangePasswordBody
      await changeAdminPassword(opts.deps, body.currentPassword, body.newPassword)
      return reply.code(204).send(null)
    },
  )
}
