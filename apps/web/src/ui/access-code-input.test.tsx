import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { AccessCodeInput, formatAccessCode } from '@/ui/access-code-input.tsx'

describe('formatAccessCode', () => {
  it('formats to XXXX-XXXX while typing', () => {
    expect(formatAccessCode('1234')).toBe('1234')
    expect(formatAccessCode('12345')).toBe('1234-5')
    expect(formatAccessCode('12345678')).toBe('1234-5678')
  })

  it('uppercases and strips junk characters', () => {
    expect(formatAccessCode('a1b2-c3d4!!')).toBe('A1B2-C3D4')
    expect(formatAccessCode('  код 12')).toBe('12')
  })

  it('caps at 8 characters', () => {
    expect(formatAccessCode('1234567890')).toBe('1234-5678')
  })
})

describe('AccessCodeInput', () => {
  it('formats typed digits', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AccessCodeInput aria-label="Код входа" />)
    const input = screen.getByLabelText('Код входа')
    await user.type(input, '12345')
    expect(input).toHaveValue('1234-5')
  })

  it('formats a pasted lowercase code with junk characters', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AccessCodeInput aria-label="Код входа" />)
    const input = screen.getByLabelText('Код входа')
    await user.click(input)
    await user.paste('a1b2-c3d4!!')
    expect(input).toHaveValue('A1B2-C3D4')
  })

  it('caps the value at 8 characters', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AccessCodeInput aria-label="Код входа" />)
    const input = screen.getByLabelText('Код входа')
    await user.click(input)
    await user.paste('1234567890')
    expect(input).toHaveValue('1234-5678')
  })

  it('reports the cleaned value and clears the invalid state on input', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onInvalidClear = vi.fn()
    renderWithProviders(
      <AccessCodeInput
        aria-label="Код входа"
        invalid
        onValueChange={onValueChange}
        onInvalidClear={onInvalidClear}
      />,
    )
    const input = screen.getByLabelText('Код входа')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await user.type(input, '9')
    expect(onValueChange).toHaveBeenCalledWith('9')
    expect(onInvalidClear).toHaveBeenCalledOnce()
  })
})
