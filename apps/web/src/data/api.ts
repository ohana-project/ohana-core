import { createClient, type paths } from '@ohana/api-client'
import { getActiveMemberId } from '@/data/session-registry.ts'

// The generated paths already include the `/api` prefix, so the client is
// created without a base URL and every request stays same-origin relative.
export const api = createClient<paths>()

// Every member request names its member (architecture.md, request
// lifecycle): the active member's id rides along as X-Ohana-Member, and
// the API accepts it only with that member's session cookie.
api.use({
  onRequest({ request }) {
    const memberId = getActiveMemberId()
    if (memberId !== undefined) {
      request.headers.set('x-ohana-member', memberId)
    }
    return request
  },
})
