import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../app/providers.tsx'
import { api } from '../../data/api.ts'
import { HealthCard } from './health-card.tsx'

vi.mock('../../data/api.ts', () => ({
  api: { GET: vi.fn() },
}))

const mockGetHealth = vi.mocked(api.GET)

function renderHealthCard() {
  return render(
    <AppProviders>
      <HealthCard />
    </AppProviders>,
  )
}

describe('HealthCard', () => {
  it('shows the ok status with per-service checks', async () => {
    mockGetHealth.mockResolvedValue({
      data: { status: 'ok', checks: { database: 'up', storage: 'up' } },
      error: undefined,
      response: new Response(),
    })

    renderHealthCard()

    expect(await screen.findByText('Все сервисы работают')).toBeInTheDocument()
    expect(screen.getByText('База данных')).toBeInTheDocument()
    expect(screen.getByText('Хранилище файлов')).toBeInTheDocument()
  })

  it('shows the degraded status when the API answers with 503', async () => {
    mockGetHealth.mockResolvedValue({
      data: undefined,
      error: { status: 'degraded', checks: { database: 'up', storage: 'down' } },
      response: new Response(),
    })

    renderHealthCard()

    expect(await screen.findByText('Некоторые сервисы недоступны')).toBeInTheDocument()
    expect(screen.getByText('Недоступно')).toBeInTheDocument()
  })

  it('shows the unreachable message when the API cannot be reached', async () => {
    mockGetHealth.mockRejectedValue(new TypeError('Failed to fetch'))

    renderHealthCard()

    expect(await screen.findByText('API недоступен')).toBeInTheDocument()
  })
})
