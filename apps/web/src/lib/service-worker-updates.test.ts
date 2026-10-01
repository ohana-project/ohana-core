import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AppRegistration,
  type AppWorker,
  watchForAppUpdates,
} from './service-worker-updates.ts'

/**
 * A worker fake the tests drive through its states: state transitions are
 * announced the way the browser announces them, with a statechange event.
 */
class FakeWorker extends EventTarget implements AppWorker {
  state: 'parsed' | 'installing' | 'installed' | 'activating' | 'activated' | 'redundant' =
    'installing'
  postMessage = vi.fn()

  setState(state: this['state']) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget implements AppRegistration {
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null
  register = vi.fn(async () => this.registration)
  registration = new FakeRegistration()

  takeControl() {
    this.controller = new FakeWorker()
    this.dispatchEvent(new Event('controllerchange'))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** The update the watcher offered first, failing the test if none did. */
function offeredUpdate(onReady: ReturnType<typeof vi.fn>) {
  const call = onReady.mock.calls[0]
  if (call === undefined) throw new Error('the watcher never offered an update')
  return call[0] as { apply: () => void }
}

describe('watchForAppUpdates', () => {
  it('offers an update when the page loads while a new worker already waits', async () => {
    const container = new FakeContainer()
    container.controller = new FakeWorker()
    const waiting = new FakeWorker()
    container.registration.waiting = waiting
    const onReady = vi.fn()

    watchForAppUpdates(container, '/sw.js', onReady, () => {})
    await vi.waitFor(() => expect(container.register).toHaveBeenCalledWith('/sw.js'))
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))

    offeredUpdate(onReady).apply()

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('reloads once the waiting worker has taken control', async () => {
    const container = new FakeContainer()
    container.controller = new FakeWorker()
    container.registration.waiting = new FakeWorker()
    const reload = vi.fn()
    const onReady = vi.fn()

    watchForAppUpdates(container, '/sw.js', onReady, reload)
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    offeredUpdate(onReady).apply()

    expect(reload).not.toHaveBeenCalled()
    container.takeControl()
    expect(reload).toHaveBeenCalledTimes(1)

    // A late second controllerchange (or a second apply) must not reload twice.
    container.takeControl()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('offers an update when a worker found later finishes installing', async () => {
    const container = new FakeContainer()
    container.controller = new FakeWorker()
    const onReady = vi.fn()

    const stop = watchForAppUpdates(container, '/sw.js', onReady, () => {})
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())

    const installing = new FakeWorker()
    container.registration.installing = installing
    container.registration.dispatchEvent(new Event('updatefound'))

    // Still installing under a controlled page: nothing is offered yet…
    expect(onReady).not.toHaveBeenCalled()

    // …but reaching installed makes the offer.
    installing.setState('installed')
    expect(onReady).toHaveBeenCalledTimes(1)

    stop()
  })

  it('stays silent on the very first install, when no worker controls the page yet', async () => {
    const container = new FakeContainer()
    const onReady = vi.fn()

    const stop = watchForAppUpdates(container, '/sw.js', onReady, () => {})
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())

    const installing = new FakeWorker()
    container.registration.installing = installing
    container.registration.dispatchEvent(new Event('updatefound'))
    installing.setState('installed')

    expect(onReady).not.toHaveBeenCalled()
    stop()
  })

  it('ignores workers that finish installing after the watcher stopped', async () => {
    const container = new FakeContainer()
    container.controller = new FakeWorker()
    const onReady = vi.fn()

    const stop = watchForAppUpdates(container, '/sw.js', onReady, () => {})
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())

    const installing = new FakeWorker()
    container.registration.installing = installing
    container.registration.dispatchEvent(new Event('updatefound'))
    stop()
    installing.setState('installed')

    expect(onReady).not.toHaveBeenCalled()
  })

  it('makes a second apply a no-op', async () => {
    const container = new FakeContainer()
    container.controller = new FakeWorker()
    container.registration.waiting = new FakeWorker()
    const onReady = vi.fn()

    watchForAppUpdates(container, '/sw.js', onReady, () => {})
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    const update = offeredUpdate(onReady)
    update.apply()
    update.apply()

    expect(container.registration.waiting?.postMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps the app working when registration fails', async () => {
    const container = new FakeContainer()
    container.register.mockRejectedValueOnce(new Error('no support'))
    const onReady = vi.fn()
    const errors = vi.fn()
    vi.stubGlobal('reportError', errors)

    expect(() => watchForAppUpdates(container, '/sw.js', onReady, () => {})).not.toThrow()
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())
    expect(onReady).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
  })
})
