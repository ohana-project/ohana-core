/**
 * The narrow surface of the Service Worker API the update flow needs, so
 * the watcher is testable without a browser. The generated service worker
 * (vite-plugin-pwa, registerType 'prompt') calls self.skipWaiting() when a
 * client forwards the SKIP_WAITING message and thereby replaces the active
 * worker; the page reloads once the new worker takes control.
 */
export interface AppWorker {
  /** ServiceWorkerState; 'parsed' is the deprecated pre-install state. */
  state: 'parsed' | 'installing' | 'installed' | 'activating' | 'activated' | 'redundant'
  postMessage(message: { type: 'SKIP_WAITING' }): void
  addEventListener(type: 'statechange', listener: () => void): void
  removeEventListener(type: 'statechange', listener: () => void): void
}

export interface AppRegistration {
  waiting: AppWorker | null
  installing: AppWorker | null
  addEventListener(type: 'updatefound', listener: () => void): void
  removeEventListener(type: 'updatefound', listener: () => void): void
}

export interface AppContainer {
  controller: AppWorker | null
  register(scriptUrl: string): Promise<AppRegistration>
  addEventListener(type: 'controllerchange', listener: () => void): void
  removeEventListener(type: 'controllerchange', listener: () => void): void
}

export interface AppUpdate {
  /** Activates the waiting worker and reloads once it controls the page. */
  apply(): void
}

/**
 * Registers the service worker and reports when a new version is waiting
 * (issue #11): on load, when the page is controlled and a worker already
 * waits, and later, when a registered worker reaches installed. The first
 * install never counts as an update — nobody needs a reload offer for the
 * worker they are getting right now. Returns a stop function for effect
 * cleanup.
 */
export function watchForAppUpdates(
  container: AppContainer,
  scriptUrl: string,
  onUpdateReady: (update: AppUpdate) => void,
  reload: () => void = () => window.location.reload(),
): () => void {
  let stopped = false
  let reported = false
  let applying = false
  let waiting: AppWorker | null = null
  let detachControllerChange: (() => void) | null = null

  const maybeReport = () => {
    if (stopped || reported || waiting === null || container.controller === null) return
    reported = true
    onUpdateReady({
      apply: () => {
        if (applying) return
        applying = true
        const worker = waiting
        if (worker === null) {
          reload()
          return
        }
        const onControllerChange = () => {
          // One shot: the reload happens exactly once, when the new worker
          // takes control.
          detachControllerChange?.()
          reload()
        }
        detachControllerChange = () =>
          container.removeEventListener('controllerchange', onControllerChange)
        container.addEventListener('controllerchange', onControllerChange)
        worker.postMessage({ type: 'SKIP_WAITING' })
      },
    })
  }

  const handleRegistration = (registration: AppRegistration) => {
    if (stopped) return
    if (registration.waiting !== null && container.controller !== null) {
      waiting = registration.waiting
      maybeReport()
    }
    const onUpdateFound = () => {
      const installing = registration.installing
      if (installing === null) return
      const onStateChange = () => {
        if (installing.state !== 'installed') return
        waiting = installing
        maybeReport()
      }
      installing.addEventListener('statechange', onStateChange)
      if (stopped) installing.removeEventListener('statechange', onStateChange)
    }
    registration.addEventListener('updatefound', onUpdateFound)
  }

  container.register(scriptUrl).then(handleRegistration, (reason: unknown) => {
    // Without a worker the app still works; the failure is reported, not hidden.
    reportError(reason)
  })

  return () => {
    stopped = true
    detachControllerChange?.()
  }
}
