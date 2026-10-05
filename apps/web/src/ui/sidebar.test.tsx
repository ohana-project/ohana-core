import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Sidebar } from '@/ui/sidebar.tsx'

/*
 * The sidebar's nav items (docs/design/screens/home.html, `.nav-item`):
 * an active item keeps its accent under the pointer — the prototype
 * declares `.nav-item.is-active` after `:hover`, so the grey hover fill
 * never covers the accent (issue #62).
 */

const SPACE = {
  name: 'Наша семья',
  membersLabel: '4 участника · вы владелец',
  marks: [
    { initials: 'А', hue: 60 },
    { initials: 'Д', hue: 145 },
  ],
}

const SECTIONS = [
  { id: 'home', label: 'Главная', icon: 'home' as const },
  { id: 'journal', label: 'Дневник', icon: 'book' as const },
]

describe('Sidebar nav items', () => {
  it('an active item keeps its accent on hover, like .nav-item.is-active', () => {
    renderWithProviders(<Sidebar space={SPACE} sections={SECTIONS} activeId="home" />)

    const active = screen.getByRole('button', { name: 'Главная' })
    expect(active.className).toContain('bg-primary-soft')
    expect(active.className).toContain('text-primary')
    expect(active.className).toContain('hover:bg-primary-soft')
    expect(active.className).toContain('hover:text-primary')
    expect(active.className).not.toContain('hover:bg-accent')

    const inactive = screen.getByRole('button', { name: 'Дневник' })
    expect(inactive.className).toContain('hover:bg-accent')
    expect(inactive.className).toContain('hover:text-foreground')
  })
})
