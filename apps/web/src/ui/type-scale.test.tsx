import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Avatar } from '@/ui/avatar.tsx'
import { FieldDescription } from '@/ui/field.tsx'
import type { IconName } from '@/ui/icon.tsx'
import { TabBar } from '@/ui/tab-bar.tsx'

/*
 * The components the audit called out keep their type-scale step and
 * their text colour together in the rendered class list (issue #56):
 * the merger knows the scale, and these tests pin the components to
 * the steps the prototype names — tab labels micro/medium, hints meta,
 * avatar monograms their hue ink at every size. The computed sizes
 * these classes produce are asserted in e2e/design.spec.ts.
 */

const SECTIONS = [
  { id: 'home', label: 'Главная', icon: 'home' as IconName },
  { id: 'journal', label: 'Дневник', icon: 'book' as IconName },
]

const AVATAR_STEPS = {
  xs: 'text-meta',
  sm: 'text-sm',
  default: 'text-body',
  lg: 'text-h2',
} as const

describe('components keep their type-scale step beside their colour', () => {
  it('tab bar labels render micro/medium beside their own colour', () => {
    const { container, unmount } = renderWithProviders(
      <TabBar sections={SECTIONS} activeId="home" />,
    )
    const tabs = [...container.querySelectorAll('[data-slot=tab]')]
    expect(tabs).toHaveLength(SECTIONS.length)
    for (const tab of tabs) {
      // the base string carries aria-[current=page]:text-primary, so the
      // active state's own colour is checked on its class alone
      const active = tab.getAttribute('aria-current') === 'page'
      expect(tab.classList.contains('text-micro'), tab.className).toBe(true)
      expect(tab.classList.contains('font-medium'), tab.className).toBe(true)
      expect(
        tab.classList.contains(active ? 'text-primary' : 'text-muted-foreground'),
        `${active ? 'active' : 'inactive'}: ${tab.className}`,
      ).toBe(true)
    }
    unmount()
  })

  it('avatar monograms keep the hue ink at every size', () => {
    for (const [size, step] of Object.entries(AVATAR_STEPS) as [
      keyof typeof AVATAR_STEPS,
      string,
    ][]) {
      const { container, unmount } = renderWithProviders(<Avatar size={size} hue={60} />)
      const avatar = container.querySelector('[data-slot=avatar]')
      expect(avatar, size).not.toBeNull()
      // the hue ink, not the classes that carry it: a light-theme
      // fallback to the page's fg is the regression this pins
      expect(avatar?.classList.contains('text-[oklch(38%_0.08_var(--hue))]'), size).toBe(true)
      expect(avatar?.classList.contains(step), size).toBe(true)
      unmount()
    }
  })

  it('field hints render meta beside the muted colour', () => {
    const { container, unmount } = renderWithProviders(
      <FieldDescription>Подсказка</FieldDescription>,
    )
    const hint = container.querySelector('[data-slot=field-description]')
    expect(hint?.classList.contains('text-meta')).toBe(true)
    expect(hint?.classList.contains('text-muted-foreground')).toBe(true)
    unmount()
  })
})
