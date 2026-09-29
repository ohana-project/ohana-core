import { describe, expect, it } from 'vitest'
import { createClient, type paths } from './index.ts'

describe('the generated client', () => {
  it('sends requests to the API paths as written in the OpenAPI document', async () => {
    const requests: Request[] = []
    const client = createClient<paths>({
      baseUrl: 'http://ohana.test',
      fetch: async (request) => {
        requests.push(request)
        return Response.json({ status: 'ok', checks: { database: 'up', storage: 'up' } })
      },
    })

    const { data, error } = await client.GET('/api/health')

    expect(error).toBeUndefined()
    expect(data).toEqual({ status: 'ok', checks: { database: 'up', storage: 'up' } })
    expect(requests[0]?.url).toBe('http://ohana.test/api/health')
  })
})
