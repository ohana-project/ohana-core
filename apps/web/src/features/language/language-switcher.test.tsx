import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { HealthCard } from '@/features/health/health-card.tsx'
import { okHealthReport } from '@/testing/fixtures.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { LanguageSwitcher } from './language-switcher.tsx'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn() },
}))

beforeEach(() => {
  window.localStorage.clear()
})

describe('LanguageSwitcher', () => {
  it('marks Russian as active by default', () => {
    renderWithProviders(<LanguageSwitcher />)

    expect(screen.getByRole('button', { name: 'Русский' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('restores the stored language on mount', () => {
    window.localStorage.setItem('ohana.locale', 'en')

    renderWithProviders(<LanguageSwitcher />)

    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches the interface language to English and stores the choice', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LanguageSwitcher />)

    await user.click(screen.getByRole('button', { name: 'English' }))

    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem('ohana.locale')).toBe('en')
  })

  it('switches the visible page text between Russian and English', async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: okHealthReport,
      error: undefined,
      response: new Response(),
    })
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <LanguageSwitcher />
        <HealthCard />
      </>,
    )

    expect(await screen.findByText('Состояние API')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(await screen.findByText('API health')).toBeInTheDocument()
  })
})
