import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminSpacesList } from './admin-spaces-list.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/admin">{children}</a>,
}))

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

const apiGet = vi.mocked(api.GET)
const apiPost = vi.mocked(api.POST)

const SPACES = [
  {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'Наша семья',
    timezone: 'Europe/Moscow',
    revision: '3',
    memberCount: 4,
    createdAt: '2026-08-12T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: '01900000-0000-7000-8000-000000000002',
    name: 'Дача',
    timezone: 'UTC',
    revision: '0',
    memberCount: 0,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
  },
]

function okBody(body: unknown) {
  return { data: body, error: undefined, response: new Response(null, { status: 200 }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  apiGet.mockResolvedValue(okBody(SPACES))
})

describe('AdminSpacesList', () => {
  it('renders the reference copy and the spaces with member counts', async () => {
    renderWithProviders(<AdminSpacesList />)

    expect(screen.getByRole('heading', { name: 'Пространства' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Новое пространство' })).toBeInTheDocument()
    expect(await screen.findByText('Наша семья')).toBeInTheDocument()
    expect(screen.getByText('4 участника · создано 12 августа')).toBeInTheDocument()
    expect(screen.getByText('Дача')).toBeInTheDocument()
    expect(screen.getByText('0 участников · создано 28 сентября')).toBeInTheDocument()
    expect(screen.getByText('Активное')).toBeInTheDocument()
    expect(screen.getByText('Пустое')).toBeInTheDocument()
    expect(
      screen.getByText('Пространства независимы: участники, коды и данные не пересекаются'),
    ).toBeInTheDocument()
  })

  it('shows the empty state when the server has no spaces', async () => {
    apiGet.mockResolvedValue(okBody([]))
    renderWithProviders(<AdminSpacesList />)

    expect(await screen.findByText('Пространств пока нет')).toBeInTheDocument()
  })

  it('creates a space through the sheet', async () => {
    const user = userEvent.setup()
    apiPost.mockResolvedValue({
      data: SPACES[0],
      error: undefined,
      response: new Response(null, { status: 201 }),
    })
    renderWithProviders(<AdminSpacesList />)

    await screen.findByText('Наша семья')
    await user.click(screen.getByRole('button', { name: 'Новое пространство' }))
    await user.type(screen.getByLabelText('Название'), 'Бабушка и внуки')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/spaces',
      expect.objectContaining({
        body: { name: 'Бабушка и внуки' },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
    expect(await screen.findByText('Пространство создано')).toBeInTheDocument()
  })

  it('demands a name before creating', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpacesList />)

    await screen.findByText('Наша семья')
    await user.click(screen.getByRole('button', { name: 'Новое пространство' }))
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(
      await screen.findByText('Придумайте название — его увидят участники'),
    ).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('translates the invalid_timezone answer into the field error', async () => {
    const user = userEvent.setup()
    apiPost.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'invalid_timezone', message: 'nope' } },
      response: new Response(null, { status: 400 }),
    })
    renderWithProviders(<AdminSpacesList />)

    await screen.findByText('Наша семья')
    await user.click(screen.getByRole('button', { name: 'Новое пространство' }))
    await user.type(screen.getByLabelText('Название'), 'Марс')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(
      await screen.findByText('Такого часового пояса нет — выберите из списка'),
    ).toBeInTheDocument()
  })
})
