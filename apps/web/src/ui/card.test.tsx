import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Card } from '@/ui/card.tsx'

/*
 * The two card forms (issue #58; the old default removed with #81):
 * the prototype's padded card (`.card-pad`: 20px on all sides, no
 * forced gap, the content sets its own rhythm) and the list card
 * (`.card list`: no padding, rows flush, the corners clip them). The
 * padded and list forms' rendered paddings are asserted against
 * computed styles in e2e/design.spec.ts; the class level is pinned
 * here.
 */
describe('Card forms', () => {
  it('padded form is the default: 20px on all sides and no forced gap', () => {
    renderWithProviders(
      <Card data-testid="card">
        <h3>Заголовок</h3>
        <p>Текст</p>
      </Card>,
    )
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-slot', 'card')
    expect(card).toHaveAttribute('data-variant', 'padded')
    expect(card.className).toContain('p-(--card-spacing)')
    expect(card.className).not.toContain('gap-(--card-spacing)')
    expect(card.className).not.toContain('py-(--card-spacing)')
  })

  it('explicit padded form: the same contract as the default', () => {
    renderWithProviders(
      <Card variant="padded" data-testid="card">
        <h3>Заголовок</h3>
        <p>Текст</p>
      </Card>,
    )
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-variant', 'padded')
    expect(card.className).toContain('p-(--card-spacing)')
    expect(card.className).not.toContain('gap-(--card-spacing)')
    expect(card.className).not.toContain('py-(--card-spacing)')
  })

  it('padded form keeps the sm card spacing', () => {
    renderWithProviders(<Card variant="padded" size="sm" data-testid="card" />)
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-size', 'sm')
    expect(card.className).toContain('p-(--card-spacing)')
    expect(card.className).toContain('data-[size=sm]:[--card-spacing:--spacing(4)]')
  })

  it('list form: no padding and no gap, corners clip the rows', () => {
    renderWithProviders(<Card variant="list" data-testid="card" />)
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-variant', 'list')
    expect(card.className).not.toContain('p-(--card-spacing)')
    expect(card.className).not.toContain('py-(--card-spacing)')
    expect(card.className).not.toContain('gap-(--card-spacing)')
    expect(card.className).toContain('overflow-hidden')
  })
})
