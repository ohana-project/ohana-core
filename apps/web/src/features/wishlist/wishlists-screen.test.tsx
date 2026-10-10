import { screen, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import type {
  StoredCalendarEvent,
  StoredGiftFavorite,
  StoredGiftReservation,
  StoredMemberProfile,
  StoredWish,
  SyncResult,
} from '@/data/local-store.ts'
import { applySyncResult } from '@/data/local-store.ts'
import { formatDateOnly } from '@/lib/calendar-dates.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { WishlistsScreen } from './wishlists-screen.tsx'

/*
 * The wishlists overview (issue #66, docs/design/screens/wishlists.html):
 * the «Вишлисты» heading with its muted subtitle, the member's own list as
 * an avatar-led link card, the members' rows with their inline counts and
 * status lines, and the aside holding the birthday note, the surprise rule
 * and the favourites link. Everything reads the local store, so the same
 * render answers offline (ADR-0002).
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  // The overview's cards and rows are links; the params interpolate into
  // the href so the tests can assert where each row leads.
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode
    to?: string
    params?: Record<string, string>
  }) => <a href={to?.replace('$memberId', params?.memberId ?? '$memberId')}>{children}</a>,
  useNavigate: () => async () => {},
  Navigate: () => null,
}))

const apiGet = vi.mocked(api.GET)

const ME = '01900000-0000-7000-8000-000000000001'
const DIMA = '01900000-0000-7000-8000-000000000002'
const LYUDA = '01900000-0000-7000-8000-000000000003'
const MISHA = '01900000-0000-7000-8000-000000000004'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

const PROFILES: StoredMemberProfile[] = [
  {
    id: ME,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner',
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  { id: DIMA, name: 'Дима', role: 'regular', createdAt: '2026-08-14T10:00:00.000Z' },
  { id: LYUDA, name: 'Люда', role: 'regular', createdAt: '2026-08-15T10:00:00.000Z' },
  { id: MISHA, name: 'Миша', role: 'regular', createdAt: '2026-08-16T10:00:00.000Z' },
]

function wish(overrides?: Partial<StoredWish>): StoredWish {
  return {
    id: '01900000-0000-7000-8000-000000000301',
    authorId: ME,
    title: 'Налобный фонарь',
    createdAt: '2026-09-25T12:00:00.000Z',
    updatedAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  }
}

function dayKeyFromNow(days: number): string {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return formatDateOnly({ year: day.getFullYear(), month: day.getMonth() + 1, day: day.getDate() })
}

function birthdayEvent(daysAhead: number): StoredCalendarEvent {
  return {
    id: '01900000-0000-7000-8000-000000000401',
    creatorId: ME,
    title: 'День рождения Люды',
    allDay: true,
    date: dayKeyFromNow(daysAhead),
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  }
}

function favorite(overrides?: Partial<StoredGiftFavorite>): StoredGiftFavorite {
  return {
    id: '01900000-0000-7000-8000-000000000501',
    wishId: '01900000-0000-7000-8000-000000000313',
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
    ...overrides,
  }
}

function reservation(overrides?: Partial<StoredGiftReservation>): StoredGiftReservation {
  return {
    id: '01900000-0000-7000-8000-000000000601',
    wishId: '01900000-0000-7000-8000-000000000313',
    memberId: LYUDA,
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
    ...overrides,
  }
}

function syncResult(wishes: StoredWish[], extra: SyncResult['changes'] = []): SyncResult {
  return {
    revision: '7',
    changes: [
      {
        entity: 'space',
        space: {
          id: SPACE_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal: true, calendar: true, wishlist: true },
        },
      },
      ...PROFILES.map((member) => ({ entity: 'member' as const, member })),
      ...wishes.map((row) => ({ entity: 'wishlist_wish' as const, wish: row })),
      ...extra,
    ],
    tombstones: [],
  }
}

function seedRegistry() {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: ME,
        spaceId: SPACE_ID,
        spaceName: 'Наша семья',
        name: 'Аня',
        displayName: 'Аня Смирнова',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', ME)
}

function mockQuietSync() {
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') {
      return {
        data: {
          member: {
            id: ME,
            name: 'Аня',
            displayName: 'Аня Смирнова',
            role: 'owner',
            createdAt: '2026-08-12T10:00:00.000Z',
          },
          space: { id: SPACE_ID, name: 'Наша семья' },
          needsOnboarding: false,
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    }
    if (path === '/api/v1/sync') {
      return {
        data: { revision: '7', changes: [], tombstones: [] },
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
})

afterEach(async () => {
  const names = await globalThis.indexedDB.databases()
  for (const name of names) {
    if (name.name !== undefined) globalThis.indexedDB.deleteDatabase(name.name)
  }
})

/** The member row's list item: rows and cards alike carry the member's
 *  name, so the assertions below scope themselves to one row's box. */
function memberRow(name: string): HTMLElement {
  const link = screen.getByRole('link', { name: new RegExp(name) })
  return link
}

describe('WishlistsScreen (the overview)', () => {
  it('opens with the «Вишлисты» heading and its muted subtitle', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Вишлисты' })).toBeInTheDocument()
    expect(screen.getByText('Желания каждого — и подарки без пересечений')).toBeInTheDocument()
  })

  it('counts the own list and the other members open wishes', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        wish({ id: '01900000-0000-7000-8000-000000000311' }),
        wish({
          id: '01900000-0000-7000-8000-000000000312',
          title: 'Полученный подарок',
          receivedAt: '2026-09-30T10:00:00.000Z',
        }),
        wish({
          id: '01900000-0000-7000-8000-000000000313',
          authorId: DIMA,
          title: 'Термос',
        }),
        wish({
          id: '01900000-0000-7000-8000-000000000314',
          authorId: DIMA,
          title: 'Ушедшее желание',
          receivedAt: '2026-09-29T10:00:00.000Z',
        }),
      ]),
    )
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    // The own card counts open wishes only: one open, one received —
    // the prototype's "3 желания · 1 уже подарили" line.
    expect(await screen.findByText('1 желание · 1 уже подарили')).toBeInTheDocument()
    // Дима's row carries the inline count in its title; the received one
    // left his open count.
    expect(within(memberRow('Дима')).getByText(/· 1 желание$/)).toBeInTheDocument()
    // Люда has no wishes at all, and the count says so.
    expect(within(memberRow('Люда')).getByText(/· 0 желаний$/)).toBeInTheDocument()
  })

  it("leads the own card with the member's avatar, the rows with theirs", async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    await screen.findByText('1 желание')
    // The own card leads with Аня's monogram, the rows with the members'.
    const monograms = screen.getAllByText('А')
    expect(monograms.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Д').length).toBeGreaterThanOrEqual(1)
    // No grey gift tile remains anywhere on the screen (issue #57's
    // interim rows are gone with #66).
    expect(screen.queryByText('gift')).not.toBeInTheDocument()
  })

  it('links the own card, every member row and the favourites card', async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult([
        wish({ id: '01900000-0000-7000-8000-000000000311' }),
        wish({ id: '01900000-0000-7000-8000-000000000313', authorId: DIMA, title: 'Термос' }),
      ]),
    )
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    await screen.findByText('Дима')
    const targets = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(targets).toContain('/wishlist/mine')
    expect(targets).toContain('/wishlist/favorites')
    expect(targets).toContain(`/wishlist/${DIMA}`)
    expect(targets).toContain(`/wishlist/${LYUDA}`)
    expect(targets).toContain(`/wishlist/${MISHA}`)
  })

  it('keeps the top-bar actions desktop-only: favourites and my wishlist, no add', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    await screen.findByText('Дима')
    // The prototype's d-only pair, in the top bar from 920px.
    expect(screen.getByRole('link', { name: 'Избранное' })).toHaveAttribute(
      'href',
      '/wishlist/favorites',
    )
    expect(screen.getByRole('link', { name: 'Мой вишлист' })).toHaveAttribute(
      'href',
      '/wishlist/mine',
    )
    // The add wish the earlier screen carried is gone — the mine screen's
    // dashed tile owns adding (issue #68).
    expect(screen.queryByText('Добавить желание')).not.toBeInTheDocument()
  })

  it("tells each member's story in the status line: reservations and near birthdays", async () => {
    seedRegistry()
    await applySyncResult(
      ME,
      syncResult(
        [
          wish({ id: '01900000-0000-7000-8000-000000000313', authorId: DIMA, title: 'Термос' }),
          wish({ id: '01900000-0000-7000-8000-000000000321', authorId: LYUDA, title: 'Шаль' }),
          wish({ id: '01900000-0000-7000-8000-000000000322', authorId: LYUDA, title: 'Чайник' }),
        ],
        [
          { entity: 'calendar_event', event: birthdayEvent(21) },
          { entity: 'wishlist_gift_reservation', reservation: reservation() },
        ],
      ),
    )
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    // Дима: one of his wishes is reserved — the reserved count is the
    // status line when no birthday is near.
    await screen.findByText('Дима')
    expect(within(memberRow('Дима')).getByText('1 желание забронировано')).toBeInTheDocument()
    // Люда: the near birthday takes the line, with the warn pill beside
    // the chevron.
    expect(within(memberRow('Люда')).getByText('день рождения через 21 день')).toBeInTheDocument()
    expect(within(memberRow('Люда')).getByText('Скоро ДР')).toBeInTheDocument()
    // Миша: nothing to tell, no status line.
    expect(within(memberRow('Миша')).queryByText(/забронировано/)).not.toBeInTheDocument()
    expect(within(memberRow('Миша')).queryByText(/день рождения/)).not.toBeInTheDocument()
    expect(within(memberRow('Миша')).queryByText('Скоро ДР')).not.toBeInTheDocument()
  })

  it('mounts the aside: the birthday note, the surprise rule, the favourites link', async () => {
    seedRegistry()
    // The note is rendered beside the prototype's: the birthday in three
    // weeks, the ideas already in the list. The calendar's own «Люда —
    // зубной врач» is no birthday and lights nothing.
    await applySyncResult(
      ME,
      syncResult(
        [
          wish({ id: '01900000-0000-7000-8000-000000000321', authorId: LYUDA, title: 'Шаль' }),
          wish({ id: '01900000-0000-7000-8000-000000000322', authorId: LYUDA, title: 'Чайник' }),
          wish({ id: '01900000-0000-7000-8000-000000000323', authorId: LYUDA, title: 'Свечи' }),
        ],
        [
          { entity: 'calendar_event', event: birthdayEvent(21) },
          {
            entity: 'calendar_event',
            event: {
              ...birthdayEvent(21),
              id: '01900000-0000-7000-8000-000000000402',
              title: 'Люда — зубной врач',
            },
          },
          {
            entity: 'wishlist_gift_favorite',
            favorite: favorite({ wishId: '01900000-0000-7000-8000-000000000321' }),
          },
        ],
      ),
    )
    mockQuietSync()
    const { container } = renderWithProviders(<WishlistsScreen />)

    await screen.findByText('Правило сюрприза')
    expect(screen.getByText(/Бронь видна всем, кроме автора списка/)).toBeInTheDocument()
    // The note names the event as its creator wrote it and the ideas
    // already in Люда's list; the row's status line shares the countdown,
    // so the assertions scope to the note block.
    const noteBlock = container.querySelector('[data-slot="note-block"]')
    expect(noteBlock).not.toBeNull()
    const note = within(noteBlock as HTMLElement)
    expect(note.getByText(/День рождения Люды — /)).toBeInTheDocument()
    expect(note.getByText(/через 21 день/)).toBeInTheDocument()
    expect(note.getByText(/В списке уже 3 идеи/)).toBeInTheDocument()
    // The favourites row leads with its bare accent heart and counts the
    // saved ideas honestly.
    expect(screen.getByText('Мои избранные идеи')).toBeInTheDocument()
    expect(screen.getByText(/1 идея · видно только вам/)).toBeInTheDocument()
  })

  it('mounts the birthday note only while a birthday is near', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    await screen.findByText('Правило сюрприза')
    expect(screen.queryByText(/День рождения/)).not.toBeInTheDocument()
    // The surprise rule and the favourites link do not depend on it.
    expect(screen.getByText('Мои избранные идеи')).toBeInTheDocument()
  })

  it('never paints the reader their own birthday', async () => {
    seedRegistry()
    // Аня's own birthday is near: the note is an errand for the reader,
    // and their own birthday is nobody's errand to run — no note, no
    // countdown, though the event is real and near.
    await applySyncResult(
      ME,
      syncResult(
        [wish()],
        [
          {
            entity: 'calendar_event',
            event: { ...birthdayEvent(3), title: 'День рождения Ани' },
          },
        ],
      ),
    )
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    await screen.findByText('Правило сюрприза')
    expect(screen.queryByText(/День рождения Ани/)).not.toBeInTheDocument()
  })

  it("lays the screen out as the prototype's 1.6fr / 1fr grid from 920px", async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    mockQuietSync()
    const { container } = renderWithProviders(<WishlistsScreen />)

    await screen.findByText('Правило сюрприза')
    const grid = container.querySelector('[class*="grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"]')
    expect(grid).not.toBeNull()
    // The aside is sticky on desktop, like the prototype's diary-aside.
    const aside = grid?.querySelector('aside')
    expect(aside?.className).toContain('desktop:sticky')
  })

  it('says the space has no other members yet', async () => {
    seedRegistry()
    await applySyncResult(ME, syncResult([wish()]))
    // A fresh partition carries only Аня: strip the other profiles out.
    await applySyncResult(ME, {
      revision: '8',
      changes: [],
      tombstones: PROFILES.filter((profile) => profile.id !== ME).map((profile) => ({
        entity: 'member' as const,
        entityId: profile.id,
        audience: 'all' as const,
      })),
    })
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    expect(await screen.findByText('Пока вы одни в пространстве')).toBeInTheDocument()
  })

  it('says that nothing is available offline when nothing is downloaded', async () => {
    seedRegistry()
    mockQuietSync()
    renderWithProviders(<WishlistsScreen />)

    expect(await screen.findByText('Пока нечего читать без сети')).toBeInTheDocument()
  })
})
