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
    // The reissue row's small secondary button opens the dialog.
    await user.click(screen.getByRole('button', { name: 'Выпустить' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Выпустить' }))

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
    // The empty device state is a single row (issue #76).
    expect(screen.getByText('Устройств нет')).toBeInTheDocument()
    expect(screen.getByText('Участник войдёт заново по новому коду')).toBeInTheDocument()
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
    // Every refetch after the disconnect answers 401 for the dead session;
    // the cleanup must not depend on the screen staying mounted.
    let dead = false
    const gone = {
      data: undefined,
      error: { error: { code: 'unauthorized', message: 'gone' } },
      response: new Response(null, { status: 401 }),
    }
    apiDelete.mockImplementation(async () => {
      dead = true
      return { data: null, error: undefined, response: new Response(null, { status: 204 }) }
    })
    apiGet.mockImplementation(async (path: never) => {
      if (dead) return gone
      if (path === '/api/v1/me') return okBody(OWNER_ME)
      if (path === '/api/v1/members') return okBody(PROFILES)
      if (path === '/api/v1/members/{memberId}/access-code') return okBody(CODE)
      if (path === '/api/v1/members/{memberId}/sessions') return okBody(DEVICES)
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    // The card under review is the acting owner's own.
    renderWithProviders(<MemberCardScreen memberId={OWNER_ID} />)

    await screen.findByText('Код входа')
    const getsBeforeDisconnect = apiGet.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Отключить всё' }))
    await user.click(await screen.findByRole('button', { name: 'Отключить' }))

    // The member's local sign-in is forgotten, like a sign-out, even though
    // every query the invalidation triggers now answers 401.
    await vi.waitFor(() => {
      const retained = JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')
      expect(retained).toHaveLength(0)
    })
    // And nothing refetches as the forgotten member: the dead guard would
    // send the subtree's queries out under their pinned header. The
    // forgotten member's owner sections unmount with the dialog (the probe
    // goes pending), and the hook's onSettled has run by then — a stale
    // invalidation would already have fetched.
    await vi.waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Отключить все устройства?' }),
      ).not.toBeInTheDocument()
    })
    expect(apiGet.mock.calls.length).toBe(getsBeforeDisconnect)
  })

  it('promotes the other retained sign-in and never refetches as the forgotten one', async () => {
    const user = userEvent.setup()
    const OTHER_ID = '01900000-0000-7000-8000-000000000006'
    const OTHER_ME = {
      member: {
        id: OTHER_ID,
        name: 'Паша',
        role: 'regular' as const,
        createdAt: '2026-08-15T10:00:00.000Z',
      },
      space: OWNER_ME.space,
      needsOnboarding: false,
    }
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
        {
          memberId: OTHER_ID,
          spaceId: OWNER_ME.space.id,
          spaceName: OWNER_ME.space.name,
          name: 'Паша',
        },
      ]),
    )
    window.localStorage.setItem('ohana.activeMember', OWNER_ID)
    let dead = false
    // The member-scoped requests name their member in the pinned header, so
    // a fetch for the forgotten one is recognisable even as the promoted
    // member's own requests keep flowing.
    const deadHeaderFetches: string[] = []
    const signedOut = {
      data: undefined,
      error: { error: { code: 'unauthorized', message: 'gone' } },
      response: new Response(null, { status: 401 }),
    }
    apiDelete.mockImplementation(async () => {
      dead = true
      return { data: null, error: undefined, response: new Response(null, { status: 204 }) }
    })
    apiGet.mockImplementation(
      async (path: never, options?: { params?: { header?: { 'x-ohana-member'?: string } } }) => {
        if (dead && options?.params?.header?.['x-ohana-member'] === OWNER_ID) {
          deadHeaderFetches.push(path)
          return signedOut
        }
        if (path === '/api/v1/me') return okBody(dead ? OTHER_ME : OWNER_ME)
        if (path === '/api/v1/members') return okBody(PROFILES)
        if (path === '/api/v1/members/{memberId}/access-code') return okBody(CODE)
        if (path === '/api/v1/members/{memberId}/sessions') return okBody(DEVICES)
        throw new Error(`Unexpected GET ${String(path)}`)
      },
    )
    renderWithProviders(<MemberCardScreen memberId={OWNER_ID} />)

    await screen.findByText('Код входа')
    await user.click(screen.getByRole('button', { name: 'Отключить всё' }))
    await user.click(await screen.findByRole('button', { name: 'Отключить' }))

    // Аня's sign-in goes, Паша's stays and becomes the active one.
    await vi.waitFor(() => {
      const retained = JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')
      expect(retained.map((session: { memberId: string }) => session.memberId)).toEqual([OTHER_ID])
    })
    expect(window.localStorage.getItem('ohana.activeMember')).toBe(OTHER_ID)
    // The promoted member is regular: the read-only view of Аня's card is
    // the cleanup's last word, re-rendered after the probe answers.
    await vi.waitFor(() => {
      expect(
        screen.queryByRole('combobox', { name: 'Права в пространстве' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('Владелец')).toBeInTheDocument()
    })
    // The subtree of the forgotten member is never refetched under their
    // pinned header.
    expect(deadHeaderFetches).toEqual([])
  })

  it('closes the revoke dialog on a refusal and keeps it on a lost network', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    await screen.findByText('Код входа')
    await user.click(screen.getByRole('button', { name: 'Отозвать' }))
    const dialog = await screen.findByRole('dialog', { name: 'Отозвать этот код?' })

    // A lost network is not a spent action: the dialog stays for the retry,
    // and the failure reaches the surface as a danger toast.
    apiDelete.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(within(dialog).getByRole('button', { name: 'Отозвать' }))
    expect(
      await screen.findByText('Не получилось — проверьте сеть и попробуйте ещё раз.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Отозвать этот код?' })).toBeInTheDocument()

    // The API's own server fault is just as retryable.
    apiDelete.mockResolvedValueOnce({
      data: undefined,
      error: { error: { code: 'internal_error', message: 'boom' } },
      response: new Response(null, { status: 500 }),
    })
    await user.click(within(dialog).getByRole('button', { name: 'Отозвать' }))
    await vi.waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('dialog', { name: 'Отозвать этот код?' })).toBeInTheDocument()

    // A refusal — the code was redeemed meanwhile — is spent: the dialog
    // steps aside for the refreshed row.
    apiDelete.mockResolvedValueOnce({
      data: undefined,
      error: { error: { code: 'access_code_not_found', message: 'no live code' } },
      response: new Response(null, { status: 404 }),
    })
    await user.click(within(dialog).getByRole('button', { name: 'Отозвать' }))
    await vi.waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Отозвать этот код?' })).not.toBeInTheDocument()
    })

    // Any other refusal — the member is gone from the space — is just as
    // spent, though it names no access code.
    await user.click(screen.getByRole('button', { name: 'Отозвать' }))
    const reopened = await screen.findByRole('dialog', { name: 'Отозвать этот код?' })
    apiDelete.mockResolvedValueOnce({
      data: undefined,
      error: { error: { code: 'member_not_found', message: 'gone' } },
      response: new Response(null, { status: 404 }),
    })
    await user.click(within(reopened).getByRole('button', { name: 'Отозвать' }))
    await vi.waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(4))
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Отозвать этот код?' })).not.toBeInTheDocument()
    })
  })

  it('follows the member to the read-only view after they demote themselves', async () => {
    const user = userEvent.setup()
    // Two owners, so the acting owner may demote themselves; after the
    // change the server answers as the regular member they now are.
    const twoOwners = [
      ...PROFILES,
      {
        id: '01900000-0000-7000-8000-000000000005',
        name: 'Люда',
        role: 'owner' as const,
        createdAt: '2026-08-14T10:00:00.000Z',
      },
    ]
    let demoted = false
    const regularMe = { ...OWNER_ME, member: { ...OWNER_ME.member, role: 'regular' as const } }
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') return okBody(demoted ? regularMe : OWNER_ME)
      if (path === '/api/v1/members') {
        return okBody(
          demoted
            ? twoOwners.map((member) =>
                member.id === OWNER_ID ? { ...member, role: 'regular' as const } : member,
              )
            : twoOwners,
        )
      }
      if (path === '/api/v1/members/{memberId}/access-code') {
        if (demoted) return unauthorized()
        return okBody(CODE)
      }
      if (path === '/api/v1/members/{memberId}/sessions') {
        if (demoted) return unauthorized()
        return okBody([])
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    apiPatch.mockImplementation(async () => {
      demoted = true
      return {
        data: { ...PROFILES[0], role: 'regular' },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    })
    renderWithProviders(<MemberCardScreen memberId={OWNER_ID} />)

    const roleSelect = await screen.findByRole('combobox', { name: 'Права в пространстве' })
    await user.selectOptions(roleSelect, 'regular')
    const dialog = await screen.findByRole('dialog', {
      name: 'Аня Смирнова перестанет быть владельцем?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Сделать обычным' }))

    // The refreshed probe carries the regular role: the owner instruments
    // leave the screen, and the read-only pill is all that remains.
    await vi.waitFor(() => {
      expect(
        screen.queryByRole('combobox', { name: 'Права в пространстве' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Выпустить' })).not.toBeInTheDocument()
    expect(screen.getByText('Обычный участник')).toBeInTheDocument()
  })
})

function unauthorized() {
  return {
    data: undefined,
    error: { error: { code: 'owner_required', message: 'owners only' } },
    response: new Response(null, { status: 403 }),
  }
}

const apiPatch = vi.mocked(api.PATCH)

function apiPatchMock() {
  apiPatch.mockResolvedValue({
    data: { ...PROFILES[1], role: 'owner' },
    error: undefined,
    response: new Response(null, { status: 200 }),
  })
}

describe('MemberCardScreen — design parity (issue #76)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    seedRegistry()
    mockOwnerApi()
  })

  it('is titled «Участник» in the top bar and backs to the members list', async () => {
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    expect(await screen.findByRole('heading', { name: 'Дима' })).toBeInTheDocument()
    // The top bar carries the area's name, not the member's (the h1 keeps it).
    expect(screen.getByText('Участник')).toBeInTheDocument()
    const back = screen.getByRole('link', { name: 'Назад' })
    expect(back).toHaveAttribute('href', '/members')
  })

  it('carries the reissue row with its small secondary button', async () => {
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    await screen.findByText('Код входа')
    expect(screen.getByText('Перевыпустить код')).toBeInTheDocument()
    expect(screen.getByText('понадобится, если участник потеряет доступ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выпустить' })).toBeInTheDocument()
  })

  it('marks the current device with the ok pill and puts the disconnect in the row', async () => {
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    const currentRow = await screen.findByText('Chrome на iPhone').then((row) => {
      const item = row.closest<HTMLElement>('[data-slot="item"]')
      if (item === null) throw new Error('No Chrome row rendered')
      return item
    })
    // The most recently used device is the member's current one.
    expect(within(currentRow).getByText('Текущее')).toBeInTheDocument()
    expect(
      within(currentRow).queryByRole('button', { name: 'Отключить всё' }),
    ).not.toBeInTheDocument()

    const otherRow = screen.getByText('Android').closest<HTMLElement>('[data-slot="item"]')
    if (otherRow === null) throw new Error('No Android row rendered')
    expect(within(otherRow).getByRole('button', { name: 'Отключить всё' })).toBeInTheDocument()
  })

  it('shows the empty device state as a single row', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') return okBody(OWNER_ME)
      if (path === '/api/v1/members') return okBody(PROFILES)
      if (path === '/api/v1/members/{memberId}/access-code') return okBody(CODE)
      if (path === '/api/v1/members/{memberId}/sessions') return okBody([])
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    expect(await screen.findByText('Устройств нет')).toBeInTheDocument()
    expect(screen.getByText('Участник войдёт заново по новому коду')).toBeInTheDocument()
  })
})

describe('MemberCardScreen — the archive (issue #23)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    seedRegistry()
    mockOwnerApi()
  })

  it('archives the member from their card after the confirmation', async () => {
    const user = userEvent.setup()
    apiPost.mockResolvedValue(okBody(PROFILES[1], 200))
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    await screen.findByRole('heading', { name: 'Дима' })
    // The whole danger row is the action (issue #76).
    await user.click(screen.getByRole('button', { name: /Архивировать Дима/ }))

    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Архивировать' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/members/{memberId}/archive',
      expect.objectContaining({ params: { path: { memberId: DIMA_ID } } }),
    )
  })

  it('shows the archived card with what stays and what hides, and restores through a new code', async () => {
    const user = userEvent.setup()
    const archivedProfiles = [
      PROFILES[0],
      {
        ...PROFILES[1],
        archivedAt: '2026-09-03T10:00:00.000Z',
      },
    ]
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') return okBody(OWNER_ME)
      if (path === '/api/v1/members') return okBody(archivedProfiles)
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    apiPost.mockResolvedValue(okBody({ ...CODE, code: 'SASF-KQLV', status: 'issued' }, 201))
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    expect(await screen.findByRole('heading', { name: 'Дима' })).toBeInTheDocument()
    expect(screen.getByText('в архиве с 3 сентября')).toBeInTheDocument()
    expect(
      screen.getByText('Осталось: записи в дневнике, события, вишлист и фото'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Скрыто: участник не входит в пространство, его нет в списках и получателях событий',
      ),
    ).toBeInTheDocument()
    // The owner instruments are replaced by the archive state.
    expect(screen.queryByText('Код входа')).not.toBeInTheDocument()

    // The restore is the code issuance: the new code is the way back in.
    await user.click(screen.getByRole('button', { name: 'Восстановить участника' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Восстановить' }))
    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/members/{memberId}/access-code',
      expect.objectContaining({ params: { path: { memberId: DIMA_ID } } }),
    )
    expect(await screen.findByText('SASF-KQLV')).toBeInTheDocument()
  })

  it('says the restore is no longer available once the private state is purged', async () => {
    const archivedProfiles = [
      PROFILES[0],
      {
        ...PROFILES[1],
        archivedAt: '2026-09-03T10:00:00.000Z',
        privateStatePurgedAt: '2026-10-03T10:00:00.000Z',
      },
    ]
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') return okBody(OWNER_ME)
      if (path === '/api/v1/members') return okBody(archivedProfiles)
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<MemberCardScreen memberId={DIMA_ID} />)

    expect(
      await screen.findByText('Личные данные участника удалены — восстановление недоступно'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Восстановить участника' })).not.toBeInTheDocument()
  })
})
