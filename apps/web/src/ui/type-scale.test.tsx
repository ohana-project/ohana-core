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
 * avatar monograms their hue ink at every size.
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
  it('tab bar labels render micro beside the muted or accent colour', () => {
    const { container, unmount } = renderWithProviders(
      <TabBar sections={SECTIONS} activeId="home" />,
    )
    for (const tab of container.querySelectorAll('[data-slot=tab]')) {
      expect(tab.className).toContain('text-micro')
      expect(tab.className).toMatch(/text-(muted-foreground|primary)/)
    }
    unmount()
  })

  it('avatar monograms keep the hue ink at every size', () => {
    for (const [size, step] of Object.entries(AVATAR_STEPS)) {
      const { container, unmount } = renderWithProviders(<Avatar size={size as 'xs'} hue={60} />)
      const className = container.querySelector('[data-slot=avatar]')?.className ?? ''
      expect(className, size).toContain('text-[oklch(38%_0.08_var(--hue))]')
      expect(className, size).toContain(step)
      unmount()
    }
  })

  it('field hints render meta beside the muted colour', () => {
    const { container, unmount } = renderWithProviders(
      <FieldDescription>Подсказка</FieldDescription>,
    )
    const className = container.querySelector('[data-slot=field-description]')?.className ?? ''
    expect(className).toContain('text-meta')
    expect(className).toContain('text-muted-foreground')
    unmount()
  })
})
