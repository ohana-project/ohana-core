import { watchForAppUpdates } from './service-worker-updates.ts'

/*
 * The page-lifetime state of the application update (issue #11): the
 * watcher registers once per page from the app entry, wherever the visitor
 * happens to be, and every shell's banner just reads this state. An
 * installed app resumed from the background picks the update up here
 * without any shell having to re-register.
 */
let updateReady = false
let apply: () => void = () => {}
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function subscribeToAppUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isAppUpdateReady(): boolean {
  return updateReady
}

/** Activates the waiting worker and reloads once it controls the page. */
export function applyAppUpdate(): void {
  apply()
}

// The service worker exists only in the built app: the dev server's /sw.js
// is a 404, and vitest runs under its own mode. MODE is 'production'
// exactly for build output, so the registration keys on it.
if (
  typeof window !== 'undefined' &&
  import.meta.env.MODE === 'production' &&
  'serviceWorker' in navigator
) {
  watchForAppUpdates(navigator.serviceWorker, '/sw.js', (update) => {
    apply = update.apply
    updateReady = true
    notify()
  })
}
