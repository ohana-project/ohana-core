import type { FastifyInstance } from 'fastify'
import { DomainError } from '../platform/errors.ts'

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.httpStatus).send({
        error: { code: error.code, message: error.message },
      })
    }
    if (error instanceof Error && 'validation' in error && error.validation !== undefined) {
      return reply.status(400).send({
        error: { code: 'validation_failed', message: error.message },
      })
    }
    request.log.error({ err: error }, 'Unhandled error')
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal server error' },
    })
  })

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: { code: 'not_found', message: `Route ${request.method} ${request.url} was not found` },
    })
  })
}
