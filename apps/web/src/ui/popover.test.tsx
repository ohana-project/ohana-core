import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover.tsx'

/*
 * The overlay parity of issue #59: the prototype's popover is as wide
 * as its content, never narrower than 208px (`.popover { min-width:
 * 208px }`) — not the fixed 288px the audit found. The computed width
 * is asserted in e2e/design.spec.ts.
 */
describe('Popover', () => {
  it('width follows the content with a 208px floor', () => {
    renderWithProviders(
      <Popover open>
        <PopoverTrigger render={<button type="button" />} />
        <PopoverContent>
          <p>Быстрое действие</p>
        </PopoverContent>
      </Popover>,
    )
    const popup = document.querySelector('[data-slot="popover-content"]')
    expect(popup?.className).toContain('min-w-[208px]')
    expect(popup?.className).not.toContain('w-72')
  })
})
