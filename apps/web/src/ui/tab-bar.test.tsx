import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TabBar } from '@/ui/tab-bar.tsx'

/*
 * The tab bar keeps the glass recipe's top hairline (issue #62): the
 * prototype's `.tabbar` sits on `.glass`, whose 1px fg-9% hairline the
 * bar keeps on its top edge only — the rendered bar is the prototype's
 * 68px again (docs/design/README.md, "Glass").
 */

const SECTIONS = [
  { id: 'home', label: 'Главная', icon: 'home' as const },
  { id: 'journal', label: 'Дневник', icon: 'book' as const },
]

describe('TabBar', () => {
  it('keeps the glass top hairline instead of dropping every border', () => {
    const { container } = render(<TabBar sections={SECTIONS} activeId="home" />)

    const bar = container.querySelector('[data-slot="tabbar"]')
    expect(bar).not.toBeNull()
    expect(bar?.className).toContain('border-t')
    expect(bar?.className).toContain('border-[color-mix(in_oklch,var(--fg)_9%,transparent)]')
    expect(bar?.className).not.toContain('border-0')
  })
})
