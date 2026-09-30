import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { type SyncState, SyncStatus } from '@/ui/sync-status.tsx'

const STATES: SyncState[] = ['first', 'updating', 'synced', 'offline', 'unreachable', 'error']

describe('SyncStatus', () => {
  it('is a live status region in every state', () => {
    for (const state of STATES) {
      const { container, unmount } = renderWithProviders(<SyncStatus state={state} />)
      expect(container.querySelector('[role="status"]')).toBeInTheDocument()
      unmount()
    }
  })

  it('shows the retry link only in the two failure states', () => {
    for (const state of STATES) {
      const onRetry = vi.fn()
      const { container, unmount } = renderWithProviders(
        <SyncStatus state={state} onRetry={onRetry} />,
      )
      const retry = container.querySelector('[data-slot="sync-retry"]')
      if (state === 'unreachable' || state === 'error') {
        expect(retry, state).not.toBeNull()
      } else {
        expect(retry, state).toBeNull()
      }
      unmount()
    }
  })

  it('formats the synced time through Intl.DateTimeFormat', () => {
    renderWithProviders(<SyncStatus state="synced" syncedAt={new Date(2026, 8, 28, 14, 32)} />)
    expect(screen.getByText(/14:32/)).toBeInTheDocument()
  })

  it('calls onRetry from the failure states', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    const { container } = renderWithProviders(<SyncStatus state="error" onRetry={onRetry} />)
    await user.click(container.querySelector('[data-slot="sync-retry"]') as HTMLElement)
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
