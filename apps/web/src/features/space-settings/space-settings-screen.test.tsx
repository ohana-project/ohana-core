import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { SpaceSettingsScreen } from './space-settings-screen.tsx'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
  Link: (props: { to: string; children?: React.ReactNode; 'aria-label'?: string }) => (
    <a href={props.to} aria-label={props['aria-label']}>
      {props.children}
    </a>
  ),
  Navigate: ({ to }: { to: string }) => <a href={to}>redirected to {to}</a>,
}))

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

const apiGet = vi.mocked(api.GET)
const apiPatch = vi.mocked(api.PATCH)

const OWNER_ID = '01900000-0000-7000-8000-000000000001'

const OWNER_ME = {
  member: {
    id: OWNER_ID,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner' as const,
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
  needsOnboarding: false,
}

const REGULAR_ME = { ...OWNER_ME, member: { ...OWNER_ME.member, role: 'regular' as const } }

const SPACE = {
  id: '01900000-0000-7000-8000-00000000000a',
  name: 'Наша семья',
  timezone: 'Europe/Moscow',
  sections: { journal: true, calendar: true, wishlist: true },
}

function seedRegistry() {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: OWNER_ID,
        spaceId: OWNER_ME.space.id,
        spaceName: OWNER_ME.space.name,
        name: 'Аня',
        displayName: 'Аня Смирнова',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', OWNER_ID)
}

function mockOwnerApi() {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') {
      return { data: OWNER_ME, error: undefined, response: new Response(null, { status: 200 }) }
    }
    if (path === '/api/v1/space') {
      return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

describe('SpaceSettingsScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    seedRegistry()
    mockOwnerApi()
  })

  it('shows the space with its current default time zone', async () => {
    renderWithProviders(<SpaceSettingsScreen />)

    expect(
      await screen.findByRole('heading', { name: 'Настройки пространства' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('«Наша семья» · доступно только владельцу')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'По умолчанию для новых событий' })).toHaveValue(
      'Europe/Moscow',
    )
  })

  it('saves only a changed time zone', async () => {
    const user = userEvent.setup()
    apiPatch.mockResolvedValue({
      data: { ...SPACE, timezone: 'Asia/Novosibirsk' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    })
    renderWithProviders(<SpaceSettingsScreen />)

    const select = await screen.findByRole('combobox', { name: 'По умолчанию для новых событий' })
    // Unchanged: the save button stays disabled and sends nothing.
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()

    await user.selectOptions(select, 'Asia/Novosibirsk')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(apiPatch).toHaveBeenCalledWith(
      '/api/v1/space',
      expect.objectContaining({ body: { timezone: 'Asia/Novosibirsk' } }),
    )
  })

  it('sends a regular member home', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: REGULAR_ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<SpaceSettingsScreen />)

    expect(await screen.findByText('redirected to /')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  })

  it('shows the section switches with the visibility from the space', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: OWNER_ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/space') {
        return {
          data: { ...SPACE, sections: { journal: false, calendar: true, wishlist: true } },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<SpaceSettingsScreen />)

    expect(await screen.findByRole('switch', { name: 'Показывать Дневник' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Показывать Календарь' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Показывать Вишлисты' })).toBeChecked()
    // The hidden section says so, and that its data is kept.
    expect(screen.getByText('скрыт для всех — данные сохранены')).toBeInTheDocument()
    expect(screen.getByText('события и напоминания')).toBeInTheDocument()
  })

  it('hides a section with its switch and confirms it', async () => {
    const user = userEvent.setup()
    apiPatch.mockResolvedValue({
      data: { ...SPACE, sections: { journal: false, calendar: true, wishlist: true } },
      error: undefined,
      response: new Response(null, { status: 200 }),
    })
    renderWithProviders(<SpaceSettingsScreen />)

    const journalSwitch = await screen.findByRole('switch', { name: 'Показывать Дневник' })
    await user.click(journalSwitch)

    await vi.waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        '/api/v1/space',
        expect.objectContaining({ body: { sections: { journal: false } } }),
      ),
    )
    expect(await screen.findByText('Раздел скрыт — ничего не удалено')).toBeInTheDocument()
    // The switch keeps the attempted state while the change is in flight.
    expect(screen.getByRole('switch', { name: 'Показывать Дневник' })).not.toBeChecked()
  })

  it('reverts the switch and explains itself when hiding fails', async () => {
    const user = userEvent.setup()
    apiPatch.mockRejectedValue(new TypeError('Network unreachable'))
    renderWithProviders(<SpaceSettingsScreen />)

    const journalSwitch = await screen.findByRole('switch', { name: 'Показывать Дневник' })
    await user.click(journalSwitch)

    expect(
      await screen.findByText('Не получилось — проверьте сеть и попробуйте ещё раз.'),
    ).toBeInTheDocument()
    // The refused toggle returns to the server's state.
    await vi.waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Показывать Дневник' })).toBeChecked(),
    )
  })
})
