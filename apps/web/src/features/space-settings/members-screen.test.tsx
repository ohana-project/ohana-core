import { screen, within } from '@testing-library/react'
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
    // The pill marks the owner's row only (issue #76).
    expect(screen.getAllByText('Владелец').length).toBeGreaterThan(0)
    expect(screen.queryByText('Обычный участник')).not.toBeInTheDocument()
  })

  it('shows the invite action to an owner only', async () => {
    mockMe(OWNER_ME)
    renderWithProviders(<MembersScreen />)
    // The header's button and the desktop top bar's — one visible per
    // viewport, both mounted.
    expect((await screen.findAllByRole('link', { name: /Пригласить/ })).length).toBe(2)
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

describe('MembersScreen — design parity (issue #76)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    seedRegistry()
  })

  it('heads the active list «Активные» and counts the members in the subtitle', async () => {
    mockMe(OWNER_ME)
    renderWithProviders(<MembersScreen />)

    expect(await screen.findByRole('heading', { name: 'Активные' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Участники' })).toBeInTheDocument()
    // The prototype's subtitle: «Наша семья» · 4 активных, 1 в архиве —
    // with real data, and no archive part while nobody is archived.
    expect(screen.getByText('«Наша семья» · 2 активных')).toBeInTheDocument()
  })

  it('counts the archived members in the subtitle and lists them under «Архив»', async () => {
    mockMe(OWNER_ME)
    const archivedProfiles = [
      ...PROFILES,
      {
        id: '01900000-0000-7000-8000-000000000004',
        name: 'Пётр',
        role: 'regular' as const,
        createdAt: '2026-08-14T10:00:00.000Z',
        archivedAt: '2026-09-03T10:00:00.000Z',
      },
    ]
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: OWNER_ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/members') {
        return {
          data: archivedProfiles,
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<MembersScreen />)

    expect(await screen.findByText('«Наша семья» · 2 активных, 1 в архиве')).toBeInTheDocument()
    // The archived row says the member is archived and the entries are kept.
    expect(screen.getByText('в архиве с 3 сентября · записи сохранены')).toBeInTheDocument()
  })

  it('gives a pill to the owner row only, at 40px avatars', async () => {
    mockMe(OWNER_ME)
    renderWithProviders(<MembersScreen />)

    await screen.findByText('Дима')
    // The row is the card link; its anchor carries the whole row.
    const dimaRow = screen.getByRole('link', { name: 'Открыть карточку: Дима' })
    // A regular member's row carries no pill — only the 18px chevron.
    expect(within(dimaRow).queryByText('Обычный участник')).not.toBeInTheDocument()
    expect(within(dimaRow).queryByText('Владелец')).not.toBeInTheDocument()
    // The avatar is the default 40px size.
    const avatar = within(dimaRow).getByText('Д').closest('[data-slot="avatar"]')
    expect(avatar).toHaveAttribute('data-size', 'default')
    // The owner's row keeps the pill.
    expect(screen.getAllByText('Владелец').length).toBeGreaterThan(0)
  })

  it('carries the invite in the header and the desktop top bar for an owner', async () => {
    mockMe(OWNER_ME)
    renderWithProviders(<MembersScreen />)
    // One visible per viewport: the header's below 920px, the top bar's
    // from 920px up — both mounted, so two links render in jsdom.
    expect((await screen.findAllByRole('link', { name: 'Пригласить' })).length).toBe(2)
  })
})

describe('MembersScreen — the archive (issue #23)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    seedRegistry()
  })

  it('lists the archived members separately, with the archive pill and the hint', async () => {
    mockMe(OWNER_ME)
    const archivedProfiles = [
      ...PROFILES,
      {
        id: '01900000-0000-7000-8000-000000000004',
        name: 'Пётр',
        role: 'regular' as const,
        createdAt: '2026-08-14T10:00:00.000Z',
        archivedAt: '2026-09-03T10:00:00.000Z',
      },
    ]
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: OWNER_ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/members') {
        return {
          data: archivedProfiles,
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<MembersScreen />)

    // The archived member does not sit in the active list: their pill is
    // the archive one, and their row sits under the archive heading.
    expect(await screen.findByRole('heading', { name: 'Участники' })).toBeInTheDocument()
    const archiveSection = screen.getByRole('heading', { name: 'Архив' }).closest('section')
    if (archiveSection === null) throw new Error('No archive section rendered')
    expect(archiveSection).toBeInTheDocument()
    expect(within(archiveSection).getByText('Пётр')).toBeInTheDocument()
    expect(within(archiveSection).getAllByText('Архив').length).toBeGreaterThan(0)
    expect(
      within(archiveSection).getByText('в архиве с 3 сентября · записи сохранены'),
    ).toBeInTheDocument()
    expect(
      within(archiveSection).getByText(
        'Архивный не входит в пространство: дневник, события и вишлист остаются, но скрываются из списков',
      ),
    ).toBeInTheDocument()
    // The active list keeps Дима; Пётр is not in it.
    const activeCard = screen.getByText('Дима').closest('[data-slot="card"]')
    expect(activeCard).not.toBe(archiveSection)
  })
})
