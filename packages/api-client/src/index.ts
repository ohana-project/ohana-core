import createClient from 'openapi-fetch'
import type { components, operations, paths } from './openapi.gen.ts'

export type { components, operations, paths }

export type OhanaClient = ReturnType<typeof createClient<paths>>
export type OhanaClientOptions = Parameters<typeof createClient<paths>>[0]

/**
 * The generated paths already include the `/api` prefix, so the client is
 * created without a base URL and every request stays same-origin relative.
 * Only pass a base URL when the caller cannot resolve relative URLs (tests).
 */
export function createOhanaClient(options?: OhanaClientOptions): OhanaClient {
  return createClient<paths>(options)
}
