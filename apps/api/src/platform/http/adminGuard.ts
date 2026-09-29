import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Administrative routes run behind this guard until the access module
 * provides real administrative sessions. It rejects every request so that
 * administrative operations are unreachable in a running installation.
 * Mount it as an onRequest hook inside a wrapping plugin scope, together
 * with the routes it protects.
 */
export async function adminGuard(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return reply.code(401).send({
    error: {
      code: 'unauthorized',
      message: 'Administrative authentication is not configured',
    },
  })
}
