import { screen } from '@testing-library/react'
import { useId } from 'react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Field, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Input } from '@/ui/input.tsx'

/*
 * The Field composition rule: the error is announced to the input
 * through aria-describedby, and the invalid state travels through
 * aria-invalid (border, ring and the one shake in CSS).
 */
function InvalidNameField() {
  const errorId = useId()
  return (
    <Field data-invalid="true">
      <FieldLabel htmlFor="member-name">Имя участника</FieldLabel>
      <Input id="member-name" aria-invalid aria-describedby={errorId} defaultValue="" />
      <FieldError id={errorId}>Напишите имя</FieldError>
    </Field>
  )
}

describe('Field', () => {
  it('links the error message through aria-describedby', () => {
    renderWithProviders(<InvalidNameField />)
    const input = screen.getByLabelText('Имя участника')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveAttribute('id', describedBy)
    expect(screen.getByRole('alert')).toHaveTextContent('Напишите имя')
  })
})
