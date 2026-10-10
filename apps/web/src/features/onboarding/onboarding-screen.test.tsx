import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '@/app/providers.tsx'
import { api } from '@/data/api.ts'
import { memberSessionQueryKey } from '@/features/member/use-member-session.ts'
import { OnboardingScreen } from './onboarding-screen.tsx'

vi.mock('@tanstack/react-router', () => ({
  Navigate: (props: { to: string }) => <a href={props.to}>navigate</a>,
  useNavigate: () => async () => {},
  // The gate carries the Spaces sheet (issue #64), whose «Войти по коду»
  // is a Link; a plain anchor stands in for the router's.
  Link: (props: { to: string; children?: React.ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const apiGet = vi.mocked(api.GET)
const apiPost = vi.mocked(api.POST)

const ME = {
  member: {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'Аня',
    interfaceLanguage: undefined as 'ru' | 'en' | undefined,
    role: 'regular' as const,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  space: { id: '01900000-0000-7000-8000-00000000000a', name: 'Наша семья' },
  needsOnboarding: true,
}

const ok = {
  data: { ...ME, needsOnboarding: false },
  error: undefined,
  response: new Response(null, { status: 200 }),
}

/** The probe's answer and the sync's empty delta, over the one mock. */
function mockProbe(me: typeof ME) {
  // The mock reads through a holder, so a later mockProbe call moves the
  // answer in place — how a member switch reaches the same query.
  currentMe = me
  apiGet.mockImplementation(async (path: never) => {
    if (path === '/api/v1/sync') {
      return {
        data: { revision: 0, changes: [], tombstones: [] },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    }
    if (path === '/api/v1/me') {
      return { data: currentMe, error: undefined, response: new Response(null, { status: 200 }) }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

let currentMe: typeof ME

/**
 * The device presents its languages through navigator; the tests pin them
 * per scenario (jsdom speaks en-US otherwise, and the suite's Russian
 * screens would silently turn English).
 */
function stubDeviceLocale(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  })
}

/*
 * The screen owns the probe and the draft, so this suite drives both:
 * the probe is answered through the mocked API and captured query
 * client (the member session tests' seam), and a refetch invalidation
 * stands in for the gate's spinner swaps.
 */

let client: QueryClient | undefined

function Capture() {
  client = useQueryClient()
  return null
}

function renderOnboardingScreen() {
  return render(
    <AppProviders>
      <Capture />
      <OnboardingScreen />
    </AppProviders>,
  )
}

function probe(): QueryClient {
  if (client === undefined) throw new Error('The screen never mounted')
  return client
}

describe('OnboardingScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    stubDeviceLocale(['ru-RU'])
    // The probe asks the registry first: an active member makes it fetch.
    window.localStorage.setItem(
      'ohana.sessions',
      JSON.stringify([
        {
          memberId: ME.member.id,
          spaceId: ME.space.id,
          spaceName: ME.space.name,
          name: ME.member.name,
        },
      ]),
    )
    window.localStorage.setItem('ohana.activeMember', ME.member.id)
    apiGet.mockReset()
    apiPost.mockReset()
    client = undefined
    mockProbe(ME)
  })

  it('seeds the draft from the stored preference, interface included', async () => {
    mockProbe({ ...ME, member: { ...ME.member, interfaceLanguage: 'en' } })
    apiPost.mockResolvedValue(ok)
    const user = userEvent.setup()
    renderOnboardingScreen()

    expect(
      await screen.findByRole('heading', { name: 'How will the family call you?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    expect(window.localStorage.getItem('ohana.locale')).toBe('en')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/me/onboarding',
      expect.objectContaining({ body: expect.objectContaining({ interfaceLanguage: 'en' }) }),
    )
  })

  it('lets the member choose the other card over a stored preference, and the choice survives a refetch', async () => {
    mockProbe({ ...ME, member: { ...ME.member, interfaceLanguage: 'en' } })
    apiPost.mockResolvedValue(ok)
    const user = userEvent.setup()
    renderOnboardingScreen()
    await screen.findByRole('heading', { name: 'How will the family call you?' })

    // The stored preference applies once on arrival; the member's own
    // choice of the other card wins.
    await user.click(screen.getByRole('radio', { name: 'Русский' }))
    expect(
      await screen.findByRole('heading', { name: 'Как вас назовут в семье?' }),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem('ohana.locale')).toBe('ru')

    // The member also typed while the stored preference was applied; a
    // probe refetch swaps the gate's children for a spinner and back,
    // and the draft above the gate survives it.
    await user.type(screen.getByLabelText('Имя'), 'Аня')
    await probe().invalidateQueries({ queryKey: memberSessionQueryKey })
    expect(
      await screen.findByRole('heading', { name: 'Как вас назовут в семье?' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Имя')).toHaveValue('Аня')
    expect(screen.getByRole('radio', { name: 'Русский' })).toBeChecked()
    expect(window.localStorage.getItem('ohana.locale')).toBe('ru')

    await user.click(screen.getByRole('button', { name: 'Продолжить' }))
    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/me/onboarding',
      expect.objectContaining({ body: expect.objectContaining({ interfaceLanguage: 'ru' }) }),
    )
  })

  it('renders the form in the device locale when no preference is stored', async () => {
    renderOnboardingScreen()

    expect(
      await screen.findByRole('heading', { name: 'Как вас назовут в семье?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Русский' })).toBeChecked()
    expect(window.localStorage.getItem('ohana.locale')).toBeNull()
  })

  it('applies an English device to the whole interface when no preference is stored', async () => {
    stubDeviceLocale(['en-US'])
    renderOnboardingScreen()

    expect(
      await screen.findByRole('heading', { name: 'How will the family call you?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    // The device's locale is the device's own choice: it sticks for the
    // rest of the app, the way a member's stored preference does.
    expect(window.localStorage.getItem('ohana.locale')).toBe('en')
  })

  it('reseeds the draft empty when the active member changes', async () => {
    const user = userEvent.setup()
    renderOnboardingScreen()
    await screen.findByRole('heading', { name: 'Как вас назовут в семье?' })
    await user.type(screen.getByLabelText('Имя'), 'Аня')

    // The accounts screen's switch resets every query; the probe next
    // answers for the member who became active.
    const other = {
      ...ME,
      member: { ...ME.member, id: '01900000-0000-7000-8000-000000000002', name: 'Ваня' },
    }
    window.localStorage.setItem(
      'ohana.sessions',
      JSON.stringify([
        {
          memberId: ME.member.id,
          spaceId: ME.space.id,
          spaceName: ME.space.name,
          name: ME.member.name,
        },
        {
          memberId: other.member.id,
          spaceId: other.space.id,
          spaceName: other.space.name,
          name: other.member.name,
        },
      ]),
    )
    window.localStorage.setItem('ohana.activeMember', other.member.id)
    mockProbe(other)
    act(() => {
      probe().resetQueries()
    })

    // No member reads or submits another's entries: the form arrives
    // empty for the member it now belongs to.
    expect(
      await screen.findByRole('heading', { name: 'Как вас назовут в семье?' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Имя')).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'Русский' })).toBeChecked()
  })

  it('sends a member that has already onboarded home', async () => {
    mockProbe({ ...ME, needsOnboarding: false })
    renderOnboardingScreen()

    expect(await screen.findByRole('link', { name: 'navigate' })).toHaveAttribute('href', '/')
    expect(
      screen.queryByRole('heading', { name: 'Как вас назовут в семье?' }),
    ).not.toBeInTheDocument()
  })
})
