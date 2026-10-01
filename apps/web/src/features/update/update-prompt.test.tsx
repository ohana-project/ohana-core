import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { UpdatePrompt } from './update-prompt.tsx'

/*
 * A detected new application version is offered as a reload (issue #11):
 * the offer appears only when the watcher reports a waiting worker, the
 * reload activates it, and without service worker support the component
 * never reaches the watcher at all. The shells mount the banner in the
 * page flow; the tests render it directly.
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

// The prompt registers only in the built app; tests run in the vitest mode.
const realMode = import.meta.env.MODE
function useProduction() {
  ;(import.meta.env as { MODE: string }).MODE = 'production'
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
  ;(import.meta.env as { MODE: string }).MODE = realMode
  vi.unstubAllGlobals()
})

describe('UpdatePrompt', () => {
  it('renders nothing while the current version is up to date', () => {
    useContainer()
    useProduction()
    renderWithProviders(<UpdatePrompt />)

    expect(watch).toHaveBeenCalledWith(FAKE_CONTAINER.serviceWorker, '/sw.js', expect.any(Function))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers a reload when a new version is waiting and applies it on demand', async () => {
    useContainer()
    useProduction()
    const user = userEvent.setup()
    renderWithProviders(<UpdatePrompt />)

    reportUpdateReady()

    expect(screen.getByRole('status')).toHaveTextContent('Вышла новая версия Ohana')
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('stops watching when it unmounts', () => {
    useContainer()
    useProduction()
    const view = renderWithProviders(<UpdatePrompt />)

    // Test cleanup below also unmounts; only this unmount is under test.
    stop.mockClear()
    view.unmount()

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stays out of the way where service workers are unsupported', () => {
    useProduction()
    vi.stubGlobal('navigator', {} as Navigator)
    renderWithProviders(<UpdatePrompt />)

    expect(watch).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not watch in a development build, where no worker exists', () => {
    useContainer()
    ;(import.meta.env as { MODE: string }).MODE = 'development'
    renderWithProviders(<UpdatePrompt />)

    expect(watch).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
