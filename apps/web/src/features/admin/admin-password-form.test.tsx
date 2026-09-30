import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminPasswordForm } from './admin-password-form.tsx'

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const apiPost = vi.mocked(api.POST)

async function fillForm(input: { current?: string; next?: string; repeat?: string }) {
  const user = userEvent.setup()
  if (input.current !== undefined) {
    await user.type(screen.getByLabelText('Текущий пароль'), input.current)
  }
  if (input.next !== undefined) {
    await user.type(screen.getByLabelText('Новый пароль'), input.next)
  }
  if (input.repeat !== undefined) {
    await user.type(screen.getByLabelText('Повторите новый пароль'), input.repeat)
  }
  await user.click(screen.getByRole('button', { name: 'Сменить пароль' }))
}

describe('AdminPasswordForm', () => {
  it('checks the minimum length before calling the API', async () => {
    renderWithProviders(<AdminPasswordForm />)

    await fillForm({ current: 'the-current-one', next: 'short', repeat: 'short' })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Минимум 10 символов — этот сервер виден интернету',
    )
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('requires the repeated password to match', async () => {
    renderWithProviders(<AdminPasswordForm />)

    await fillForm({
      current: 'the-current-one',
      next: 'a-brand-new-password',
      repeat: 'a-typo-happens',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Пароли не совпадают')
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('sends both passwords and confirms with a toast', async () => {
    apiPost.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    renderWithProviders(<AdminPasswordForm />)

    await fillForm({
      current: 'the-current-one',
      next: 'a-brand-new-password',
      repeat: 'a-brand-new-password',
    })

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/admin/password',
      expect.objectContaining({
        body: { currentPassword: 'the-current-one', newPassword: 'a-brand-new-password' },
        headers: expect.objectContaining({ 'x-ohana-admin': '1' }),
      }),
    )
    expect(await screen.findByText('Пароль обновлён — старый больше не действует')).toBeVisible()
  })

  it('explains a wrong current password', async () => {
    apiPost.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'invalid_credentials', message: 'The password is wrong' } },
      response: new Response(null, { status: 401 }),
    })
    renderWithProviders(<AdminPasswordForm />)

    await fillForm({
      current: 'a-wrong-current-password',
      next: 'a-brand-new-password',
      repeat: 'a-brand-new-password',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Неверный пароль — попробуйте ещё раз',
    )
    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/admin/password',
      expect.objectContaining({
        body: { currentPassword: 'a-wrong-current-password', newPassword: 'a-brand-new-password' },
      }),
    )
  })
})
