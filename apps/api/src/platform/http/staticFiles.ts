import { sep } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

export interface StaticFilesOptions {
  webDist: string
}

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

export function isSpaNavigation(method: string, url: string, accept: string | undefined): boolean {
  if (method !== 'GET') return false
  const path = url.split('?')[0] ?? '/'
  if (path === '/api' || path.startsWith('/api/')) return false
  if (accept?.includes('text/html')) return true
  const lastSegment = path.slice(path.lastIndexOf('/') + 1)
  return !lastSegment.includes('.')
}
