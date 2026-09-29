import type { FastifyInstance } from 'fastify'
import { DomainError } from '../platform/errors.ts'
import { isSpaNavigation } from '../platform/http/staticFiles.ts'

const frameworkErrorCodes: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'invalid_json',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'empty_body',
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
}

export interface ErrorHandlerOptions {
  webDist?: string
}

export function registerErrorHandler(
  app: FastifyInstance,
  options: ErrorHandlerOptions = {},
): void {
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
    const statusCode = (error as { statusCode?: number }).statusCode
    if (
      error instanceof Error &&
      typeof statusCode === 'number' &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      const code = frameworkErrorCodes[(error as { code?: string }).code ?? ''] ?? 'bad_request'
      return reply.status(statusCode).send({
        error: { code, message: error.message },
      })
    }
    request.log.error({ err: error }, 'Unhandled error')
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal server error' },
    })
  })

  app.setNotFoundHandler((request, reply) => {
    if (
      options.webDist !== undefined &&
      isSpaNavigation(request.method, request.url, request.headers.accept)
    ) {
      return reply.sendFile('index.html')
    }
    return reply.status(404).send({
      error: { code: 'not_found', message: `Route ${request.method} ${request.url} was not found` },
    })
  })
}
