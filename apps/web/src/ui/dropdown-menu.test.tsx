import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu.tsx'

/*
 * The overlay parity of issue #59: prototype menu items are 42px tall
 * with 14.5px text (`.menu-item`), and the separator carries the
 * prototype's `margin: 6px 4px` — 6px above and below, 4px inside the
 * popup's padding — instead of running edge to edge. The computed
 * values are asserted in e2e/design.spec.ts.
 */
describe('DropdownMenu', () => {
  it('items are 42px tall with 14.5px text', () => {
    const { getByRole } = renderWithProviders(
      <DropdownMenu open>
        <DropdownMenuTrigger render={<button type="button" />} />
        <DropdownMenuItem data-testid="item">Профиль</DropdownMenuItem>
      </DropdownMenu>,
    )
    const item = getByRole('menuitem')
    expect(item.className).toContain('min-h-[42px]')
    expect(item.className).toContain('text-[14.5px]')
    expect(item.className).not.toContain('text-sm')
  })

  it('separator is 4px inside the padding with 6px above and below', () => {
    renderWithProviders(
      <DropdownMenu open>
        <DropdownMenuTrigger render={<button type="button" />} />
        <DropdownMenuSeparator data-testid="separator" />
      </DropdownMenu>,
    )
    const separator = document.querySelector('[data-testid="separator"]')
    expect(separator?.className).toContain('mx-1')
    expect(separator?.className).toContain('my-1.5')
    // edge-to-edge is the defect the audit found: never again
    expect(separator?.className).not.toContain('-mx-1.5')
  })
})
