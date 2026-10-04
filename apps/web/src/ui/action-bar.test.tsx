import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { ActionBar } from '@/ui/action-bar.tsx'

/*
 * The mobile action bar (`.editor-bar` in the prototype, issue #61):
 * the glass bar fixed directly above the tab bar holding a screen's
 * main actions. Geometry (the flush sit above the tab bar, the hide
 * from 920px) is asserted against the rendered page in
 * e2e/design.spec.ts; the classes are pinned here — jsdom has no
 * layout, so the safe-area offset only exists as the class.
 */
describe('ActionBar', () => {
  it('is the bar glass recipe, full width at the bottom', () => {
    renderWithProviders(
      <ActionBar data-testid="bar">
        <button type="button">Сохранить</button>
      </ActionBar>,
    )
    const bar = screen.getByTestId('bar')
    expect(bar).toHaveAttribute('data-slot', 'action-bar')
    expect(bar.className).toContain('glass-bar')
    expect(bar.className).toContain('fixed')
    expect(bar.className).toContain('inset-x-0')
  })

  it('sits above the tab bar and respects the bottom safe area', () => {
    renderWithProviders(
      <ActionBar data-testid="bar">
        <button type="button">Сохранить</button>
      </ActionBar>,
    )
    const bar = screen.getByTestId('bar')
    // the tab bar reserve plus the safe-area inset its own padding
    // adds — never over the bar itself (the prototype offsets by
    // var(--tabbar-h) alone)
    expect(bar.className).toContain('bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))]')
  })

  it('is hidden from 920px, where the actions live in the top bar', () => {
    renderWithProviders(
      <ActionBar data-testid="bar">
        <button type="button">Сохранить</button>
      </ActionBar>,
    )
    expect(screen.getByTestId('bar').className).toContain('desktop:hidden')
  })

  it('lays its actions out in a row with the prototype gap', () => {
    renderWithProviders(
      <ActionBar data-testid="bar">
        <button type="button">Отмена</button>
        <button type="button">Сохранить</button>
      </ActionBar>,
    )
    const bar = screen.getByTestId('bar')
    expect(bar.className).toContain('flex')
    expect(bar.className).toContain('items-center')
    expect(bar.className).toContain('gap-2.5')
  })
})
