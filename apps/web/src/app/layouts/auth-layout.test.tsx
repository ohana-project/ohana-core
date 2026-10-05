import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { AuthLayout } from './auth-layout.tsx'

/*
 * Every sign-in screen carries the theme toggle (issue #63): the
 * prototype pins a round icon button at the top right of the viewport —
 * code entry, install-first, onboarding, accounts, and the admin sign-in
 * share this one layout, so they all get it here.
 */

// A press stores the choice per device; the leak would flip the tests
// that follow this file's order.
afterEach(() => {
  window.localStorage.clear()
})

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

  it('keeps the footer note inside the 420px column, like the prototype’s .auth-foot', () => {
    renderWithProviders(
      <AuthLayout footer="Забыли пароль? Он хранится только на вашем сервере.">
        <p>Сервер под паролем</p>
      </AuthLayout>,
    )

    const note = screen.getByText('Забыли пароль? Он хранится только на вашем сервере.')
    const column = note.closest('div')
    expect(column).toHaveClass('max-w-[420px]')
    // The note follows the screen's content inside the column…
    expect(column).toHaveTextContent('Сервер под паролем')
    // …so nothing sits between them.
    expect(note.previousElementSibling?.textContent).toBe('Сервер под паролем')
  })

  it('drops the frame’s centred logo where a screen brings its own brand row', () => {
    renderWithProviders(
      <AuthLayout logo={false}>
        <p>Сервер под паролем</p>
      </AuthLayout>,
    )

    expect(screen.queryByText('Ohana')).not.toBeInTheDocument()
  })
})
