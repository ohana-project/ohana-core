import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminLoginForm } from './admin-login-form.tsx'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const apiPost = vi.mocked(api.POST)

function errorResponse(status: number, code: string) {
  return {
    data: undefined,
    error: { error: { code, message: 'The password is wrong' } },
    response: new Response(null, { status }),
  }
}

describe('AdminLoginForm', () => {
  it('renders the reference copy', () => {
    renderWithLoginForm()
    expect(screen.getByRole('heading', { name: 'Сервер под паролем' })).toBeInTheDocument()
    expect(screen.getByLabelText('Пароль администратора')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Войти в админку' })).toBeInTheDocument()
  })

  it('sends the password and reports success to the caller', async () => {
    apiPost.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    renderWithLoginForm(onSignedIn)

    await user.type(screen.getByLabelText('Пароль администратора'), 'a-long-server-password')
    await user.click(screen.getByRole('button', { name: 'Войти в админку' }))

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/admin/session',
      expect.objectContaining({
        body: { password: 'a-long-server-password' },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled())
  })

  it('marks the field invalid and explains a wrong password', async () => {
    apiPost.mockResolvedValue(errorResponse(401, 'invalid_credentials'))
    const user = userEvent.setup()
    renderWithLoginForm()

    await user.type(screen.getByLabelText('Пароль администратора'), 'a-wrong-password')
    await user.click(screen.getByRole('button', { name: 'Войти в админку' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Неверный пароль — попробуйте ещё раз',
    )
    expect(
      screen.getByLabelText('Пароль администратора').closest('[data-slot=field]'),
    ).toHaveAttribute('data-invalid', 'true')
  })

  it('shows a network-neutral message when the API code is unknown', async () => {
    apiPost.mockRejectedValue(new TypeError('Network unreachable'))
    const user = userEvent.setup()
    renderWithLoginForm()

    await user.type(screen.getByLabelText('Пароль администратора'), 'a-long-server-password')
    await user.click(screen.getByRole('button', { name: 'Войти в админку' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не получилось — проверьте сеть и попробуйте ещё раз.',
    )
  })
})

function renderWithLoginForm(onSignedIn?: () => void) {
  return renderWithProviders(<AdminLoginForm onSignedIn={onSignedIn} />)
}
