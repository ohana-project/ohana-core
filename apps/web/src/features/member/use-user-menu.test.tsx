import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { closeSpacesSheet, SpacesSheet } from '@/features/accounts/spaces-sheet.tsx'
import { renderWithProviders } from '@/testing/render.tsx'
import { useMemberUserMenu } from './use-user-menu.ts'

/*
 * The user menu every member shell carries (issue #63): the member's
 * destinations first, then the prototype's pair — «Тема», whose icon
 * follows the current theme and whose press switches it in place, and
 * «Сменить пространство», which opens the «Пространства» sheet
 * (issue #64) — then the way out. The prototype's separators
 * divide the three groups.
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const navigate = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  // The sheet the probe mounts renders a Link to the code screen; a plain
  // anchor stands in for the router's (issue #64).
  Link: (props: { to: string; children?: React.ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

const ANYA = {
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Аня',
  displayName: 'Аня Смирнова',
  role: 'owner' as const,
  createdAt: '2026-08-12T10:00:00.000Z',
}

function Probe() {
  const items = useMemberUserMenu()
  return (
    <div>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {/* The shells wire the item's onSelect to the menu row; the probe
                does the same, so the presses land on the hook's callbacks. */}
            <button type="button" data-testid={`menu-${item.id}`} onClick={item.onSelect}>
              {item.label}
              {item.danger ? ' danger' : ''}
              {item.separatorBefore ? ' |—' : ''}
            </button>
            <span data-testid={`icon-${item.id}`}>{item.icon}</span>
            {item.ariaLabel && <span data-testid={`aria-${item.id}`}>{item.ariaLabel}</span>}
          </li>
        ))}
      </ul>
      {/* The sheet rides the gate in the app; the probe mounts it so the
          menu item's press has somewhere to land. */}
      <SpacesSheet />
    </div>
  )
}

function seedSignedIn(role: 'owner' | 'regular' = 'owner') {
  window.localStorage.setItem('ohana.activeMember', ANYA.id)
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: ANYA.id,
        spaceId: '01900000-0000-7000-8000-00000000000a',
        spaceName: 'Наша семья',
        name: 'Аня',
        displayName: 'Аня Смирнова',
      },
    ]),
  )
  vi.mocked(api.GET).mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') {
      return {
        data: {
          member: { ...ANYA, role },
          space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
          needsOnboarding: false,
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

afterEach(() => {
  window.localStorage.clear()
  window.indexedDB = new IDBFactory()
  closeSpacesSheet()
  navigate.mockClear()
  vi.clearAllMocks()
})

describe('useMemberUserMenu', () => {
  it('builds the prototype’s three groups for an owner', async () => {
    seedSignedIn('owner')
    renderWithProviders(<Probe />)

    expect(await screen.findByText('Участники')).toBeInTheDocument()

    expect(screen.getByTestId('menu-members').textContent).toMatch(/^Участники/)
    expect(screen.getByTestId('menu-space-settings')).toBeInTheDocument()
    expect(screen.getByTestId('menu-notifications')).toBeInTheDocument()
    // The prototype's pair sits between the destinations and the way out,
    // with the hairlines of the «Профиль, Настройки | Тема, Сменить
    // пространство | Выйти» grouping.
    expect(screen.getByTestId('menu-theme').textContent).toContain('Тема')
    expect(screen.getByTestId('menu-theme').textContent).toContain('|—')
    expect(screen.getByTestId('icon-theme').textContent).toBe('moon')
    // The accessible name names the theme the press leads to, like the
    // prototype's `data-action="theme"` buttons.
    expect(screen.getByTestId('aria-theme').textContent).toBe('Тёмная тема')
    expect(screen.getByTestId('menu-switch-space').textContent).toContain('Сменить пространство')
    expect(screen.getByTestId('icon-switch-space').textContent).toBe('repeat')
    expect(screen.getByTestId('menu-switch-space').textContent).not.toContain('|—')
    expect(screen.getByTestId('menu-sign-out').textContent).toContain('|—')
    expect(screen.getByTestId('menu-sign-out').textContent).toContain('danger')
  })

  it('keeps the pair for a regular member, who has no space settings', async () => {
    seedSignedIn('regular')
    renderWithProviders(<Probe />)

    expect(await screen.findByText('Участники')).toBeInTheDocument()
    expect(screen.queryByTestId('menu-space-settings')).not.toBeInTheDocument()
    expect(screen.getByTestId('menu-theme')).toBeInTheDocument()
    expect(screen.getByTestId('menu-switch-space')).toBeInTheDocument()
    expect(screen.getByTestId('menu-sign-out')).toBeInTheDocument()
  })

  it('switches the theme in place from the menu item', async () => {
    const user = userEvent.setup()
    seedSignedIn('owner')
    renderWithProviders(<Probe />)

    await screen.findByText('Участники')
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(screen.getByTestId('menu-theme'))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('ohana.theme')).toBe('dark')
    expect(navigate).not.toHaveBeenCalled()
    // The icon follows the theme it now offers.
    expect(screen.getByTestId('icon-theme').textContent).toBe('sun')
    expect(screen.getByTestId('aria-theme').textContent).toBe('Светлая тема')
  })

  it('«Сменить пространство» opens the Spaces sheet', async () => {
    const user = userEvent.setup()
    seedSignedIn('owner')
    renderWithProviders(<Probe />)

    await screen.findByText('Участники')
    await user.click(screen.getByTestId('menu-switch-space'))

    // The sheet opens in place (issue #64); the accounts screen is no
    // longer the item's target.
    expect(await screen.findByRole('heading', { name: 'Пространства', level: 2 })).toBeVisible()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('the theme icon follows a stored dark choice', async () => {
    window.localStorage.setItem('ohana.theme', 'dark')
    seedSignedIn('owner')
    renderWithProviders(<Probe />)

    expect(await screen.findByText('Участники')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByTestId('icon-theme').textContent).toBe('sun')
    expect(screen.getByTestId('aria-theme').textContent).toBe('Светлая тема')
  })
})
