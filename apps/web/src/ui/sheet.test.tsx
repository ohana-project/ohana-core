import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/ui/sheet.tsx'

/*
 * The overlay parity of issue #59: like the prototype, a sheet has no
 * close X (Esc and the scrim close it — e2e/design.spec.ts pins the
 * behaviour), the grabber's margins are the prototype's `6px auto
 * 14px`, and the mobile drawer carries only its top hairline. The
 * computed values these classes produce are asserted in
 * e2e/design.spec.ts.
 */
describe('Sheet', () => {
  it('renders no close button', () => {
    renderWithProviders(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>День рождения Люды</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    )
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull()
    expect(document.querySelector('[data-slot="sheet-close"]')).toBeNull()
  })

  it('grabber sits 6px above and 14px below the content', () => {
    renderWithProviders(
      <Sheet open>
        <SheetContent />
      </Sheet>,
    )
    const grabber = document.querySelector('[data-slot="sheet-grabber"]')
    expect(grabber?.className).toContain('mt-1.5')
    expect(grabber?.className).toContain('mb-3.5')
  })

  it('mobile sheet keeps only the top border; the desktop modal the full one', () => {
    renderWithProviders(
      <Sheet open>
        <SheetContent data-testid="sheet" />
      </Sheet>,
    )
    const sheet = screen.getByTestId('sheet')
    // the `!` beats the glass recipe's full border, which sorts after
    // plain utilities
    expect(sheet.className).toContain('border-x-0! border-b-0!')
    expect(sheet.className).toContain('desktop:border-x! desktop:border-b!')
  })

  it('body wrapper keeps its content height, so tall sheets scroll whole', () => {
    renderWithProviders(
      <Sheet open>
        <SheetContent />
      </Sheet>,
    )
    const body = document.querySelector('[data-slot="sheet-body"]')
    // a shrinking wrapper would bury the popup's bottom padding under
    // tall content; shrink-0 keeps the padding under the last child
    expect(body?.className).toContain('shrink-0')
    expect(body?.className).not.toContain('min-h-0')
  })
})
