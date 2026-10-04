import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Button } from '@/ui/button.tsx'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog.tsx'

/*
 * The overlay parity of issue #59: the prototypes give a dialog no
 * close X — it closes on Esc and on a scrim tap (Base UI behaviour,
 * pinned in e2e/design.spec.ts), and the footer is the confirm row of
 * the prototype: two equal-width buttons side by side at every width,
 * cancel on the left, sitting 18px below the text (the prototype's
 * `.sheet-sub` margin-bottom; 16px content gap + this 2px offset).
 */
describe('Dialog', () => {
  it('renders no close button', () => {
    renderWithProviders(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить запись?</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull()
    expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull()
  })

  it('footer is the confirm row: equal widths, 10px gap, 18px below the text', () => {
    renderWithProviders(
      <Dialog open>
        <DialogContent>
          <DialogFooter data-testid="footer">
            <Button variant="secondary">Отмена</Button>
            <Button variant="destructive">Удалить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    const footer = screen.getByTestId('footer')
    expect(footer.className).toContain('flex gap-2.5')
    expect(footer.className).toContain('[&>*]:flex-1')
    expect(footer.className).toContain('mt-0.5')
    // the stacked-and-right-aligned shadcn arrangement is gone: the
    // buttons stand side by side at every width (README "Overlays")
    expect(footer.className).not.toContain('flex-col-reverse')
    expect(footer.className).not.toContain('sm:flex-row')
  })
})
