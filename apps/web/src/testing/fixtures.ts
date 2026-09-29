import type { ApiHealthReport } from '@/features/health/use-api-health.ts'

export const okHealthReport = {
  status: 'ok',
  checks: { database: 'up', storage: 'up' },
} satisfies ApiHealthReport

export const degradedHealthReport = {
  status: 'degraded',
  checks: { database: 'up', storage: 'down' },
} satisfies ApiHealthReport
