import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Card } from '@/ui/card.tsx'

/*
 * The three card forms (issue #58): the default the first screens were
 * built on — vertical padding, a gap between blocks, side padding from
 * the header and content slots —, the prototype's padded card
 * (`.card-pad`: 20px on all sides, no forced gap), and the list card
 * (`.card list`: no padding, rows flush, the corners clip them). The
 * rendered padding values are asserted against computed styles in
 * e2e/design.spec.ts; these tests pin the forms themselves.
 */
describe('Card forms', () => {
  it('keeps the default form: vertical padding and the block gap', () => {
    renderWithProviders(<Card data-testid="card" />)
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-slot', 'card')
    expect(card).toHaveAttribute('data-variant', 'default')
    expect(card.className).toContain('py-(--card-spacing)')
    expect(card.className).toContain('gap-(--card-spacing)')
  })

  it('padded form: 20px on all sides and no forced gap', () => {
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
