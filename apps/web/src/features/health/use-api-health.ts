import type { paths } from '@ohana/api-client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/data/api.ts'

export type ApiHealthReport =
  paths['/api/health']['get']['responses'][200]['content']['application/json']

function isHealthReport(value: unknown): value is ApiHealthReport {
  if (typeof value !== 'object' || value === null || !('status' in value) || !('checks' in value)) {
    return false
  }
  const { status, checks } = value as Record<string, unknown>
  return (
    (status === 'ok' || status === 'degraded') &&
    typeof checks === 'object' &&
    checks !== null &&
    'database' in checks &&
    'storage' in checks
  )
}

export function useApiHealth() {
  return useQuery({
    queryKey: ['api', 'health'],
    queryFn: async () => {
      // The degraded report arrives as a 503 response body, and a proxy or
      // gateway failure can leave any other body in `error` — only accept
      // shapes the card can actually render.
      const { data, error } = await api.GET('/api/health')
      const body: unknown = data ?? error
      if (!isHealthReport(body)) {
        throw new Error('The API did not answer with a health report')
      }
      return body
    },
  })
}
