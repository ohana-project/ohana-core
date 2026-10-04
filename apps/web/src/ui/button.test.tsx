import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Button } from '@/ui/button.tsx'

/*
 * The button's type sizes and paddings are the prototype's own values,
 * not type-scale steps (issue #60): 15px text at the default size,
 * 14px small, 16.5px large; the link button's 8px side padding survives
 * whatever size it is combined with; the icon buttons are round, 44px
 * and 36px. The computed pixels are asserted in e2e/design.spec.ts.
 */

function classes(ui: React.ReactElement) {
  const { container, unmount } = renderWithProviders(ui)
  const button = container.querySelector('[data-slot=button]')
  const result = button?.className ?? ''
  unmount()
  return result
}

describe('Button', () => {
  it('carries the prototype text size at every size variant', () => {
    expect(classes(<Button />)).toContain('text-[15px]')
    expect(classes(<Button size="sm" />)).toContain('text-[14px]')
    expect(classes(<Button size="lg" />)).toContain('text-[16.5px]')
  })

  it('renders the default size at 44px and keeps the icon round at 44px', () => {
    expect(classes(<Button />)).toContain('min-h-11')
    const icon = classes(<Button size="icon" aria-label="Поиск" />)
    expect(icon).toContain('size-11')
    expect(icon).toContain('rounded-full')
  })

  it('offers the 36px round icon button', () => {
    const icon = classes(<Button size="icon-sm" variant="secondary" aria-label="Меню" />)
    expect(icon).toContain('size-9')
    expect(icon).toContain('rounded-full')
    expect(icon).toContain('p-0')
  })

  it('keeps the link button at 8px of side padding beside any size', () => {
    expect(classes(<Button variant="link" />)).toContain('px-2')
    expect(classes(<Button variant="link" size="sm" />)).toContain('px-2')
    expect(classes(<Button variant="link" />)).not.toContain('px-5')
  })
})
