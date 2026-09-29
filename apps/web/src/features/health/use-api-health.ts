import { useQuery } from '@tanstack/react-query'
import { api } from '../../data/api.ts'

export function useApiHealth() {
  return useQuery({
    queryKey: ['api', 'health'],
    queryFn: async () => {
      // The degraded report arrives as a 503 response body, not a thrown error.
      const { data, error } = await api.GET('/api/health')
      const report = data ?? error
      if (!report) {
        throw new Error('The API did not answer with a health report')
      }
      return report
    },
  })
}
