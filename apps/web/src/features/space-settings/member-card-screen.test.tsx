import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { MemberCardScreen } from './member-card-screen.tsx'

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
const apiPost = vi.mocked(api.POST)
const apiDelete = vi.mocked(api.DELETE)

const OWNER_ID = '01900000-0000-7000-8000-000000000001'
const DIMA_ID = '01900000-0000-7000-8000-000000000002'

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

const PROFILES = [
  {
    id: OWNER_ID,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner' as const,
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  {
    id: DIMA_ID,
    name: 'Дима',
    role: 'regular' as const,
    createdAt: '2026-08-13T10:00:00.000Z',
  },
]

const CODE = {
  id: '01900000-0000-7000-8000-000000000003',
  memberId: DIMA_ID,
  status: 'issued' as const,
  createdAt: '2026-09-29T10:00:00.000Z',
  expiresAt: '2026-09-30T10:00:00.000Z',
  statusChangedAt: '2026-09-29T10:00:00.000Z',
}

const DEVICES = [
  {
    id: '01900000-0000-7000-8000-000000001001',
    browser: 'Chrome',
    platform: 'iPhone',
    createdAt: '2026-09-27T18:00:00.000Z',
    lastUsedAt: '2026-09-29T09:30:00.000Z',
  },
  {
    id: '01900000-0000-7000-8000-000000001002',
    browser: '',
    platform: 'Android',
    createdAt: '2026-09-28T10:00:00.000Z',
    lastUsedAt: '2026-09-28T20:15:00.000Z',
  },
]

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

function okBody(body: unknown, status = 200) {
  return { data: body, error: undefined, response: new Response(null, { status }) }
}

/** The happy-path GET map: profiles, the member's live code, and devices. */
function mockOwnerApi() {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') return okBody(OWNER_ME)
    if (path === '/api/v1/members') return okBody(PROFILES)
    if (path === '/api/v1/members/{memberId}/access-code') return okBody(CODE)
    if (path === '/api/v1/members/{memberId}/sessions') return okBody(DEVICES)
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

describe('MemberCardScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    seedRegistry()
    mockOwnerApi()
  })

  it('shows the member with their role, code status, and devices', async () => {
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    expect(await screen.findByRole('heading', { name: 'Дима' })).toBeInTheDocument()
    expect(screen.getByText('в пространстве с 13 августа')).toBeInTheDocument()
    expect(screen.getByText('Код входа')).toBeInTheDocument()
    expect(screen.getByText('Ждёт первого входа')).toBeInTheDocument()
    expect(screen.getByText('Chrome на iPhone')).toBeInTheDocument()
    // A device with an unknown browser falls back to its platform alone.
    expect(screen.getByText('Android')).toBeInTheDocument()
  })

  it('issues a code and shows the plaintext once', async () => {
    const user = userEvent.setup()
    apiPost.mockResolvedValue(okBody({ ...CODE, code: 'SASF-KQLV' }, 201))
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    await screen.findByText('Код входа')
    await user.click(screen.getByRole('button', { name: 'Выпустить код' }))
    await user.click(await screen.findByRole('button', { name: 'Выпустить' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/members/{memberId}/access-code',
      expect.objectContaining({ params: { path: { memberId: DIMA_ID } } }),
    )
    expect(await screen.findByText('SASF-KQLV')).toBeInTheDocument()
    expect(screen.getAllByText('SASF-KQLV').length).toBe(1)
  })

  it('shows the no-code row when the member has none', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') return okBody(OWNER_ME)
      if (path === '/api/v1/members') return okBody(PROFILES)
      if (path === '/api/v1/members/{memberId}/access-code') {
        return {
          data: undefined,
          error: undefined,
          response: new Response(null, { status: 404 }),
        }
      }
      if (path === '/api/v1/members/{memberId}/sessions') return okBody([])
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    expect(await screen.findByText('Кода ещё нет')).toBeInTheDocument()
    expect(
      screen.getByText('Сессий нет — участник не входил или устройства отключены'),
    ).toBeInTheDocument()
  })

  it('disconnects every device of the member', async () => {
    const user = userEvent.setup()
    apiDelete.mockResolvedValue({
      data: null,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    await screen.findByText('Chrome на iPhone')
    await user.click(screen.getByRole('button', { name: 'Отключить всё' }))
    await user.click(await screen.findByRole('button', { name: 'Отключить' }))

    expect(apiDelete).toHaveBeenCalledWith(
      '/api/v1/members/{memberId}/sessions',
      expect.objectContaining({ params: { path: { memberId: DIMA_ID } } }),
    )
  })

  it('offers the role change and refuses the doomed demote in the UI', async () => {
    const user = userEvent.setup()
    apiPatchMock()
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    await screen.findByText('Код входа')
    const roleSelect = screen.getByRole('combobox', { name: 'Права в пространстве' })
    // A regular member can be promoted; the option is enabled.
    expect(roleSelect).toHaveValue('regular')
    await user.selectOptions(roleSelect, 'owner')
    expect(await screen.findByText('Дима станет владельцем?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Сделать владельцем' }))
    expect(apiPatch).toHaveBeenCalledWith(
      '/api/v1/members/{memberId}',
      expect.objectContaining({ body: { role: 'owner' } }),
    )
  })

  it('disables the regular option for the last owner', async () => {
    // The card under review is the space's only owner — Аня herself.
    renderWithProviders(<MemberCardScreen memberId={OWNER_ID} />)

    const roleSelect = await screen.findByRole('combobox', { name: 'Права в пространстве' })
    expect(roleSelect).toHaveValue('owner')
    const regularOption = screen.getByRole('option', { name: 'Обычный участник' })
    expect(regularOption).toBeDisabled()
  })

  it('offers revocation on the live code and revokes it through the dialog', async () => {
    const user = userEvent.setup()
    apiDelete.mockResolvedValue({
      data: null,
      error: undefined,
      response: new Response(null, { status: 200 }),
    })
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    await screen.findByText('Код входа')
    expect(screen.getByText('Ждёт первого входа')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Отозвать' }))
    const dialog = await screen.findByRole('dialog', { name: 'Отозвать этот код?' })
    await user.click(within(dialog).getByRole('button', { name: 'Отозвать' }))

    expect(apiDelete).toHaveBeenCalledWith(
      '/api/v1/members/{memberId}/access-code',
      expect.objectContaining({ params: { path: { memberId: DIMA_ID } } }),
    )
  })

  it('signs the device out when the owner disconnects their own devices', async () => {
    const user = userEvent.setup()
    apiDelete.mockResolvedValue({
      data: null,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    // The card under review is the acting owner's own.
    renderWithProviders(<MemberCardScreen memberId={OWNER_ID} />)

    await screen.findByText('Код входа')
    await user.click(screen.getByRole('button', { name: 'Отключить всё' }))
    await user.click(await screen.findByRole('button', { name: 'Отключить' }))

    // The member's local sign-in is forgotten, like a sign-out.
    await vi.waitFor(() => {
      const retained = JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')
      expect(retained).toHaveLength(0)
    })
  })

  it('refreshes the session probe after the member changes their own role', async () => {
    const user = userEvent.setup()
    // Two owners, so the acting owner may demote themselves.
    const twoOwners = [
      ...PROFILES,
      {
        id: '01900000-0000-7000-8000-000000000005',
        name: 'Люда',
        role: 'owner' as const,
        createdAt: '2026-08-14T10:00:00.000Z',
      },
    ]
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') return okBody(OWNER_ME)
      if (path === '/api/v1/members') return okBody(twoOwners)
      if (path === '/api/v1/members/{memberId}/access-code') return okBody(CODE)
      if (path === '/api/v1/members/{memberId}/sessions') return okBody([])
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    apiPatchMock()
    renderWithProviders(<MemberCardScreen memberId={OWNER_ID} />)

    const roleSelect = await screen.findByRole('combobox', { name: 'Права в пространстве' })
    await user.selectOptions(roleSelect, 'regular')
    const dialog = await screen.findByRole('dialog', {
      name: 'Аня Смирнова перестанет быть владельцем?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Сделать обычным' }))

    // The probe (/me) is refetched, so the demoted owner's instruments on
    // screen follow the new role.
    const meCalls = () => apiGet.mock.calls.filter((call) => call[0] === '/api/v1/me').length
    await vi.waitFor(() => expect(meCalls()).toBeGreaterThanOrEqual(2))
  })
})

const apiPatch = vi.mocked(api.PATCH)

function apiPatchMock() {
  apiPatch.mockResolvedValue({
    data: { ...PROFILES[1], role: 'owner' },
    error: undefined,
    response: new Response(null, { status: 200 }),
  })
}
