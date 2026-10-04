import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon, type IconName } from '@/ui/icon.tsx'
import { Logo, LogoMark, LogoRound } from '@/ui/logo.tsx'

const ALL_ICONS = [
  'home',
  'book',
  'calendar',
  'gift',
  'user',
  'users',
  'heart',
  'bookmark',
  'camera',
  'image',
  'plus',
  'check',
  'x',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'more-h',
  'sync',
  'cloud-off',
  'wifi-off',
  'bell',
  'bell-off',
  'repeat',
  'clock',
  'globe',
  'sun',
  'moon',
  'trash',
  'restore',
  'archive',
  'copy',
  'lock',
  'shield',
  'crown',
  'download',
  'share',
  'search',
  'send',
  'edit',
  'log-out',
  'settings',
  'alert',
  'info',
  'file-text',
  'star',
  'eye',
  'eye-off',
  'install',
  'cake',
  'phone',
  'mail',
  'server',
] as const satisfies readonly IconName[]

describe('Icon', () => {
  it('renders every icon the spec lists', () => {
    for (const name of ALL_ICONS) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg'), name).not.toBeNull()
      unmount()
    }
  })

  it('is hidden from assistive technology', () => {
    const { container } = render(<Icon name="check" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('sizes by the size prop or the parent font size', () => {
    const { container: sized } = render(<Icon name="check" size={18} />)
    const sizedSvg = sized.querySelector('svg')
    expect(sizedSvg).toHaveAttribute('width', '18')
    // the inline style beats a context's sizing rule, so an explicit
    // size wins wherever the icon is placed
    expect(sizedSvg).toHaveStyle({ width: '18px', height: '18px' })
    const { container: em } = render(<Icon name="check" />)
    const emSvg = em.querySelector('svg')
    // the 1em default must not match the containers' [class*='size-']
    // exclusion, or their sizing rules would never apply (issue #55)
    expect(emSvg?.getAttribute('class')).toContain('h-[1em]')
    expect(emSvg?.getAttribute('class')).not.toContain('size-')
  })

  it('lets an explicit sizing class override the em default', () => {
    const { container } = render(<Icon name="check" className="size-7" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('size-7')
    expect(svg?.getAttribute('class')).not.toContain('h-[1em]')
  })

  it('lets separate width and height classes override the em default', () => {
    // the tab bar's 40×28 plate is one svg with h-7 w-10; the merge must
    // be deterministic, never stylesheet order
    const { container } = render(<Icon name="home" className="h-7 w-10" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('h-7')
    expect(svg?.getAttribute('class')).toContain('w-10')
    expect(svg?.getAttribute('class')).not.toContain('h-[1em]')
    expect(svg?.getAttribute('class')).not.toContain('w-[1em]')
  })
})

describe('Logo', () => {
  it('renders the square mark, the round variant and the wordmark lockup', () => {
    const { container } = render(
      <>
        <LogoMark />
        <LogoRound />
        <Logo />
      </>,
    )
    expect(container.querySelectorAll('svg')).toHaveLength(3)
    expect(screen.getByText('Ohana')).toBeInTheDocument()
  })
})
