import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminSpaceDetail } from './admin-space-detail.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/admin">{children}</a>,
}))

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

const apiGet = vi.mocked(api.GET)
const apiPost = vi.mocked(api.POST)
const apiPatch = vi.mocked(api.PATCH)

const SPACE_ID = '01900000-0000-7000-8000-00000000000a'
const ANYA_ID = '01900000-0000-7000-8000-000000000001'
const DIMA_ID = '01900000-0000-7000-8000-000000000002'

const SPACE = {
  id: SPACE_ID,
  name: 'Наша семья',
  timezone: 'Europe/Moscow',
  revision: '5',
  createdAt: '2026-08-12T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
}

const MEMBERS = [
  {
    id: ANYA_ID,
    spaceId: SPACE_ID,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    email: 'anya@example.com',
    role: 'owner' as const,
    revision: '5',
    createdAt: '2026-08-12T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: DIMA_ID,
    spaceId: SPACE_ID,
    name: 'Дима',
    role: 'regular' as const,
    revision: '5',
    createdAt: '2026-08-13T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
]

function mockApi() {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/spaces/{spaceId}') {
      return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
    }
    if (path === '/api/v1/spaces/{spaceId}/members') {
      return { data: MEMBERS, error: undefined, response: new Response(null, { status: 200 }) }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

function okBody(body: unknown, status = 200) {
  return { data: body, error: undefined, response: new Response(null, { status }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi()
})

describe('AdminSpaceDetail', () => {
  it('renders the space header and the members with their roles', async () => {
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    expect(await screen.findByRole('heading', { name: 'Наша семья' })).toBeInTheDocument()
    expect(screen.getByText('создано 12 августа · часовой пояс: Europe/Moscow')).toBeInTheDocument()
    expect(screen.getByText('Аня')).toBeInTheDocument()
    expect(screen.getByText('Аня Смирнова · anya@example.com')).toBeInTheDocument()
    expect(screen.getByText('Владелец')).toBeInTheDocument()
    expect(screen.getByText('Участник')).toBeInTheDocument()
    expect(
      screen.getByText('Роль владельца можно передать, но не снять с последнего'),
    ).toBeInTheDocument()
  })

  it('provisions a regular member through the sheet', async () => {
    const user = userEvent.setup()
    apiPost.mockResolvedValue(okBody(MEMBERS[1], 201))
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Добавить участника' }))
    await user.type(screen.getByLabelText('Имя'), 'Миша')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/spaces/{spaceId}/members',
      expect.objectContaining({
        params: { path: { spaceId: SPACE_ID } },
        body: { name: 'Миша', role: 'regular' },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
    expect(await screen.findByText('Участник добавлен')).toBeInTheDocument()
  })

  it('promotes a regular member after a confirmation', async () => {
    const user = userEvent.setup()
    apiPatch.mockResolvedValue(okBody(MEMBERS[1]))
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Дима')
    await user.click(screen.getByRole('button', { name: 'Сделать владельцем' }))
    expect(await screen.findByText('Дима станет владельцем?')).toBeInTheDocument()
    // The first «Сделать владельцем» is the row's crown button; the dialog
    // adds the second one, which confirms.
    // The focus trap hides the row buttons, so the only matching button
    // is the dialog's own confirm.
    const dialog = within(screen.getByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Сделать владельцем' }))

    expect(apiPatch).toHaveBeenCalledWith(
      '/api/v1/spaces/{spaceId}/members/{memberId}',
      expect.objectContaining({
        params: { path: { spaceId: SPACE_ID, memberId: DIMA_ID } },
        body: { role: 'owner' },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
  })

  it('renames the space from the settings sheet', async () => {
    const user = userEvent.setup()
    apiPatch.mockResolvedValue(okBody({ ...SPACE, name: 'Семья Смирновых' }))
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Настройки' }))
    const nameInput = await screen.findByLabelText('Название')
    expect(nameInput).toHaveValue('Наша семья')
    await user.clear(nameInput)
    await user.type(nameInput, 'Семья Смирновых')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(apiPatch).toHaveBeenCalledWith(
      '/api/v1/spaces/{spaceId}',
      expect.objectContaining({
        params: { path: { spaceId: SPACE_ID } },
        body: { name: 'Семья Смирновых', timezone: 'Europe/Moscow' },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
  })

  it('offers no demotion while an owner is the only one', async () => {
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)
    await screen.findByText('Аня')

    expect(screen.queryByRole('button', { name: 'Снять роль владельца' })).not.toBeInTheDocument()
  })

  it('offers the demotion once a second owner exists', async () => {
    const twoOwners = [MEMBERS[0], { ...MEMBERS[1], role: 'owner' as const }]
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/spaces/{spaceId}/members') {
        return { data: twoOwners, error: undefined, response: new Response(null, { status: 200 }) }
      }
      return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
    })
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    expect(await screen.findAllByRole('button', { name: 'Снять роль владельца' })).toHaveLength(2)
  })
})
