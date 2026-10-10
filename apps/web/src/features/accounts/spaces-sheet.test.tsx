import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult, type SyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { closeSpacesSheet, openSpacesSheet, SpacesSheet } from './spaces-sheet.tsx'

/*
 * The «Пространства» sheet (issue #64): one row per sign-in on this
 * device — avatar stack, the space's name, a subtitle and the accent
 * check on the active one — then «Войти по коду» and «Выйти из …» behind
 * its confirm. One store opens it from every trigger: the top-bar
 * switcher, the sidebar's, and the user menu's «Сменить пространство».
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const navigate = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: (props: { to: string; children?: React.ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
  Navigate: () => null,
}))

const FAMILY_ID = '01900000-0000-7000-8000-00000000000a'
const DACHA_ID = '01900000-0000-7000-8000-00000000000b'
const ANYA = '01900000-0000-7000-8000-000000000001'
const DACHA_ANYA = '01900000-0000-7000-8000-000000000002'
const DIMA = '01900000-0000-7000-8000-000000000003'

function seedRegistry() {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: ANYA,
        spaceId: FAMILY_ID,
        spaceName: 'Наша семья',
        name: 'Аня',
        displayName: 'Аня Смирнова',
      },
      {
        memberId: DACHA_ANYA,
        spaceId: DACHA_ID,
        spaceName: 'Аня и родители',
        name: 'Аня',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', ANYA)
}

function syncResultWith(members: SyncResult['changes'][number][]): SyncResult {
  return {
    revision: '7',
    changes: [
      {
        entity: 'space',
        space: {
          id: FAMILY_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal: true, calendar: true, wishlist: true },
        },
      },
      ...members,
    ],
    tombstones: [],
  }
}

function member(id: string, name: string, role: 'owner' | 'regular', createdAt: string) {
  return { entity: 'member' as const, member: { id, name, role, createdAt } }
}

function mockSignedIn() {
  vi.mocked(api.GET).mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') {
      return {
        data: {
          member: {
            id: ANYA,
            name: 'Аня',
            displayName: 'Аня Смирнова',
            role: 'owner',
            createdAt: '2026-08-12T10:00:00.000Z',
          },
          space: { id: FAMILY_ID, name: 'Наша семья' },
          needsOnboarding: false,
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  window.localStorage.clear()
  vi.clearAllMocks()
  closeSpacesSheet()
})

afterEach(async () => {
  const names = await globalThis.indexedDB.databases()
  for (const name of names) {
    if (name.name !== undefined) globalThis.indexedDB.deleteDatabase(name.name)
  }
})

describe('SpacesSheet', () => {
  it('opens with one row per sign-in and the check on the active one', async () => {
    seedRegistry()
    await applySyncResult(
      ANYA,
      syncResultWith([
        member(ANYA, 'Аня', 'owner', '2026-08-12T10:00:00.000Z'),
        member(DIMA, 'Дима', 'regular', '2026-08-13T10:00:00.000Z'),
      ]),
    )
    renderWithProviders(<SpacesSheet />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => openSpacesSheet())

    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Пространства' })).toBeVisible()
    expect(screen.getByText('Один сервер может хранить несколько независимых семей')).toBeVisible()
    const activeRow = screen.getByRole('button', { name: 'Переключиться на «Наша семья»' })
    expect(activeRow).toHaveAttribute('aria-current', 'true')
    const otherRow = screen.getByRole('button', { name: 'Переключиться на «Аня и родители»' })
    expect(otherRow).not.toHaveAttribute('aria-current')
    // The downloaded partition answers the count line; the other space
    // names its signed-in member.
    await vi.waitFor(() => expect(activeRow).toHaveTextContent('2 участника · вы владелец'))
    expect(otherRow).toHaveTextContent('Аня')
    // «Войти по коду» leads to the code screen.
    expect(screen.getByRole('link', { name: 'Войти по коду' })).toHaveAttribute('href', '/signin')
    expect(screen.getByRole('button', { name: 'Выйти из «Наша семья»' })).toBeVisible()
  })

  it('closed is the store’s word: nothing renders until a trigger opens it', () => {
    renderWithProviders(<SpacesSheet />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('choosing a row switches the active member and closes the sheet', async () => {
    seedRegistry()
    const user = userEvent.setup()
    renderWithProviders(<SpacesSheet />)
    act(() => openSpacesSheet())

    await user.click(screen.getByRole('button', { name: 'Переключиться на «Аня и родители»' }))

    await vi.waitFor(() =>
      expect(window.localStorage.getItem('ohana.activeMember')).toBe(DACHA_ANYA),
    )
    // Switching means entering that space: the gate at / renders its home.
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the active row only closes the sheet — the switch is a no-op', async () => {
    seedRegistry()
    const user = userEvent.setup()
    renderWithProviders(<SpacesSheet />)
    act(() => openSpacesSheet())

    await user.click(screen.getByRole('button', { name: 'Переключиться на «Наша семья»' }))

    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('signs the active member out behind the prototype’s confirmation', async () => {
    seedRegistry()
    vi.mocked(api.DELETE).mockResolvedValue({
      data: ANYA,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    const user = userEvent.setup()
    renderWithProviders(<SpacesSheet />)
    act(() => openSpacesSheet())

    await user.click(screen.getByRole('button', { name: 'Выйти из «Наша семья»' }))
    expect(screen.getByRole('dialog', { name: /Выйти из «Наша семья»\?/ })).toBeVisible()
    expect(
      screen.getByText(
        'Записи, события и вишлисты этого пространства исчезнут с устройства. Пространство, другие участники и их данные останутся на сервере.',
      ),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: /^Выйти$/ }))

    await vi.waitFor(() => {
      expect(api.DELETE).toHaveBeenCalledWith(
        '/api/v1/me/session',
        expect.objectContaining({
          params: { header: { 'x-ohana-member': ANYA } },
        }),
      )
      // The sign-in is gone from the device; the other one stays.
      expect(JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')).toEqual([
        expect.objectContaining({ memberId: DACHA_ANYA }),
      ])
      expect(window.localStorage.getItem('ohana.activeMember')).toBe(DACHA_ANYA)
    })
    // The sheet closes over the next member's home (the success toast is
    // a dialog role of its own, so the rows are what says closed).
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Переключиться на «Наша семья»' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Вы вышли из «Наша семья»')).toBeVisible()
  })

  it('keeps the member and explains itself when the sign-out fails', async () => {
    seedRegistry()
    vi.mocked(api.DELETE).mockRejectedValue(new TypeError('Network unreachable'))
    const user = userEvent.setup()
    renderWithProviders(<SpacesSheet />)
    act(() => openSpacesSheet())

    await user.click(screen.getByRole('button', { name: 'Выйти из «Наша семья»' }))
    await user.click(screen.getByRole('button', { name: /^Выйти$/ }))

    expect(
      await screen.findByText('Не получилось выйти — проверьте сеть и попробуйте ещё раз.'),
    ).toBeVisible()
    expect(window.localStorage.getItem('ohana.activeMember')).toBe(ANYA)
  })

  it('is mounted by the signed-in gate, so every member screen carries it', async () => {
    mockSignedIn()
    seedRegistry()
    const { MemberSessionGate } = await import('@/features/member/member-session-gate.tsx')
    renderWithProviders(
      <MemberSessionGate require="signed-in" redirectTo="/signin">
        <p>Экран</p>
      </MemberSessionGate>,
    )
    await screen.findByText('Экран')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Every trigger funnels into one opener — the switcher's and the user
    // menu item's wiring is the shell's and the menu's tests.
    act(() => openSpacesSheet())

    expect(screen.getByRole('heading', { name: 'Пространства', level: 2 })).toBeVisible()
  })
})
