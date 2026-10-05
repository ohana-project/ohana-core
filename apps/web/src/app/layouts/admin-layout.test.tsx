import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminLayout } from './admin-layout.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

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

  it('keeps the bar at the prototype’s 56px with the 16.5px word mark', () => {
    renderWithProviders(
      <AdminLayout>
        <p>Пространства</p>
      </AdminLayout>,
    )

    const bar = screen.getByRole('banner')
    expect(bar).toHaveClass('min-h-14')
    // The word mark is the prototype's .admin-word (16.5px), outside the
    // type scale like the button sizes.
    expect(within(bar).getByText('Ohana · Админка')).toHaveClass('text-[16.5px]')
  })

  it('swaps the logo for the back link on a space’s screen', () => {
    renderWithProviders(
      <AdminLayout back>
        <p>Пространство</p>
      </AdminLayout>,
    )

    const bar = screen.getByRole('banner')
    // «‹ Пространства» leads back to the list; the lockup is gone.
    const link = within(bar).getByRole('link', { name: 'Пространства' })
    expect(link).toHaveAttribute('href', '/admin')
    // The link answers a hover and sits at the bar's 36px action height.
    expect(link).toHaveClass('min-h-9', 'hover:text-foreground')
    expect(within(bar).queryByText('Ohana · Админка')).not.toBeInTheDocument()
  })

  it('keeps the back link’s chevron at the bar’s 18px', () => {
    renderWithProviders(
      <AdminLayout back>
        <p>Пространство</p>
      </AdminLayout>,
    )

    const link = screen.getByRole('link', { name: 'Пространства' })
    const icon = link.querySelector('svg')
    expect(icon).toHaveAttribute('width', '18')
    expect(icon).toHaveAttribute('height', '18')
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
