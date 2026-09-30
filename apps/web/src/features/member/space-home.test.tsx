import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { SpaceHomeScreen } from './space-home.tsx'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
}))

const apiGet = vi.mocked(api.GET)
const apiDelete = vi.mocked(api.DELETE)

const ME = {
  member: {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner' as const,
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
  needsOnboarding: false,
}

function seedRegistry() {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: ME.member.id,
        spaceId: ME.space.id,
        spaceName: ME.space.name,
        name: ME.member.name,
        displayName: ME.member.displayName,
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', ME.member.id)
}

describe('SpaceHomeScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/members') {
        return { data: [], error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
  })

  it('greets the member by their display name and lists the sections', async () => {
    seedRegistry()
    renderWithProviders(<SpaceHomeScreen />)

    expect(await screen.findByRole('heading', { name: /Аня Смирнова/ })).toBeInTheDocument()
    // Both shells render in jsdom (no active media query), so the section
    // navigation exists twice: the desktop sidebar and the mobile tab bar.
    expect(screen.getAllByRole('navigation', { name: 'Разделы' }).length).toBeGreaterThan(0)
    for (const section of ['Главная', 'Дневник', 'Календарь', 'Вишлисты']) {
      expect(screen.getAllByRole('button', { name: section }).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('Свежее в дневнике')).toBeInTheDocument()
    expect(screen.getByText('Ближайшие события')).toBeInTheDocument()
    expect(screen.getByText('Участники')).toBeInTheDocument()
  })

  it('signs out through the user menu and forgets the registry entry', async () => {
    seedRegistry()
    apiDelete.mockResolvedValue({
      data: ME.member.id,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    const user = userEvent.setup()
    renderWithProviders(<SpaceHomeScreen />)

    await screen.findByRole('heading', { name: /Аня Смирнова/ })
    // Both probes settle before the menu opens, so no re-render replaces
    // the trigger under the pointer mid-interaction.
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Меню пользователя' }))
    // The menu mounts into a portal; under jsdom it can land outside the
    // a11y tree, so the item is clicked by its text.
    await user.click(await screen.findByText('Выйти'))

    expect(apiDelete).toHaveBeenCalledWith(
      '/api/v1/me/session',
      expect.objectContaining({
        params: { header: { 'x-ohana-member': ME.member.id } },
      }),
    )
    await vi.waitFor(() => expect(window.localStorage.getItem('ohana.activeMember')).toBeNull())
    expect(JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')).toEqual([])
  })

  it('keeps the sign-in and explains itself when sign-out fails', async () => {
    seedRegistry()
    apiDelete.mockRejectedValue(new TypeError('Network unreachable'))
    const user = userEvent.setup()
    renderWithProviders(<SpaceHomeScreen />)

    await screen.findByRole('heading', { name: /Аня Смирнова/ })
    // Both probes settle before the menu opens, so no re-render replaces
    // the trigger under the pointer mid-interaction.
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Меню пользователя' }))
    await user.click(await screen.findByText('Выйти'))

    expect(
      await screen.findByText('Не получилось выйти — проверьте сеть и попробуйте ещё раз.'),
    ).toBeInTheDocument()
    // The failed sign-out keeps the registry entry for a retry.
    expect(window.localStorage.getItem('ohana.activeMember')).toBe(ME.member.id)
  })
})
