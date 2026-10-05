import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { RadioCard, RadioGroup } from './radio-group.tsx'

/*
 * The radio group of the onboarding screen's language cards: Base UI's
 * group with the prototype's 18px accent radios, and `RadioCard` as the
 * prototype's `label.card.card-link` — the 56px hoverable card owning
 * the radio, the muted medium and the 15px semibold name.
 */

describe('RadioCard', () => {
  it('renders the choice card and its parts, and selects through it', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <RadioGroup value="ru" onValueChange={onValueChange} aria-label="Язык интерфейса">
        <RadioCard value="ru" media={<span data-testid="medium" />}>
          Русский
        </RadioCard>
        <RadioCard value="en">English</RadioCard>
      </RadioGroup>,
    )

    const russian = screen.getByRole('radio', { name: 'Русский' })
    expect(russian).toBeChecked()
    const card = russian.closest('label')
    expect(card).toHaveAttribute('data-slot', 'radio-card')
    // The card recipe with the link-card lift (`.card.card-link`).
    expect(card).toHaveClass('min-h-14', 'flex-1', 'rounded-lg', 'shadow-1')
    expect(card?.className).toContain('hover:shadow-2')
    // The medium rides in a muted span whose icons take 18px; the name
    // is the prototype's 15px semibold.
    expect(screen.getByTestId('medium').parentElement).toHaveClass('text-muted-foreground')
    expect(screen.getByText('Русский')).toHaveClass('text-[15px]', 'font-semibold')

    await user.click(screen.getByRole('radio', { name: 'English' }))
    expect(onValueChange).toHaveBeenCalledWith('en', expect.anything())
  })
})
