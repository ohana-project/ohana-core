import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { InviteMemberScreen } from './invite-member-screen.tsx'

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

const NEW_MEMBER = {
  id: '01900000-0000-7000-8000-000000000002',
  name: 'Дима',
  role: 'regular' as const,
  createdAt: '2026-09-29T10:00:00.000Z',
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

function okBody(body: unknown, status = 200) {
  return { data: body, error: undefined, response: new Response(null, { status }) }
}

describe('InviteMemberScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    seedRegistry()
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: OWNER_ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
  })

  it('provisions the member and shows the plaintext code once', async () => {
    const user = userEvent.setup()
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/members') return okBody(NEW_MEMBER, 201)
      if (path === '/api/v1/members/{memberId}/access-code') {
        return okBody(
          {
            id: '01900000-0000-7000-8000-000000000003',
            memberId: NEW_MEMBER.id,
            code: 'SASF-KQLV',
            status: 'issued',
            createdAt: '2026-09-29T10:00:00.000Z',
            expiresAt: '2026-09-30T10:00:00.000Z',
            statusChangedAt: '2026-09-29T10:00:00.000Z',
          },
          201,
        )
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    renderWithProviders(<InviteMemberScreen />)

    await screen.findByRole('heading', { name: 'Пригласить участника' })
    await user.type(screen.getByLabelText('Имя'), 'Дима')
    await user.click(screen.getByRole('button', { name: 'Пригласить и выпустить код' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/members',
      expect.objectContaining({ body: { name: 'Дима', role: 'regular' } }),
    )
    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/members/{memberId}/access-code',
      expect.objectContaining({ params: { path: { memberId: NEW_MEMBER.id } } }),
    )
    // The plaintext is on the screen exactly once.
    expect(await screen.findByText('SASF-KQLV')).toBeInTheDocument()
    expect(screen.getAllByText('SASF-KQLV').length).toBe(1)
    expect(screen.getByText('Живёт 24 часа · один вход')).toBeInTheDocument()
  })

  it('rerolls the code from the issued state', async () => {
    const user = userEvent.setup()
    let issueCount = 0
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/members') return okBody(NEW_MEMBER, 201)
      if (path === '/api/v1/members/{memberId}/access-code') {
        issueCount += 1
        return okBody(
          {
            id: `01900000-0000-7000-8000-00000000000${issueCount}`,
            memberId: NEW_MEMBER.id,
            code: issueCount === 1 ? 'SASF-KQLV' : 'QWEE-4455',
            status: 'issued',
            createdAt: '2026-09-29T10:00:00.000Z',
            expiresAt: '2026-09-30T10:00:00.000Z',
            statusChangedAt: '2026-09-29T10:00:00.000Z',
          },
          201,
        )
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    renderWithProviders(<InviteMemberScreen />)

    await screen.findByRole('heading', { name: 'Пригласить участника' })
    await user.type(screen.getByLabelText('Имя'), 'Дима')
    await user.click(screen.getByRole('button', { name: 'Пригласить и выпустить код' }))
    expect(await screen.findByText('SASF-KQLV')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Перевыпустить' }))
    // The confirm dialog carries its own button with the same label; the
    // shell renders a drawer with the same role, so the confirm dialog is
    // addressed by its title.
    const dialog = await screen.findByRole('dialog', { name: 'Перевыпустить код?' })
    expect(within(dialog).getByText(/SASF-KQLV заменится/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Перевыпустить' }))
    expect(await screen.findByText('QWEE-4455')).toBeInTheDocument()
    expect(apiPost).toHaveBeenCalledTimes(3)
  })

  it('answers a failed reroll on the page, not inside the dialog', async () => {
    const user = userEvent.setup()
    let issueCount = 0
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/members') return okBody(NEW_MEMBER, 201)
      if (path === '/api/v1/members/{memberId}/access-code') {
        issueCount += 1
        if (issueCount === 1) {
          return okBody(
            {
              id: '01900000-0000-7000-8000-000000000003',
              memberId: NEW_MEMBER.id,
              code: 'SASF-KQLV',
              status: 'issued',
              createdAt: '2026-09-29T10:00:00.000Z',
              expiresAt: '2026-09-30T10:00:00.000Z',
              statusChangedAt: '2026-09-29T10:00:00.000Z',
            },
            201,
          )
        }
        return {
          data: undefined,
          error: { error: { code: 'unexpected', message: 'boom' } },
          response: new Response(null, { status: 500 }),
        }
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    renderWithProviders(<InviteMemberScreen />)

    await screen.findByRole('heading', { name: 'Пригласить участника' })
    await user.type(screen.getByLabelText('Имя'), 'Дима')
    await user.click(screen.getByRole('button', { name: 'Пригласить и выпустить код' }))
    expect(await screen.findByText('SASF-KQLV')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Перевыпустить' }))
    const dialog = await screen.findByRole('dialog', { name: 'Перевыпустить код?' })
    await user.click(within(dialog).getByRole('button', { name: 'Перевыпустить' }))

    // The failure steps out of the dialog's way: the dialog is gone, and the
    // message shows on the page next to the code it failed to replace.
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Перевыпустить код?' })).not.toBeInTheDocument()
    })
    expect(
      screen.getByText('Не получилось — проверьте сеть и попробуйте ещё раз.'),
    ).toBeInTheDocument()
    expect(screen.getByText('SASF-KQLV')).toBeInTheDocument()
  })

  it('offers a retry when issuing the code fails after the member exists', async () => {
    const user = userEvent.setup()
    let attempts = 0
    apiPost.mockImplementation(async (path: never) => {
      if (path === '/api/v1/members') return okBody(NEW_MEMBER, 201)
      if (path === '/api/v1/members/{memberId}/access-code') {
        attempts += 1
        if (attempts === 1) {
          return {
            data: undefined,
            error: { error: { code: 'unexpected', message: 'boom' } },
            response: new Response(null, { status: 500 }),
          }
        }
        return okBody(
          {
            id: '01900000-0000-7000-8000-000000000003',
            memberId: NEW_MEMBER.id,
            code: 'SASF-KQLV',
            status: 'issued',
            createdAt: '2026-09-29T10:00:00.000Z',
            expiresAt: '2026-09-30T10:00:00.000Z',
            statusChangedAt: '2026-09-29T10:00:00.000Z',
          },
          201,
        )
      }
      throw new Error(`Unexpected POST ${String(path)}`)
    })
    renderWithProviders(<InviteMemberScreen />)

    await screen.findByRole('heading', { name: 'Пригласить участника' })
    await user.type(screen.getByLabelText('Имя'), 'Дима')
    await user.click(screen.getByRole('button', { name: 'Пригласить и выпустить код' }))

    // The failure is a state with a way out, not an endless spinner: the
    // member already exists, so only the issuance retries.
    const retry = await screen.findByRole('button', { name: 'Выпустить код ещё раз' })
    expect(
      screen.getByText('Не получилось — проверьте сеть и попробуйте ещё раз.'),
    ).toBeInTheDocument()
    await user.click(retry)
    expect(await screen.findByText('SASF-KQLV')).toBeInTheDocument()
    // The stale failure never outlives the fresh code.
    expect(
      screen.queryByText('Не получилось — проверьте сеть и попробуйте ещё раз.'),
    ).not.toBeInTheDocument()
    expect(apiPost).toHaveBeenCalledTimes(3)
  })

  it('refuses an empty name', async () => {
    const user = userEvent.setup()
    renderWithProviders(<InviteMemberScreen />)

    await screen.findByRole('heading', { name: 'Пригласить участника' })
    await user.click(screen.getByRole('button', { name: 'Пригласить и выпустить код' }))
    expect(await screen.findByText('Напишите имя участника')).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('sends a regular member back to the list', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: REGULAR_ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<InviteMemberScreen />)

    expect(await screen.findByText('redirected to /members')).toBeInTheDocument()
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument()
  })
})
