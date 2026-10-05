import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminLayout } from './admin-layout.tsx'

/*
 * The administrative bar carries the theme toggle (issue #63): the
 * prototype's `.btn-icon.btn-sm` — a 36px round icon button at the end
 * of the bar, after the caller's actions — and its press switches the
 * theme in place, exactly like everywhere else.
 */

// A press stores the choice per device; the leak would flip the tests
// that follow this file's order.
afterEach(() => {
  window.localStorage.clear()
})

describe('AdminLayout', () => {
  it('ends the bar with a 36px round theme toggle', () => {
    renderWithProviders(
      <AdminLayout>
        <p>Пространства</p>
      </AdminLayout>,
    )

    expect(screen.getByRole('button', { name: 'Тёмная тема' })).toHaveClass('size-9')
  })

  it('keeps the caller’s actions before the toggle', () => {
    renderWithProviders(
      <AdminLayout actions={<button type="button">Настройки</button>}>
        <p>Пространства</p>
      </AdminLayout>,
    )

    const bar = screen.getByRole('banner')
    expect(bar.textContent).toContain('Настройки')
    // The toggle closes the bar: it is the banner's last button.
    const buttons = within(bar).getAllByRole('button')
    expect(buttons.at(-1)).toHaveAccessibleName('Тёмная тема')
  })

  it('switches the theme from the administrative bar', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AdminLayout>
        <p>Пространства</p>
      </AdminLayout>,
    )

    await user.click(screen.getByRole('button', { name: 'Тёмная тема' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
