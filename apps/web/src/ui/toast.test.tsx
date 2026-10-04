import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Toaster, toast } from '@/ui/toast.tsx'

/*
 * The overlay parity of issue #59: the prototype's toast is an icon
 * and text only — no close control; it hides itself after about three
 * seconds and answers a swipe (`.toast`, no dismiss button). The
 * computed 14.5px is asserted in e2e/design.spec.ts.
 */
describe('Toast', () => {
  it('shows an icon and text only, with no close control', () => {
    renderWithProviders(<Toaster />)
    act(() => {
      toast('Скопировано')
    })

    const toastRoot = document.querySelector('[data-slot="toast"]')
    expect(toastRoot).not.toBeNull()
    // the prototype's component-scoped 14.5px, not the sm step
    expect(toastRoot?.className).toContain('text-[14.5px]')
    expect(toastRoot?.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull()
    expect(toastRoot?.querySelector('[data-slot="toast-close"]')).toBeNull()
  })
})
