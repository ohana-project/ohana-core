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

const CODE_ID = '01900000-0000-7000-8000-000000000003'

function accessCode(status: 'issued' | 'redeemed' | 'expired' | 'replaced' | 'revoked') {
  return {
    id: CODE_ID,
    memberId: DIMA_ID,
    status,
    createdAt: '2026-09-20T10:00:00.000Z',
    expiresAt: '2026-09-21T10:00:00.000Z',
    statusChangedAt: '2026-09-20T10:00:00.000Z',
  }
}

function mockApi() {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/spaces/{spaceId}') {
      return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
    }
    if (path === '/api/v1/spaces/{spaceId}/members') {
      return { data: MEMBERS, error: undefined, response: new Response(null, { status: 200 }) }
    }
    if (path === '/api/v1/spaces/{spaceId}/access-codes') {
      return { data: [], error: undefined, response: new Response(null, { status: 200 }) }
    }
    if (path === '/api/v1/admin/settings') {
      return {
        data: { trashRetentionDays: 30 },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
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
    expect(screen.getByText('создано 12 августа · корзина хранится 30 дней')).toBeInTheDocument()
    expect(screen.getByText('Аня')).toBeInTheDocument()
    expect(screen.getByText('Аня Смирнова · anya@example.com')).toBeInTheDocument()
    expect(screen.getByText('Владелец')).toBeInTheDocument()
    expect(screen.getByText('Обычный участник')).toBeInTheDocument()
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

  it('keeps the provision sheet open while the request is in flight', async () => {
    const user = userEvent.setup()
    let settle: (() => void) | undefined
    apiPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({
              data: MEMBERS[1],
              error: undefined,
              response: new Response(null, { status: 201 }),
            })
        }),
    )
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Добавить участника' }))
    await user.type(screen.getByLabelText('Имя'), 'Миша')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    // The in-flight request owns the sheet: dismissing it is refused, so
    // the draft and the fields stay exactly as they were. The sheet has
    // no close X (issue #59) — Escape is the dismissal it refuses.
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('Имя')).toHaveValue('Миша')

    settle?.()
    expect(await screen.findByText('Участник добавлен')).toBeInTheDocument()
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument()
  })

  it('forgets abandoned edits when the provision sheet reopens', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Добавить участника' }))
    await user.type(screen.getByLabelText('Имя'), 'Черновик')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Добавить участника' }))

    expect(screen.getByLabelText('Имя')).toHaveValue('')
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('shows the server values again when the settings sheet reopens', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Настройки' }))
    const nameInput = await screen.findByLabelText('Название')
    await user.clear(nameInput)
    await user.type(nameInput, 'Брошенное имя')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Настройки' }))

    expect(await screen.findByLabelText('Название')).toHaveValue('Наша семья')
    expect(apiPatch).not.toHaveBeenCalled()
  })

  it('rejects a too-short email in the sheet before calling the API', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Добавить участника' }))
    await user.type(screen.getByLabelText('Имя'), 'Миша')
    await user.type(screen.getByLabelText('Эл. почта'), 'ab')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByText('Минимум 3 символа — проверьте значение')).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('shows a schema answer as a form-level error and clears it on edit', async () => {
    const user = userEvent.setup()
    apiPost.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'validation_failed', message: 'nope' } },
      response: new Response(null, { status: 400 }),
    })
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Добавить участника' }))
    await user.type(screen.getByLabelText('Имя'), 'Миша')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(
      await screen.findByText('Проверьте поля — некоторые значения не подходят'),
    ).toBeInTheDocument()

    // Editing any field clears the form-level answer.
    await user.type(screen.getByLabelText('Имя'), '!')
    expect(
      screen.queryByText('Проверьте поля — некоторые значения не подходят'),
    ).not.toBeInTheDocument()
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

  it('keeps the role dialog open while the request is in flight', async () => {
    const user = userEvent.setup()
    let settle: (() => void) | undefined
    apiPatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({
              data: MEMBERS[1],
              error: undefined,
              response: new Response(null, { status: 200 }),
            })
        }),
    )
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Дима')
    await user.click(screen.getByRole('button', { name: 'Сделать владельцем' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Сделать владельцем' }))

    // The in-flight request owns the dialog: Escape and the footer's
    // cancel button are refused until it settles.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Отмена' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    settle?.()
    await user.click(dialog.getByRole('button', { name: 'Сделать владельцем' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects a multibyte email whose code points are under the minimum', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Добавить участника' }))
    await user.type(screen.getByLabelText('Имя'), 'Миша')
    // «😀a» is 2 code points but 3 UTF-16 units: only a code-point count
    // refuses it.
    await user.type(screen.getByLabelText('Эл. почта'), '😀a')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByText('Минимум 3 символа — проверьте значение')).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
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

    // Only the changed field travels; the time zone stayed as it was.
    expect(apiPatch).toHaveBeenCalledWith(
      '/api/v1/spaces/{spaceId}',
      expect.objectContaining({
        params: { path: { spaceId: SPACE_ID } },
        body: { name: 'Семья Смирновых' },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
  })

  it('sends nothing when the settings sheet saves unchanged values', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Настройки' }))
    await screen.findByLabelText('Название')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(apiPatch).not.toHaveBeenCalled()
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

describe('AdminSpaceDetail access codes', () => {
  it('lists the codes with their statuses, naming members instead of codes', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/spaces/{spaceId}/members') {
        return { data: MEMBERS, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/spaces/{spaceId}/access-codes') {
        return {
          data: [accessCode('issued'), accessCode('redeemed'), accessCode('revoked')],
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
    })
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    expect(screen.getByText('Коды входа')).toBeInTheDocument()
    // Three rows for the same member, one per status, plus the members row.
    expect(await screen.findByText('Выпущен')).toBeInTheDocument()
    expect(screen.getByText('Использован')).toBeInTheDocument()
    expect(screen.getByText('Отозван')).toBeInTheDocument()
    expect(screen.getAllByText('Дима')).toHaveLength(4)
    // Only the live code offers revocation.
    expect(screen.getAllByRole('button', { name: 'Отозвать' })).toHaveLength(1)
  })

  it('issues a code through the dialog and shows the plaintext once', async () => {
    const user = userEvent.setup()
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/spaces/{spaceId}/members') {
        return { data: MEMBERS, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/spaces/{spaceId}/access-codes') {
        return { data: [], error: undefined, response: new Response(null, { status: 200 }) }
      }
      return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
    })
    apiPost.mockResolvedValue(okBody({ ...accessCode('issued'), code: 'QWEE-4455' }, 201))
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Выпустить код' }))
    await user.selectOptions(screen.getByLabelText('Участник'), DIMA_ID)
    await user.click(screen.getByRole('button', { name: 'Выпустить' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/spaces/{spaceId}/members/{memberId}/access-codes',
      expect.objectContaining({
        params: { path: { spaceId: SPACE_ID, memberId: DIMA_ID } },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
    // The plaintext appears once, in the dialog.
    expect(await screen.findByText('QWEE-4455')).toBeInTheDocument()
    expect(screen.getByText('Живёт 24 часа · один вход')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.queryByText('QWEE-4455')).not.toBeInTheDocument()
  })

  it('asks for a member before issuing', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Выпустить код' }))
    await user.click(screen.getByRole('button', { name: 'Выпустить' }))

    expect(await screen.findByText('Выберите участника')).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('revokes a live code after a confirmation', async () => {
    const user = userEvent.setup()
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/spaces/{spaceId}/members') {
        return { data: MEMBERS, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/spaces/{spaceId}/access-codes') {
        return {
          data: [accessCode('issued')],
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
    })
    apiPost.mockResolvedValue(okBody({ ...accessCode('issued'), status: 'revoked' }))
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    const revokeButton = await screen.findByRole('button', { name: 'Отозвать' })
    await user.click(revokeButton)
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Отозвать этот код?')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Отозвать' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/spaces/{spaceId}/access-codes/{codeId}/revoke',
      expect.objectContaining({
        params: { path: { spaceId: SPACE_ID, codeId: CODE_ID } },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
  })
})

describe('AdminSpaceDetail — the archive (issue #23)', () => {
  it('lists the archived members in their own section, with the archive pill', async () => {
    const archivedMembers = [
      ...MEMBERS,
      {
        id: '01900000-0000-7000-8000-000000000004',
        spaceId: SPACE_ID,
        name: 'Пётр',
        role: 'regular' as const,
        revision: '5',
        createdAt: '2026-08-14T10:00:00.000Z',
        updatedAt: '2026-09-03T10:00:00.000Z',
        archivedAt: '2026-09-03T10:00:00.000Z',
      },
    ]
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/spaces/{spaceId}') {
        return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/spaces/{spaceId}/members') {
        return {
          data: archivedMembers,
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      if (path === '/api/v1/spaces/{spaceId}/access-codes') {
        return { data: [], error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    expect(await screen.findByText('Пётр')).toBeInTheDocument()
    const archiveSection = screen.getByText('Архив').closest('section')
    if (archiveSection === null) throw new Error('No archive section rendered')
    expect(within(archiveSection).getByText('Пётр')).toBeInTheDocument()
    expect(within(archiveSection).getByText('В архиве')).toBeInTheDocument()
    expect(within(archiveSection).getByText('в архиве с 3 сентября')).toBeInTheDocument()
    // The archived row carries the restore action, not the role controls.
    expect(
      within(archiveSection).getByRole('button', { name: 'Восстановить участника' }),
    ).toBeInTheDocument()
  })
})

describe('AdminSpaceDetail — design parity (issue #80)', () => {
  it('renders the section headings as h3, the prototype’s admin form', async () => {
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    expect(screen.getByRole('heading', { name: 'Участники', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Коды входа', level: 3 })).toBeInTheDocument()
  })

  it('leads the header with the members’ avatar stack, like the prototype', async () => {
    const { container } = renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    const stack = container.querySelector('[data-slot=avatar-stack]')
    expect(stack).not.toBeNull()
    // The stack carries the space's members, not the space monogram.
    expect(within(stack as HTMLElement).getAllByText('А')).toHaveLength(1)
    expect(within(stack as HTMLElement).getAllByText('Д')).toHaveLength(1)
  })

  it('offers the labelled copy button beside «Готово» in the issue dialog', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    apiPost.mockResolvedValue(okBody({ ...accessCode('issued'), code: 'QWEE-4455' }, 201))
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    await screen.findByText('Аня')
    await user.click(screen.getByRole('button', { name: 'Выпустить код' }))
    await user.selectOptions(screen.getByLabelText('Участник'), DIMA_ID)
    await user.click(screen.getByRole('button', { name: 'Выпустить' }))

    // The issued-code toast is a dialog too; scope to the modal popup.
    const popup = screen.getAllByRole('dialog').find((element) => element.dataset.slot !== 'toast')
    if (popup === undefined) throw new Error('the issue dialog never rendered')
    const dialog = within(popup)
    const copy = await dialog.findByRole('button', { name: 'Скопировать' })
    expect(dialog.getByRole('button', { name: 'Готово' })).toBeInTheDocument()
    await user.click(copy)

    expect(writeText).toHaveBeenCalledWith('QWEE-4455')
    expect(await screen.findByText('Код скопирован')).toBeInTheDocument()
    // The dialog stays open: «Готово» is the way out.
    expect(dialog.getByRole('button', { name: 'Готово' })).toBeInTheDocument()
  })

  it('keeps the subtitle to the creation date when the settings are unreachable', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/spaces/{spaceId}') {
        return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/spaces/{spaceId}/members') {
        return { data: MEMBERS, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/spaces/{spaceId}/access-codes') {
        return { data: [], error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<AdminSpaceDetail spaceId={SPACE_ID} />)

    expect(await screen.findByText('создано 12 августа')).toBeInTheDocument()
  })
})
