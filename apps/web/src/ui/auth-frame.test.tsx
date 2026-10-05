import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { AuthFrame } from './auth-frame.tsx'

/*
 * The auth frame (`.auth`/`.auth-card` in the prototype): a centred
 * column — 420px by default, 460px where the prototype says so — with
 * an optional wordmark lockup and a footer note that stays inside the
 * column, like `.auth-foot` inside `.auth-card`.
 */
describe('AuthFrame', () => {
  it('renders the centred logo and the default 420px column with the footer inside it', () => {
    renderWithProviders(
      <AuthFrame footer="Нижняя строка">
        <p>Содержимое</p>
      </AuthFrame>,
    )

    expect(screen.getByText('Ohana')).toBeInTheDocument()
    const column = screen.getByText('Содержимое').parentElement
    expect(column).toHaveClass('max-w-[420px]')
    // The footer note is capped to the column width (`.auth-foot` sits
    // inside `.auth-card`).
    expect(screen.getByText('Нижняя строка').parentElement).toBe(column)
  })

  it('widens the column to 460px where the prototype says so', () => {
    renderWithProviders(
      <AuthFrame columnWidth={460}>
        <p>Содержимое</p>
      </AuthFrame>,
    )

    expect(screen.getByText('Содержимое').parentElement).toHaveClass('max-w-[460px]')
  })

  it('omits the logo for screens whose prototype has none', () => {
    renderWithProviders(
      <AuthFrame logo={false}>
        <p>Содержимое</p>
      </AuthFrame>,
    )

    expect(screen.queryByText('Ohana')).not.toBeInTheDocument()
  })

  it('falls back to the default note when no footer is given', () => {
    renderWithProviders(
      <AuthFrame>
        <p>Содержимое</p>
      </AuthFrame>,
    )

    expect(screen.getByText('Семейный альбом, который всегда с вами')).toBeInTheDocument()
  })
})
