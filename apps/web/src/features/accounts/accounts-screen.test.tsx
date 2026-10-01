import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { AccountsScreen } from './accounts-screen.tsx'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
  Link: (props: { to: string; children?: React.ReactNode; 'aria-label'?: string }) => (
    <a href={props.to} aria-label={props['aria-label']}>
      {props.children}
    </a>
  ),
}))

const apiGet = vi.mocked(api.GET)
const apiDelete = vi.mocked(api.DELETE)

const FAMILY_ANYA = {
  memberId: '01900000-0000-7000-8000-000000000001',
  spaceId: '01900000-0000-7000-8000-00000000000a',
  spaceName: 'Наша семья',
  name: 'Аня',
  displayName: 'Аня Смирнова',
}

const DACHA_ANYA = {
  memberId: '01900000-0000-7000-8000-000000000002',
  spaceId: '01900000-0000-7000-8000-00000000000b',
  spaceName: 'Аня и родители',
  name: 'Аня',
}

const SERVER_SESSIONS = [
  {
    id: '01900000-0000-7000-8000-000000001001',
    browser: 'Chrome',
    platform: 'Windows',
    createdAt: '2026-09-28T10:00:00.000Z',
    lastUsedAt: '2026-09-29T09:30:00.000Z',
    current: true,
  },
  {
    id: '01900000-0000-7000-8000-000000001002',
    browser: 'Safari',
    platform: 'iPhone',
    createdAt: '2026-09-27T18:00:00.000Z',
    lastUsedAt: '2026-09-28T20:15:00.000Z',
    current: false,
  },
]

function seedRegistry() {
  window.localStorage.setItem('ohana.sessions', JSON.stringify([FAMILY_ANYA, DACHA_ANYA]))
  window.localStorage.setItem('ohana.activeMember', FAMILY_ANYA.memberId)
}

function mockSessions(sessions: typeof SERVER_SESSIONS = SERVER_SESSIONS) {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/me/sessions') {
      return { data: sessions, error: undefined, response: new Response(null, { status: 200 }) }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

describe('AccountsScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    mockSessions()
  })

  it('lists the retained sign-ins and marks the active one', async () => {
    seedRegistry()
    renderWithProviders(<AccountsScreen />)

    expect(screen.getByRole('heading', { name: 'Пространства' })).toBeInTheDocument()
    expect(screen.getByText('Аня Смирнова')).toBeInTheDocument()
    expect(screen.getByText('Наша семья')).toBeInTheDocument()
    expect(screen.getByText('Аня и родители')).toBeInTheDocument()
    // Only the active sign-in carries the pill.
    expect(screen.getAllByText('сейчас')).toHaveLength(1)
  })

  it('switches the active member when another retained sign-in is clicked', async () => {
    seedRegistry()
    const user = userEvent.setup()
    renderWithProviders(<AccountsScreen />)

    // The first load belongs to the mount; only a request after the click
    // says anything about the switch.
    await screen.findByText('Chrome на Windows')
    apiGet.mockClear()
    await user.click(screen.getByText('Аня и родители'))

    await vi.waitFor(() =>
      expect(window.localStorage.getItem('ohana.activeMember')).toBe(DACHA_ANYA.memberId),
    )
    // The member now looking at the screen gets their own device review.
    await vi.waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/api/v1/me/sessions', {
        params: { header: { 'x-ohana-member': DACHA_ANYA.memberId } },
      }),
    )
    // A still-mounted observer of the previous member's key refetches under
    // its own pinned member — never under the new active one.
    expect(apiGet).toHaveBeenCalledWith('/api/v1/me/sessions', {
      params: { header: { 'x-ohana-member': FAMILY_ANYA.memberId } },
    })
  })

  it('queries nothing for the device review without an active member', async () => {
    seedRegistry()
    // A device can hold sign-ins while none is active; the screen renders,
    // but the review stays disabled — a request naming no member could
    // only be refused.
    window.localStorage.removeItem('ohana.activeMember')
    renderWithProviders(<AccountsScreen />)

    await screen.findByRole('heading', { name: 'Пространства' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('composes the device name in the interface language from the captured parts', async () => {
    seedRegistry()
    renderWithProviders(<AccountsScreen />)

    expect(await screen.findByText('Chrome на Windows')).toBeInTheDocument()
    expect(screen.getByText('Safari на iPhone')).toBeInTheDocument()
    expect(screen.getAllByText('это устройство')).toHaveLength(1)
    // Created and last-used metadata are rendered from the API values.
    expect(screen.getByText(/Вход 28 сентября/)).toBeInTheDocument()
    expect(screen.getByText(/активность 29 сентября/)).toBeInTheDocument()
  })

  it('falls back per part and to a translated label when a part is missing', async () => {
    seedRegistry()
    mockSessions([
      {
        id: '01900000-0000-7000-8000-000000001003',
        browser: '',
        platform: '',
        createdAt: '2026-09-28T10:00:00.000Z',
        lastUsedAt: '2026-09-29T09:30:00.000Z',
        current: true,
      },
      {
        id: '01900000-0000-7000-8000-000000001004',
        browser: '',
        platform: 'iPad',
        createdAt: '2026-09-28T10:00:00.000Z',
        lastUsedAt: '2026-09-29T09:30:00.000Z',
        current: false,
      },
    ])
    renderWithProviders(<AccountsScreen />)

    expect(await screen.findByText('Неизвестное устройство')).toBeInTheDocument()
    // A lone platform is shown as recorded, without inventing a browser.
    expect(screen.getByText('iPad')).toBeInTheDocument()
  })

  it('revokes another device’s session after confirmation', async () => {
    seedRegistry()
    apiDelete.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    const user = userEvent.setup()
    renderWithProviders(<AccountsScreen />)

    await screen.findByText('Chrome на Windows')
    const revokeButtons = screen.getAllByRole('button', { name: 'Завершить сессию' })
    const phoneRow = revokeButtons.at(1)
    const phoneSession = SERVER_SESSIONS.at(1)
    if (phoneRow === undefined || phoneSession === undefined) {
      throw new Error('The mock lists no phone session to revoke')
    }
    // The phone's row is the second one; the current row is also revocable,
    // so the dialog names the device before anything is deleted.
    await user.click(phoneRow)
    await user.click(await screen.findByRole('button', { name: 'Завершить' }))

    await vi.waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith(
        '/api/v1/me/sessions/{sessionId}',
        expect.objectContaining({
          params: {
            path: { sessionId: phoneSession.id },
            header: { 'x-ohana-member': FAMILY_ANYA.memberId },
          },
        }),
      ),
    )
    // Revoking another device keeps this member signed in.
    expect(window.localStorage.getItem('ohana.activeMember')).toBe(FAMILY_ANYA.memberId)
  })

  it('ends the member’s local data when the current session is revoked', async () => {
    seedRegistry()
    apiDelete.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    const user = userEvent.setup()
    renderWithProviders(<AccountsScreen />)

    await screen.findByText('Chrome на Windows')
    apiGet.mockClear()
    // The current row is the first revoke button.
    const currentRow = screen.getAllByRole('button', { name: 'Завершить сессию' }).at(0)
    if (currentRow === undefined) throw new Error('The mock lists no session to revoke')
    await user.click(currentRow)
    await user.click(await screen.findByRole('button', { name: 'Завершить' }))

    await vi.waitFor(() => {
      const retained = JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')
      expect(retained).toEqual([DACHA_ANYA])
      // Another retained sign-in becomes active, with its own data.
      expect(window.localStorage.getItem('ohana.activeMember')).toBe(DACHA_ANYA.memberId)
    })
    // Settle any post-forget refetch before the negative assertion: the
    // failure this pins arrived through a later re-render once already.
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The departed member's data is cleared, not refetched: the header is
    // pinned and the session is gone, so the request could only be refused.
    expect(apiGet).not.toHaveBeenCalledWith('/api/v1/me/sessions', {
      params: { header: { 'x-ohana-member': FAMILY_ANYA.memberId } },
    })
  })

  it('signs the active member out after confirmation and keeps the other', async () => {
    seedRegistry()
    apiDelete.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me/session') {
        return {
          data: FAMILY_ANYA.memberId,
          error: undefined,
          response: new Response(null, { status: 204 }),
        }
      }
      throw new Error(`Unexpected DELETE ${String(path)}`)
    })
    const user = userEvent.setup()
    renderWithProviders(<AccountsScreen />)

    await screen.findByText('Chrome на Windows')
    apiGet.mockClear()
    await user.click(screen.getByRole('button', { name: 'Выйти из «Наша семья»' }))
    await user.click(await screen.findByRole('button', { name: /Выйти$/ }))

    await vi.waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith(
        '/api/v1/me/session',
        expect.objectContaining({
          params: { header: { 'x-ohana-member': FAMILY_ANYA.memberId } },
        }),
      )
      expect(JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')).toEqual([
        DACHA_ANYA,
      ])
      expect(window.localStorage.getItem('ohana.activeMember')).toBe(DACHA_ANYA.memberId)
    })
    // Settle any post-forget refetch before the negative assertion: the
    // failure this pins arrived through a later re-render once already.
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The departed member's data is cleared, not refetched: the header is
    // pinned and the session is gone, so the request could only be refused.
    expect(apiGet).not.toHaveBeenCalledWith('/api/v1/me/sessions', {
      params: { header: { 'x-ohana-member': FAMILY_ANYA.memberId } },
    })
  })

  it('keeps everything and explains itself when the sign-out fails', async () => {
    seedRegistry()
    apiDelete.mockRejectedValue(new TypeError('Network unreachable'))
    const user = userEvent.setup()
    renderWithProviders(<AccountsScreen />)

    await screen.findByText('Chrome на Windows')
    await user.click(screen.getByRole('button', { name: 'Выйти из «Наша семья»' }))
    await user.click(await screen.findByRole('button', { name: /Выйти$/ }))

    expect(
      await screen.findByText('Не получилось выйти — проверьте сеть и попробуйте ещё раз.'),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem('ohana.activeMember')).toBe(FAMILY_ANYA.memberId)
  })
})
