import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { MembersScreen } from './members-screen.tsx'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
  Link: (props: { to: string; children?: React.ReactNode; 'aria-label'?: string }) => (
    <a href={props.to} aria-label={props['aria-label']}>
      {props.children}
    </a>
  ),
}))

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

const apiGet = vi.mocked(api.GET)

const OWNER = {
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Аня',
  displayName: 'Аня Смирнова',
  role: 'owner' as const,
  createdAt: '2026-08-12T10:00:00.000Z',
}

type Me = {
  member: {
    id: string
    name: string
    role: 'owner' | 'regular'
    createdAt: string
  }
  space: { id: string; name: string }
  needsOnboarding: boolean
}

const REGULAR_ME: Me = {
  member: { id: OWNER.id, name: 'Аня', role: 'regular', createdAt: OWNER.createdAt },
  space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
  needsOnboarding: false,
}

const OWNER_ME: Me = { ...REGULAR_ME, member: { ...REGULAR_ME.member, role: 'owner' } }

const PROFILES = [
  {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner' as const,
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  {
    id: '01900000-0000-7000-8000-000000000002',
    name: 'Дима',
    email: 'dima@example.com',
    role: 'regular' as const,
    createdAt: '2026-08-13T10:00:00.000Z',
  },
]

function seedRegistry() {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: REGULAR_ME.member.id,
        spaceId: REGULAR_ME.space.id,
        spaceName: REGULAR_ME.space.name,
        name: OWNER.name,
        displayName: OWNER.displayName,
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', REGULAR_ME.member.id)
}

function mockMe(me: Me) {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') {
      return { data: me, error: undefined, response: new Response(null, { status: 200 }) }
    }
    if (path === '/api/v1/members') {
      return { data: PROFILES, error: undefined, response: new Response(null, { status: 200 }) }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

describe('MembersScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    seedRegistry()
  })

  it('lists the members with their roles and marks the signed-in one', async () => {
    mockMe(OWNER_ME)
    renderWithProviders(<MembersScreen />)

    expect(await screen.findByRole('heading', { name: 'Участники' })).toBeInTheDocument()
    // The profiles list lands with its query.
    await screen.findByText('Дима')
    // The title is a text node with the display name and, for the signed-in
    // member, a separate "· вы" marker beside it.
    expect(screen.getByText('Аня Смирнова')).toBeInTheDocument()
    expect(screen.getByText('· вы')).toBeInTheDocument()
    expect(screen.getByText('dima@example.com')).toBeInTheDocument()
    // Both pills carry their role; the owner pill appears once.
    expect(screen.getAllByText('Владелец').length).toBeGreaterThan(0)
    expect(screen.getByText('Обычный участник')).toBeInTheDocument()
  })

  it('shows the invite action to an owner only', async () => {
    mockMe(OWNER_ME)
    renderWithProviders(<MembersScreen />)
    expect(await screen.findByRole('link', { name: /Пригласить/ })).toBeInTheDocument()
  })

  it('hides the invite action from a regular member', async () => {
    mockMe(REGULAR_ME)
    renderWithProviders(<MembersScreen />)
    await screen.findByText('Дима')
    expect(screen.queryByRole('link', { name: /Пригласить/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Роль владельца можно передать')).not.toBeInTheDocument()
  })

  it('opens a member card from a row', async () => {
    mockMe(OWNER_ME)
    renderWithProviders(<MembersScreen />)

    const row = await screen.findByRole('link', { name: 'Открыть карточку: Дима' })
    expect(row).toHaveAttribute('href', '/members/$memberId')
  })
})
