import { createClient, type paths } from '@ohana/api-client'

// The generated paths already include the `/api` prefix, so the client is
// created without a base URL and every request stays same-origin relative.
export const api = createClient<paths>()
