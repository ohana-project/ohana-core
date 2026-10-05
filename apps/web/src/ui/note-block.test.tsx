import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { NoteBlock } from '@/ui/note-block.tsx'

/*
 * The note block (`.venue-note` in the prototype, issue #61): the
 * soft-accent box with a 22% accent hairline and a 20px accent icon.
 * The rendered fill, border, radius, padding and gap are asserted
 * against computed styles in e2e/design.spec.ts; the classes and the
 * sized-icon context are pinned here.
 */
describe('NoteBlock', () => {
  it('carries the prototype shape: soft accent fill, 22% accent border, large radius, 16px padding, 14px gap', () => {
    renderWithProviders(
      <NoteBlock icon="gift" data-testid="note">
        <p>Текст</p>
      </NoteBlock>,
    )
    const note = screen.getByTestId('note')
    expect(note).toHaveAttribute('data-slot', 'note-block')
    expect(note.className).toContain('bg-primary-soft')
    expect(note.className).toContain('rounded-lg')
    expect(note.className).toContain('p-4')
    expect(note.className).toContain('gap-3.5')
    expect(note.className).toContain('border-[color-mix(in_oklch,var(--accent)_22%,transparent)]')
  })

  it('is a sized-icon context: the accent icon is 20px without an explicit size (issue #55)', () => {
    renderWithProviders(
      <NoteBlock icon="shield" data-testid="note">
        <p>Текст</p>
      </NoteBlock>,
    )
    const note = screen.getByTestId('note')
    expect(note.className).toContain("[&>svg:not([class*='size-'])]:size-5")
    expect(note.className).toContain('[&>svg]:text-primary')
    // the glyph takes no explicit size, so the block's context rule owns
    // the 20px; the rendered pixels are asserted in e2e/design.spec.ts
    const icon = note.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('class')).not.toContain('size-')
  })

  it('keeps the content in its own column at sm size, after the icon', () => {
    renderWithProviders(
      <NoteBlock icon="cake" data-testid="note">
        <p>Заголовок</p>
        <p>Текст</p>
      </NoteBlock>,
    )
    const note = screen.getByTestId('note')
    expect(note.className).toContain('flex')
    const content = note.querySelector('div')
    expect(content?.className).toContain('text-sm')
    expect(content?.className).toContain('flex-1')
  })
})
