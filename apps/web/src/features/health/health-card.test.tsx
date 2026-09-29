import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { degradedHealthReport, okHealthReport } from '@/testing/fixtures.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { HealthCard } from './health-card.tsx'
import type { ApiHealthReport } from './use-api-health.ts'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn() },
}))

const mockGetHealth = vi.mocked(api.GET)

describe('HealthCard', () => {
  it('shows the ok status with per-service checks', async () => {
    mockGetHealth.mockResolvedValue({
      data: okHealthReport,
      error: undefined,
      response: new Response(),
    })

    renderWithProviders(<HealthCard />)

    expect(await screen.findByText('Все сервисы работают')).toBeInTheDocument()
    expect(screen.getByText('База данных')).toBeInTheDocument()
    expect(screen.getByText('Хранилище файлов')).toBeInTheDocument()
  })

  it('shows the degraded status when the API answers with 503', async () => {
    mockGetHealth.mockResolvedValue({
      data: undefined,
      error: degradedHealthReport,
      response: new Response(),
    })

    renderWithProviders(<HealthCard />)

    expect(await screen.findByText('Некоторые сервисы недоступны')).toBeInTheDocument()
    expect(screen.getByText('Недоступно')).toBeInTheDocument()
  })

  it('shows the unreachable message when the error body is not a health report', async () => {
    mockGetHealth.mockResolvedValue({
      data: undefined,
      error: { message: 'Gateway error' } as unknown as ApiHealthReport,
      response: new Response(),
    })

    renderWithProviders(<HealthCard />)

    expect(await screen.findByText('API недоступен')).toBeInTheDocument()
  })

  it('shows the unreachable message when the API cannot be reached', async () => {
    mockGetHealth.mockRejectedValue(new TypeError('Failed to fetch'))

    renderWithProviders(<HealthCard />)

    expect(await screen.findByText('API недоступен')).toBeInTheDocument()
  })
})
