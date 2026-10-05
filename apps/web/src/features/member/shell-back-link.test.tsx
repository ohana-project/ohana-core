import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { ShellBackLink } from '@/features/member/shell-back-link.tsx'

/*
 * The shell's back arrow (docs/design/screens/home.html, ohana.js):
 * `.btn.btn-icon.m-only` — the 44px round button with the 18px chevron
 * in the main text colour, shown below 920px only, where the sidebar is
 * not there to lead back (issue #62).
 */

const Link = vi.fn(({ to, ...props }: { to?: string } & Record<string, unknown>) => (
  // the real Link derives an href from `to`; without it the anchor has no
  // link role and the role query below would miss it
  <a href={typeof to === 'string' ? to : '#'} {...props} />
))

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { to?: string } & Record<string, unknown>) => Link(props),
}))

describe('ShellBackLink', () => {
  it('is a 44px round mobile-only link whose chevron the button sizes to 18px', () => {
    renderWithProviders(<ShellBackLink to="/journal" />)

    const link = screen.getByRole('link', { name: 'Назад' })
    expect(link.getAttribute('href')).toBe('/journal')
    // .btn-icon: the 44px round; .m-only: gone from 920px up
    expect(link.className).toContain('size-11')
    expect(link.className).toContain('rounded-full')
    expect(link.className).toContain('desktop:hidden')
    // the icon carries no size class of its own — the button's container
    // rule ([&_svg:not([class*='size-'])]:size-[18px]) sizes it, .btn svg
    expect(link.querySelector('svg')).not.toBeNull()
    expect(link.querySelector('svg')?.className.baseVal ?? '').not.toContain('size-')
  })
})
