import createClient from 'openapi-fetch'

// The client is the contract's only doorway, so its middleware type travels
// with it: features add request behaviour without importing openapi-fetch.
export type { Middleware } from 'openapi-fetch'
export type { components, operations, paths } from './openapi.gen.ts'
export { createClient }
