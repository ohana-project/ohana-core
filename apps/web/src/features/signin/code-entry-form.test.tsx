import { useQueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { useRedeemedSignIn } from '@/features/member/use-member-session.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { CodeEntryForm } from './code-entry-form.tsx'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const apiPost = vi.mocked(api.POST)

const REDEEM_RESULT = {
  member: { id: 'm-1', name: 'Аня', role: 'regular' as const },
  space: { id: 's-1', name: 'Наша семья' },
  needsOnboarding: true,
}

function errorResponse(status: number, code: string) {
  return {
    data: undefined,
    error: { error: { code, message: 'The code is wrong' } },
    response: new Response(null, { status }),
  }
}

describe('CodeEntryForm', () => {
  beforeEach(() => {
    window.localStorage.clear()
    apiPost.mockReset()
  })

  it('renders the reference copy', () => {
    renderWithCodeEntryForm()
    expect(screen.getByRole('heading', { name: 'Код входа' })).toBeInTheDocument()
    expect(screen.getByLabelText('Код входа')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()
  })

  it('asks for the code before calling the API when the field is short', async () => {
    const user = userEvent.setup()
    renderWithCodeEntryForm()

    await user.type(screen.getByLabelText('Код входа'), 'ABC')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Введите код входа.')
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('sends the code, stores the sign-in, and reports success', async () => {
    apiPost.mockResolvedValue({
      data: REDEEM_RESULT,
      error: undefined,
      response: new Response(null, { status: 200 }),
    })
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    renderWithCodeEntryForm(onSignedIn)

    await user.type(screen.getByLabelText('Код входа'), 'QWEE4455')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/access-codes/redeem',
      expect.objectContaining({ body: { code: 'QWEE4455' } }),
    )
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(REDEEM_RESULT))
    // The registry remembers the sign-in; the cookie stays with the browser.
    expect(window.localStorage.getItem('ohana.activeMember')).toBe('m-1')
    const sessions = JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')
    expect(sessions).toEqual([
      { memberId: 'm-1', spaceId: 's-1', spaceName: 'Наша семья', name: 'Аня' },
    ])
  })

  it('marks the field invalid and explains a wrong code', async () => {
    apiPost.mockResolvedValue(errorResponse(401, 'access_code_invalid'))
    const user = userEvent.setup()
    renderWithCodeEntryForm()

    await user.type(screen.getByLabelText('Код входа'), 'QWEE4455')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Такого кода нет')
    expect(screen.getByLabelText('Код входа').closest('[data-slot=field]')).toHaveAttribute(
      'data-invalid',
      'true',
    )
  })

  it('explains an expired code', async () => {
    apiPost.mockResolvedValue(errorResponse(410, 'access_code_expired'))
    const user = userEvent.setup()
    renderWithCodeEntryForm()

    await user.type(screen.getByLabelText('Код входа'), 'QWEE4455')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Код истёк')
  })

  it('shows a network-neutral message when the API code is unknown', async () => {
    apiPost.mockRejectedValue(new TypeError('Network unreachable'))
    const user = userEvent.setup()
    renderWithCodeEntryForm()

    await user.type(screen.getByLabelText('Код входа'), 'QWEE4455')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не получилось — проверьте сеть и попробуйте ещё раз.',
    )
  })
})

function renderWithCodeEntryForm(onSignedIn?: (result: unknown) => void) {
  return renderWithProviders(<CodeEntryForm onSignedIn={onSignedIn ?? (() => {})} />)
}

/*
 * Adding a sign-in is also a cache-boundary event (ADR-0005): another
 * member's sign-in must leave no cached answer of the previous member in
 * place, while the same member's extra device session changes nothing
 * member-scoped. The probe captures the providers' query client so the
 * test can seed and inspect the cache directly.
 */

const SPACE = { id: 's-1', name: 'Наша семья' }
const PROFILES_KEY = ['member', 'm-1', 'profiles'] as const
const PROFILES = [{ id: 'm-1', name: 'Аня' }]

let probeClient: ReturnType<typeof useQueryClient> | undefined

function SignInProbe({ member }: { member: { id: string; name: string } }) {
  const signIn = useRedeemedSignIn()
  probeClient = useQueryClient()
  return (
    <button type="button" onClick={() => void signIn({ ...member }, SPACE)}>
      sign-in
    </button>
  )
}

function mockRedeemFor(memberId: string) {
  apiPost.mockResolvedValue({
    data: {
      member: { id: memberId, name: 'Аня', role: 'regular' as const },
      space: SPACE,
      needsOnboarding: false,
    },
    error: undefined,
    response: new Response(null, { status: 200 }),
  })
}

describe('useRedeemedSignIn cache boundaries', () => {
  beforeEach(() => {
    window.localStorage.clear()
    apiPost.mockReset()
    probeClient = undefined
  })

  it('wipes the previous member’s cached answers when another member signs in', async () => {
    window.localStorage.setItem('ohana.activeMember', 'm-1')
    mockRedeemFor('m-2')
    const user = userEvent.setup()
    renderWithProviders(<SignInProbe member={{ id: 'm-2', name: 'Аня' }} />)

    probeClient?.setQueryData(PROFILES_KEY, PROFILES)
    await user.click(screen.getByRole('button', { name: 'sign-in' }))

    await vi.waitFor(() => expect(window.localStorage.getItem('ohana.activeMember')).toBe('m-2'))
    expect(probeClient?.getQueryData(PROFILES_KEY)).toBeUndefined()
  })

  it('keeps the cache when the same member adds a device session', async () => {
    window.localStorage.setItem('ohana.activeMember', 'm-1')
    mockRedeemFor('m-1')
    const user = userEvent.setup()
    renderWithProviders(<SignInProbe member={{ id: 'm-1', name: 'Аня' }} />)

    probeClient?.setQueryData(PROFILES_KEY, PROFILES)
    await user.click(screen.getByRole('button', { name: 'sign-in' }))

    await vi.waitFor(() => expect(window.localStorage.getItem('ohana.activeMember')).toBe('m-1'))
    expect(probeClient?.getQueryData(PROFILES_KEY)).toEqual(PROFILES)
  })
})
