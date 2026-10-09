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
    // The mock space answers from one object, so the PATCH the switch sends
    // is what the next GET returns — the way the real space row behaves.
    // Every answer is a fresh copy, like a real JSON payload.
    const space = {
      ...SPACE,
      sections: { journal: true, calendar: true, wishlist: true },
    }
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: OWNER_ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/space') {
        return {
          data: structuredClone(space),
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    apiPatch.mockImplementation(async (path: never, options: never) => {
      if (path === '/api/v1/space') {
        const { sections } = (options as { body: { sections?: Partial<typeof space.sections> } })
          .body
        if (sections !== undefined) Object.assign(space.sections, sections)
        return {
          data: structuredClone(space),
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected PATCH ${String(path)}`)
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
    // Once the mutation has settled, the switch answers to the refetched
    // space: off, with the data-kept description under it.
    await vi.waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Показывать Дневник' })).not.toBeChecked(),
    )
    expect(screen.getByText('скрыт для всех — данные сохранены')).toBeInTheDocument()
  })

  it('shows the refetched space when it disagrees with the attempted switch', async () => {
    const user = userEvent.setup()
    // The PATCH succeeds, but another owner has shown the section again by
    // the time the screen refetches: the server wins over the attempt. The
    // patch is held so the attempted state is observable before it settles.
    let resolvePatch!: (value: { data: typeof SPACE; error: undefined; response: Response }) => void
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return { data: OWNER_ME, error: undefined, response: new Response(null, { status: 200 }) }
      }
      if (path === '/api/v1/space') {
        return { data: SPACE, error: undefined, response: new Response(null, { status: 200 }) }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    apiPatch.mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolvePatch = resolve
        }),
    )
    renderWithProviders(<SpaceSettingsScreen />)

    const journalSwitch = await screen.findByRole('switch', { name: 'Показывать Дневник' })
    await user.click(journalSwitch)
    // The attempt takes effect at once, before the mutation settles.
    expect(journalSwitch).not.toBeChecked()

    await vi.waitFor(() => expect(apiPatch).toHaveBeenCalled())
    resolvePatch({ data: SPACE, error: undefined, response: new Response(null, { status: 200 }) })
    await vi.waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Показывать Дневник' })).toBeChecked(),
    )
    expect(screen.getByText('записи и фото семьи')).toBeInTheDocument()
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

  it('names the top bar «Пространство» like the prototype', async () => {
    renderWithProviders(<SpaceSettingsScreen />)

    await screen.findByRole('heading', { name: 'Настройки пространства' })
    // The content heading keeps its full words; the top bar carries the
    // prototype's own data-title (docs/design/screens/space-settings.html).
    expect(screen.getByText('Пространство', { exact: true })).toBeInTheDocument()
  })

  it('keeps the section rows at the prototype’s 60px behind bare muted icons', async () => {
    renderWithProviders(<SpaceSettingsScreen />)

    await screen.findByText(/Скрытие не удаляет данные/)
    // The shell's sidebar carries the same section names; the row is the
    // match that sits inside a list row.
    const row = screen
      .getAllByText('Дневник')
      .map((title) => title.closest<HTMLElement>('[data-slot="item"]'))
      .find((item) => item !== null)
    if (row === undefined) throw new Error('the journal row never rendered')
    // The prototype's inline min-height:60px — the list row's md size.
    expect(row).toHaveClass('min-h-15')
    const media = row.querySelector('[data-slot="item-media"]')
    if (media === null) throw new Error('the row never rendered its leading icon')
    // A bare 20px muted icon, not the 38px accent tile (issue #77).
    expect(media.getAttribute('data-variant')).toBe('default')
    expect(media).toHaveClass('text-muted-foreground')
    expect(media).not.toHaveClass('size-[38px]')
  })

  it('heads the sections with the plain h3 and closes with the mono line', async () => {
    renderWithProviders(<SpaceSettingsScreen />)

    await screen.findByRole('heading', { name: 'Настройки пространства' })
    // The prototype's plain h3 heads (docs/design/README.md, issue #80).
    expect(screen.getByRole('heading', { name: 'Разделы' }).tagName).toBe('H3')
    expect(screen.getByRole('heading', { name: 'Часовой пояс' }).tagName).toBe('H3')

    // The hints under the cards are the field's 12.5px, and the closing
    // line is the prototype's mono meta.
    expect(screen.getByText(/Скрытие не удаляет данные/)).toHaveClass('text-meta')
    const footer = screen.getByText(/Изменения увидят участники после синхронизации/)
    expect(footer).toHaveClass('font-mono', 'text-meta', 'uppercase')
  })
})
