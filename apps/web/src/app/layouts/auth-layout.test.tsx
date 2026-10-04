import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { AuthLayout } from './auth-layout.tsx'

/*
 * Every sign-in screen carries the theme toggle (issue #63): the
 * prototype pins a round icon button at the top right of the viewport —
 * code entry, install-first, onboarding, accounts, and the admin sign-in
 * share this one layout, so they all get it here.
 */

describe('AuthLayout', () => {
  it('pins the round theme toggle at the top right of the viewport', () => {
    renderWithProviders(
      <AuthLayout>
        <p>Код входа</p>
      </AuthLayout>,
    )

    expect(screen.getByRole('button', { name: 'Тёмная тема' })).toHaveClass(
      'fixed',
      'top-3.5',
      'right-3.5',
      'z-10',
    )
  })

  it('switches the theme in place from the sign-in screen', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AuthLayout>
        <p>Код входа</p>
      </AuthLayout>,
    )

    await user.click(screen.getByRole('button', { name: 'Тёмная тема' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('ohana.theme')).toBe('dark')
    expect(screen.getByText('Код входа')).toBeInTheDocument()
  })
})
