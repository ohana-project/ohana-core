import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * The store owns the page's single worker registration (issue #11): it
 * watches only in the built app, and a waiting version reaches every
 * subscriber with the reload action attached. Module state is per import,
 * so each case re-imports the fresh module under its own mocks.
 */

const watch = vi.hoisted(() => vi.fn())

vi.mock('./service-worker-updates.ts', () => ({
  watchForAppUpdates: watch,
}))

function stubEnvironment(mode: string, serviceWorker?: unknown) {
  vi.stubEnv('MODE', mode)
  if (serviceWorker !== undefined) {
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    })
  }
}

async function importStore() {
  vi.resetModules()
  return import('./app-update.ts')
}

afterEach(() => {
  watch.mockClear()
  Reflect.deleteProperty(window.navigator, 'serviceWorker')
  vi.unstubAllEnvs()
})

describe('app update store', () => {
  it('registers the worker once in the built app and reports a waiting version', async () => {
    stubEnvironment('production', {})
    let report: ((update: { apply: () => void }) => void) | undefined
    watch.mockImplementation((_container, _url, onReady) => {
      report = onReady
      return () => {}
    })
    const store = await importStore()
    const seen: boolean[] = []
    const stop = store.subscribeToAppUpdate(() => seen.push(store.isAppUpdateReady()))
    expect(watch).toHaveBeenCalledTimes(1)

    report?.({ apply: () => {} })

    expect(store.isAppUpdateReady()).toBe(true)
    expect(seen).toEqual([true])
    stop()
  })

  it('routes applyAppUpdate to the waiting worker', async () => {
    stubEnvironment('production', {})
    const apply = vi.fn()
    let report: ((update: { apply: () => void }) => void) | undefined
    watch.mockImplementation((_container, _url, onReady) => {
      report = onReady
      return () => {}
    })
    const store = await importStore()

    // Nothing waits yet: applying is a harmless no-op.
    store.applyAppUpdate()
    expect(apply).not.toHaveBeenCalled()

    report?.({ apply })
    store.applyAppUpdate()

    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('does not watch outside the built app', async () => {
    stubEnvironment('test', {})
    const store = await importStore()
    await Promise.resolve()

    expect(watch).not.toHaveBeenCalled()
    expect(store.isAppUpdateReady()).toBe(false)
  })

  it('does not watch where service workers are unsupported', async () => {
    stubEnvironment('production')
    const store = await importStore()
    await Promise.resolve()

    expect(watch).not.toHaveBeenCalled()
    expect(store.isAppUpdateReady()).toBe(false)
  })
})
