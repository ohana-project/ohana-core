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
  update(): Promise<unknown>
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

/** How often a becoming-visible page asks the server for a new worker. */
const UPDATE_CHECK_THROTTLE_MS = 60 * 60 * 1000

/**
 * Registers the service worker and reports when a new version is waiting
 * (issue #11): on load, when the page is controlled and a worker already
 * waits; when a registered worker reaches installed; and when the page
 * becomes visible and an update check finds one. The first install never
 * counts as an update — nobody needs a reload offer for the worker they
 * are getting right now. Returns a stop function for effect cleanup.
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
  const detachments: Array<() => void> = []
  const detach = (detachThis: () => void) => {
    if (stopped) detachThis()
    else detachments.push(detachThis)
  }

  const maybeReport = () => {
    if (stopped || reported || waiting === null || container.controller === null) return
    reported = true
    onUpdateReady({
      apply: () => {
        if (applying) return
        applying = true
        const worker = waiting
        if (worker === null || worker.state === 'activated' || worker.state === 'redundant') {
          // The waiting worker already took over — another tab applied it,
          // or it activated on its own. The next load is the new version.
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

  /** Offers the update when an installing worker reaches installed. */
  const watchInstalling = (installing: AppWorker) => {
    const onStateChange = () => {
      if (installing.state !== 'installed') return
      waiting = installing
      maybeReport()
    }
    installing.addEventListener('statechange', onStateChange)
    detach(() => installing.removeEventListener('statechange', onStateChange))
  }

  const handleRegistration = (registration: AppRegistration) => {
    if (stopped) return

    if (registration.waiting !== null && container.controller !== null) {
      waiting = registration.waiting
      maybeReport()
    }
    // The browser's own update check can fire updatefound before this
    // listener exists, leaving an installing worker behind.
    if (registration.installing !== null) watchInstalling(registration.installing)
    const onUpdateFound = () => {
      if (registration.installing !== null) watchInstalling(registration.installing)
    }
    registration.addEventListener('updatefound', onUpdateFound)
    detach(() => registration.removeEventListener('updatefound', onUpdateFound))

    // An installed app resumed from the background never navigates, so
    // navigation-triggered update checks never happen; becoming visible
    // asks the server instead, at most once an hour.
    let lastChecked = Date.now()
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastChecked < UPDATE_CHECK_THROTTLE_MS) return
      lastChecked = now
      registration.update().catch((reason: unknown) => {
        // Without an update check the app still works with what it has.
        reportError(reason)
      })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    detach(() => document.removeEventListener('visibilitychange', onVisibilityChange))
  }

  container.register(scriptUrl).then(handleRegistration, (reason: unknown) => {
    // Without a worker the app still works; the failure is reported, not hidden.
    reportError(reason)
  })

  return () => {
    stopped = true
    detachControllerChange?.()
    for (const detachThis of detachments.splice(0)) detachThis()
  }
}
