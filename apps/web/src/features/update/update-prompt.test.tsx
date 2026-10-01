import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'

/*
 * A detected new application version is offered as a reload (issue #11):
 * the offer appears only when the watcher reports a waiting worker, the
 * reload activates it, and without service worker support the component
 * never reaches the watcher at all.
 */

const apply = vi.fn()
const stop = vi.fn()

vi.mock('@/lib/service-worker-updates.ts', () => ({
  watchForAppUpdates: vi.fn(() => stop),
}))

const watch = vi.mocked((await import('@/lib/service-worker-updates.ts')).watchForAppUpdates)

const FAKE_CONTAINER = { serviceWorker: {} } as unknown as Navigator

function useContainer() {
  vi.stubGlobal('navigator', FAKE_CONTAINER)
}

function reportUpdateReady() {
  const call = watch.mock.calls[0]
  if (call === undefined) throw new Error('the prompt never started watching')
  act(() => call[2]({ apply }))
}

afterEach(() => {
  watch.mockClear()
  apply.mockClear()
  stop.mockClear()
  vi.unstubAllGlobals()
})

describe('UpdatePrompt', () => {
  // The prompt is mounted inside AppProviders itself (next to the toaster),
  // so every test renders a neutral child — rendering the prompt again as
  // children would mount it twice.

  it('renders nothing while the current version is up to date', () => {
    useContainer()
    renderWithProviders(null)

    expect(watch).toHaveBeenCalledWith(FAKE_CONTAINER.serviceWorker, '/sw.js', expect.any(Function))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers a reload when a new version is waiting and applies it on demand', async () => {
    useContainer()
    const user = userEvent.setup()
    renderWithProviders(null)

    reportUpdateReady()

    expect(screen.getByRole('status')).toHaveTextContent('Вышла новая версия Ohana')
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('stops watching when it unmounts', () => {
    useContainer()
    const view = renderWithProviders(null)

    // Test cleanup below also unmounts; only this unmount is under test.
    stop.mockClear()
    view.unmount()

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stays out of the way where service workers are unsupported', () => {
    vi.stubGlobal('navigator', {} as Navigator)
    renderWithProviders(null)

    expect(watch).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
