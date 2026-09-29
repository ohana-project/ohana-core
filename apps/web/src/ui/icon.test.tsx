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
    expect(sized.querySelector('svg')).toHaveAttribute('width', '18')
    const { container: em } = render(<Icon name="check" />)
    expect(em.querySelector('svg')?.getAttribute('class')).toContain('size-[1em]')
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
