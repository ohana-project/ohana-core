import { createReadStream } from 'node:fs'
import { join, sep } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export interface StaticFilesOptions {
  webDist: string
}

export type SpaFallback = (request: FastifyRequest, reply: FastifyReply) => Promise<boolean>

export async function registerStaticFiles(
  app: FastifyInstance,
  options: StaticFilesOptions,
): Promise<void> {
  await app.register(fastifyStatic, {
    root: options.webDist,
    setHeaders: (reply, filePath) => {
      if (filePath.includes(`${sep}assets${sep}`)) {
        reply.header('cache-control', 'public, max-age=31536000, immutable')
      }
    },
  })
}

// Answers SPA navigations from index.html and reports whether it did, so the
// not-found handler stays independent of @fastify/static's reply decoration.
// Dotted last segments are treated as missing files and never fall back.
export function createSpaFallback(webDist: string): SpaFallback {
  const index = join(webDist, 'index.html')
  return async (request, reply) => {
    if (!isSpaNavigation(request.method, request.url)) return false
    await reply.type('text/html').send(createReadStream(index))
    return true
  }
}

export function isSpaNavigation(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  const path = url.split('?')[0] ?? '/'
  if (path === '/api' || path.startsWith('/api/')) return false
  const lastSegment = path.slice(path.lastIndexOf('/') + 1)
  return !lastSegment.includes('.')
}
