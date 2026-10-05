import { screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminTopBarActions } from './admin-top-bar-actions.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <a href="/admin/settings" className={className}>
      {children}
    </a>
  ),
  useNavigate: () => () => {},
}))

/*
 * The administrative bar's own actions (issue #79): 36px rounds with
 * 18px icons, like the theme toggle that closes the bar — the bar is
 * 56px only while every action in it is.
 */
describe('AdminTopBarActions', () => {
  it('renders the settings entry and sign-out as 36px rounds', () => {
    renderWithProviders(<AdminTopBarActions />)

    expect(screen.getByRole('link', { name: 'Настройки инстанса' })).toHaveClass('size-9')
    expect(screen.getByRole('button', { name: 'Выйти из админки' })).toHaveClass('size-9')
  })

  it('hides the settings entry where the caller says so', () => {
    renderWithProviders(<AdminTopBarActions showSettings={false} />)

    expect(screen.queryByRole('link', { name: 'Настройки инстанса' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выйти из админки' })).toBeInTheDocument()
  })
})
