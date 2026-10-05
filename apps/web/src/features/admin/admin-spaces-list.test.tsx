import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminSpacesList } from './admin-spaces-list.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <a href="/admin" className={className}>
      {children}
    </a>
  ),
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

// The list answers for the spaces and the installation settings (the
// header's trash retention, issue #79). A test that needs the settings
// to fail holds its own mock, as the failing-settings test does.
function mockRoutes({
  spaces = SPACES,
  settings = { trashRetentionDays: 30 },
}: {
  spaces?: typeof SPACES
  settings?: { trashRetentionDays: number }
} = {}) {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/admin/settings') return okBody(settings)
    if (path === '/api/v1/spaces') return okBody(spaces)
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRoutes()
})

describe('AdminSpacesList', () => {
  it('renders the reference copy and the spaces with member counts', async () => {
    renderWithProviders(<AdminSpacesList />)

    expect(screen.getByRole('heading', { name: 'Пространства' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Новое пространство' })).toBeInTheDocument()
    expect(
      await screen.findByText('2 пространства · хранение корзины: 30 дней'),
    ).toBeInTheDocument()
    expect(screen.getByText('Наша семья')).toBeInTheDocument()
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
    mockRoutes({ spaces: [] })
    renderWithProviders(<AdminSpacesList />)

    expect(await screen.findByText('Пространств пока нет')).toBeInTheDocument()
  })

  it('keeps the count alone when the settings query fails', async () => {
    // The settings answer is held back until the spaces row has rendered,
    // so the assertions below run strictly after the 500 settles.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/admin/settings') {
        await held
        return {
          data: undefined,
          error: { error: { code: 'unexpected', message: 'no settings' } },
          response: new Response(null, { status: 500 }),
        }
      }
      if (path === '/api/v1/spaces') return okBody(SPACES)
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<AdminSpacesList />)

    expect(await screen.findByText('2 пространства')).toBeInTheDocument()
    release()
    await waitFor(() => expect(apiGet.mock.settledResults).toHaveLength(2))
    expect(screen.getByText('2 пространства')).toBeInTheDocument()
    expect(screen.queryByText(/хранение корзины/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Наша семья/ })).toBeInTheDocument()
  })

  it('centres the header’s title and action on one row', async () => {
    renderWithProviders(<AdminSpacesList />)

    await screen.findByText('Наша семья')
    const header = screen.getByRole('heading', { name: 'Пространства' }).closest('header')
    expect(header).toHaveClass('items-center')
  })

  it('opens the new-space action with the bar’s 18px plus', async () => {
    renderWithProviders(<AdminSpacesList />)

    await screen.findByText('Наша семья')
    // The container owns the icon size (18px), the icon passes unsized.
    expect(screen.getByRole('button', { name: 'Новое пространство' })).toHaveClass(
      "[&_svg:not([class*='size-'])]:size-[18px]",
    )
  })

  it('lays the spaces out as flush 68px rows of a list card', async () => {
    renderWithProviders(<AdminSpacesList />)

    const row = await screen.findByRole('link', { name: /Наша семья/ })
    expect(row).toHaveClass('min-h-17')
    const card = row.closest('[data-slot=card]')
    expect(card).toHaveAttribute('data-variant', 'list')
  })

  it('leads each row with the space’s 40px monogram', async () => {
    renderWithProviders(<AdminSpacesList />)

    const row = await screen.findByRole('link', { name: /Наша семья/ })
    expect(row.querySelector('[data-slot=avatar]')).toHaveClass('size-10')
  })

  it('closes each row with the 18px chevron', async () => {
    renderWithProviders(<AdminSpacesList />)

    const row = await screen.findByRole('link', { name: /Наша семья/ })
    const actions = row.querySelector('[data-slot=item-actions]')
    expect(actions).toHaveClass("[&>svg:not([class*='size-'])]:size-[18px]")
  })

  it('stands the empty state on its own with the 28px plate icon', async () => {
    mockRoutes({ spaces: [] })
    renderWithProviders(<AdminSpacesList />)

    const title = await screen.findByText('Пространств пока нет')
    // No card wraps the empty state (README "Implementation").
    expect(title.closest('[data-slot=card]')).toBeNull()
    const plate = title.closest('[data-slot=empty]')?.querySelector('[data-slot=empty-icon]')
    expect(plate).toHaveClass('size-16')
    // The plate owns the 28px icon through its container rule.
    expect(plate).toHaveClass("[&>svg:not([class*='size-'])]:size-7")
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

  it('opens the create sheet without a close X — Esc and the scrim close it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpacesList />)

    await screen.findByText('Наша семья')
    await user.click(screen.getByRole('button', { name: 'Новое пространство' }))

    const sheet = screen.getByRole('dialog')
    expect(sheet.querySelector('[data-slot=sheet-close]')).toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Создать' })).toBeInTheDocument()
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

  it('forgets abandoned edits when the create sheet reopens', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpacesList />)

    await screen.findByText('Наша семья')
    await user.click(screen.getByRole('button', { name: 'Новое пространство' }))
    await user.type(screen.getByLabelText('Название'), 'Черновик')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Новое пространство' }))

    expect(screen.getByLabelText('Название')).toHaveValue('')
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
