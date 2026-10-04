import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { ThemeToggle } from './theme-toggle.tsx'

/*
 * The round theme toggle of the shells (issue #63): the glyph shows the
 * theme one tap away — the moon in the light theme, the sun in the dark,
 * like the prototype's `data-action="theme"` buttons — and a press flips
 * the theme in place, no reload and no lost session, persisting the
 * choice per device (app/theme.tsx).
 */

afterEach(() => {
  window.localStorage.clear()
})

describe('ThemeToggle', () => {
  it('offers the dark theme while light and switches in place', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ThemeToggle />)

    const toggle = screen.getByRole('button', { name: 'Тёмная тема' })
    expect(toggle).toHaveAttribute('data-icon', 'moon')
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(toggle)

    expect(document.documentElement.dataset.theme).toBe('dark')
    // The choice is stored per device, so the next visit opens dark.
    expect(window.localStorage.getItem('ohana.theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Светлая тема' })).toHaveAttribute('data-icon', 'sun')
  })

  it('opens on a stored choice and offers the way back', () => {
    window.localStorage.setItem('ohana.theme', 'dark')
    renderWithProviders(<ThemeToggle />)

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Светлая тема' })).toHaveAttribute('data-icon', 'sun')
  })

  it('names the themes in English (en)', () => {
    window.localStorage.setItem('ohana.locale', 'en')
    renderWithProviders(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument()
  })
})
