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
  // The browser-chrome test injects index.html's metas into jsdom's
  // shared document.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.remove()
  })
})

describe('ThemeToggle', () => {
  it('offers the dark theme while light and switches in place', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Тёмная тема' })).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(screen.getByRole('button', { name: 'Тёмная тема' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    // The choice is stored per device, so the next visit opens dark.
    expect(window.localStorage.getItem('ohana.theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Светлая тема' })).toBeInTheDocument()
  })

  it('opens on a stored choice and offers the way back', () => {
    window.localStorage.setItem('ohana.theme', 'dark')
    renderWithProviders(<ThemeToggle />)

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Светлая тема' })).toBeInTheDocument()
  })

  it('names the themes in English (en)', () => {
    window.localStorage.setItem('ohana.locale', 'en')
    renderWithProviders(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument()
  })

  it('follows the choice in the browser-chrome colour too', async () => {
    const user = userEvent.setup()
    // index.html's two media-keyed metas; the provider collapses them
    // onto the resolved theme's colour (app/theme.tsx).
    for (const scheme of ['light', 'dark'] as const) {
      const meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      meta.setAttribute('media', `(prefers-color-scheme: ${scheme})`)
      meta.setAttribute('content', scheme === 'dark' ? 'rgb(117 34 49)' : 'rgb(246 241 238)')
      document.head.appendChild(meta)
    }
    renderWithProviders(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'Тёмная тема' }))

    const metas = [...document.querySelectorAll('meta[name="theme-color"]')]
    expect(metas.map((meta) => meta.getAttribute('content'))).toEqual([
      'rgb(117 34 49)',
      'rgb(117 34 49)',
    ])
    expect(metas[0]).not.toHaveAttribute('media')
  })
})
