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
})
