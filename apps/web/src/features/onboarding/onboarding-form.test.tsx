import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { OnboardingForm } from './onboarding-form.tsx'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const apiPost = vi.mocked(api.POST)

const ME = {
  member: {
    id: 'm-1',
    name: 'Аня',
    role: 'regular' as const,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  space: { id: 's-1', name: 'Наша семья' },
  needsOnboarding: true,
}

describe('OnboardingForm', () => {
  beforeEach(() => {
    window.localStorage.clear()
    apiPost.mockReset()
  })

  it('renders the reference copy with the space footer data', () => {
    renderWithOnboardingForm()
    expect(screen.getByRole('heading', { name: 'Как вас назовут в семье?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Имя')).toBeInTheDocument()
    expect(screen.getByLabelText('Эл. почта')).toBeInTheDocument()
    expect(screen.getByLabelText('Телефон')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument()
  })

  it('leads with the space meta line above the display heading', () => {
    renderWithOnboardingForm()

    const meta = screen.getByText('Пространство «Наша семья» · Шаг 2 из 2')
    expect(meta).toHaveClass('font-mono', 'text-meta', 'uppercase')
    const heading = screen.getByRole('heading', { name: 'Как вас назовут в семье?' })
    expect(heading).toHaveClass('text-display')
    expect(meta.nextElementSibling).toBe(heading)
  })

  it('shows the reference placeholders', () => {
    renderWithOnboardingForm()

    expect(screen.getByLabelText('Имя')).toHaveAttribute('placeholder', 'Например: Аня')
    expect(screen.getByLabelText('Эл. почта')).toHaveAttribute('placeholder', 'anechka@mail.ru')
    expect(screen.getByLabelText('Телефон')).toHaveAttribute('placeholder', '+7 900 000-00-00')
  })

  it('hints under the contacts with a lock', () => {
    renderWithOnboardingForm()

    const hint = screen.getByText('Необязательно. Видны только вашей семье — и никому больше.')
    expect(hint).toHaveClass('text-meta')
    expect(hint.querySelector('svg')).not.toBeNull()
  })

  it('picks the language from two full-width choice cards with Russian preselected', () => {
    renderWithOnboardingForm()

    const group = screen.getByRole('radiogroup', { name: 'Язык интерфейса' })
    const russian = screen.getByRole('radio', { name: 'Русский' })
    const english = screen.getByRole('radio', { name: 'English' })
    expect(russian).toBeChecked()
    expect(english).not.toBeChecked()
    expect(group).toContainElement(russian)
    // The card around each radio is a 56px choice card with a globe.
    const card = russian.closest('label')
    expect(card).toHaveClass('min-h-14')
    expect(card).toHaveTextContent('Русский')
    expect(card?.querySelector('svg')).not.toBeNull()
  })

  it('submits the optional profile and finishes onboarding', async () => {
    apiPost.mockResolvedValue({
      data: { ...ME, needsOnboarding: false },
      error: undefined,
      response: new Response(null, { status: 200 }),
    })
    const onCompleted = vi.fn()
    const user = userEvent.setup()
    // The sign-in preceded onboarding, so the registry already holds it.
    window.localStorage.setItem(
      'ohana.sessions',
      JSON.stringify([{ memberId: 'm-1', spaceId: 's-1', spaceName: 'Наша семья', name: 'Аня' }]),
    )
    window.localStorage.setItem('ohana.activeMember', 'm-1')
    renderWithOnboardingForm(onCompleted)

    await user.type(screen.getByLabelText('Имя'), 'Аня Смирнова')
    await user.type(screen.getByLabelText('Эл. почта'), 'anya@example.com')
    await user.type(screen.getByLabelText('Телефон'), '+7 900 000-00-00')
    await user.click(screen.getByRole('radio', { name: 'Русский' }))
    await user.click(screen.getByRole('button', { name: 'Продолжить' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/me/onboarding',
      expect.objectContaining({
        body: {
          displayName: 'Аня Смирнова',
          email: 'anya@example.com',
          phone: '+7 900 000-00-00',
          interfaceLanguage: 'ru',
        },
      }),
    )
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
    const sessions = JSON.parse(window.localStorage.getItem('ohana.sessions') ?? '[]')
    expect(sessions[0]).toMatchObject({ memberId: 'm-1', displayName: 'Аня Смирнова' })
  })

  it('submits an empty profile as an all-optional onboarding, language included', async () => {
    apiPost.mockResolvedValue({
      data: { ...ME, needsOnboarding: false },
      error: undefined,
      response: new Response(null, { status: 200 }),
    })
    const onCompleted = vi.fn()
    const user = userEvent.setup()
    renderWithOnboardingForm(onCompleted)

    await user.click(screen.getByRole('button', { name: 'Продолжить' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/me/onboarding',
      expect.objectContaining({
        body: {
          displayName: undefined,
          email: undefined,
          phone: undefined,
          interfaceLanguage: 'ru',
        },
      }),
    )
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
  })

  it('explains a validation refusal inline', async () => {
    apiPost.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'validation_failed', message: 'Check the fields' } },
      response: new Response(null, { status: 400 }),
    })
    const user = userEvent.setup()
    renderWithOnboardingForm()

    await user.type(screen.getByLabelText('Эл. почта'), ' a ')
    await user.click(screen.getByRole('button', { name: 'Продолжить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Проверьте поля — некоторые значения не подходят.',
    )
  })
})

function renderWithOnboardingForm(onCompleted?: () => void) {
  return renderWithProviders(<OnboardingForm me={ME} onCompleted={onCompleted ?? (() => {})} />)
}
