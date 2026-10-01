import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { useInstallPrompt } from './use-install-prompt.ts'

/*
 * The install prompt is the Chromium seam for "installation is offered but
 * never required" (issue #11): a deferred beforeinstallprompt event is the
 * only thing that can open the browser's dialog, and it is single-use.
 */

function PromptProbe() {
  const { available, promptInstall } = useInstallPrompt()
  return (
    <button type="button" onClick={promptInstall}>
      {available ? 'available' : 'unavailable'}
    </button>
  )
}

function fireBeforeInstallPrompt(prompt?: () => Promise<void>) {
  const event = new Event('beforeinstallprompt')
  if (prompt !== undefined) Object.assign(event, { prompt })
  window.dispatchEvent(event)
}

describe('useInstallPrompt', () => {
  it('defers the browser dialog behind an explicit user action', async () => {
    const user = userEvent.setup()
    const prompt = vi.fn(async () => {})
    renderWithProviders(<PromptProbe />)

    fireBeforeInstallPrompt(prompt)
    const button = await screen.findByRole('button', { name: 'available' })

    expect(prompt).not.toHaveBeenCalled()
    await user.click(button)
    expect(prompt).toHaveBeenCalledTimes(1)
    // The deferred event is single-use; after spending it the offer is gone.
    expect(screen.getByRole('button', { name: 'unavailable' })).toBeInTheDocument()
  })

  it('ignores a beforeinstallprompt event without a prompt payload', () => {
    renderWithProviders(<PromptProbe />)

    fireBeforeInstallPrompt()

    expect(screen.getByRole('button', { name: 'unavailable' })).toBeInTheDocument()
  })

  it('withdraws the offer once the app is installed', async () => {
    renderWithProviders(<PromptProbe />)
    fireBeforeInstallPrompt(vi.fn(async () => {}))
    await screen.findByRole('button', { name: 'available' })

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(screen.getByRole('button', { name: 'unavailable' })).toBeInTheDocument()
  })
})
