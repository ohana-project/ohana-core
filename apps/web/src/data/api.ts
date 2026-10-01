import { createClient, type Middleware, type paths } from '@ohana/api-client'
import { getActiveMemberId } from '@/data/session-registry.ts'

// The generated paths already include the `/api` prefix, so the client is
// created without a base URL and every request stays same-origin relative.
export const api = createClient<paths>()

/**
 * Every member request names its member (architecture.md, request
 * lifecycle): the active member rides along as X-Ohana-Member, and the API
 * accepts it only with that member's session cookie. The active member is
 * the default, never an override: a request that already names its member
 * — a query pinned to one member's cache key — keeps that name, so a
 * refetch racing a switch can only answer for the key's member. Named and
 * exported so tests run the real middleware through a real client.
 */
export function ohanaMemberMiddleware(): Middleware {
  return {
    onRequest({ request }) {
      const memberId = getActiveMemberId()
      if (memberId !== undefined && !request.headers.has('x-ohana-member')) {
        request.headers.set('x-ohana-member', memberId)
      }
      return request
    },
  }
}

api.use(ohanaMemberMiddleware())
