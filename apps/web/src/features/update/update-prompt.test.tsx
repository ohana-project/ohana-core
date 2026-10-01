import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminLayout } from '@/app/layouts/admin-layout.tsx'
import { AuthLayout } from '@/app/layouts/auth-layout.tsx'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { renderWithProviders } from '@/testing/render.tsx'
import { UpdatePrompt } from './update-prompt.tsx'

/*
 * A detected new application version is offered as a reload (issue #11):
 * the offer appears only when the page-lifetime update store turns ready,
 * the reload applies it, and the shells place the banner in the page flow —
 * each of them, because deleting the mount from one shell must not pass
 * unnoticed while another keeps the suite green.
 */

const apply = vi.hoisted(() => vi.fn())

vi.mock('@/lib/app-update.ts', () => {
  let ready = false
  const listeners = new Set<() => void>()
  return {
    subscribeToAppUpdate: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isAppUpdateReady: () => ready,
    applyAppUpdate: apply,
    __setAppUpdateReady(value: boolean) {
      ready = value
      for (const listener of listeners) listener()
    },
  }
})

const setReady = (
  (await import('@/lib/app-update.ts')) as unknown as {
    __setAppUpdateReady: (value: boolean) => void
  }
).__setAppUpdateReady

const SPACE = { name: 'Наша семья', marks: [] }
const SECTIONS = [{ id: 'home', label: 'Главная', icon: 'home' as const }]

afterEach(() => {
  apply.mockClear()
  setReady(false)
})

describe('UpdatePrompt', () => {
  it('renders nothing while the current version is up to date', () => {
    renderWithProviders(<UpdatePrompt />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers a reload when a new version is waiting and applies it on demand', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UpdatePrompt />)

    act(() => setReady(true))

    expect(screen.getByRole('status')).toHaveTextContent('Вышла новая версия Ohana')
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('the member shell places the offer in its page flow', () => {
    renderWithProviders(
      <MemberLayout space={SPACE} sections={SECTIONS} activeId="home">
        <p>content</p>
      </MemberLayout>,
    )
    act(() => setReady(true))

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Вышла новая версия Ohana')
    expect(banner.closest('main')).not.toBeNull()
    expect(banner.compareDocumentPosition(screen.getByText('content'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('the administrative shell places the offer in its page flow', () => {
    renderWithProviders(
      <AdminLayout>
        <p>content</p>
      </AdminLayout>,
    )
    act(() => setReady(true))

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Вышла новая версия Ohana')
    expect(banner.closest('main')).not.toBeNull()
  })

  it('the auth shell places the offer in its page flow', () => {
    renderWithProviders(
      <AuthLayout footer="note">
        <p>content</p>
      </AuthLayout>,
    )
    act(() => setReady(true))

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Вышла новая версия Ohana')
    expect(banner.compareDocumentPosition(screen.getByText('content'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})
