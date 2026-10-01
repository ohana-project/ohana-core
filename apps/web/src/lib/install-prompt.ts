/**
 * The deferred beforeinstallprompt event, captured once per page load
 * (issue #11): Chromium fires it wherever the visitor happens to be, so
 * the capture cannot live inside the sign-in screen. The event is
 * single-use — once spent, the browser resolves the installation itself
 * and confirms through appinstalled. iOS never fires the event; there the
 * sign-in screen teaches the Home Screen gesture instead (ADR-0005).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (candidate) => {
    if (typeof (candidate as BeforeInstallPromptEvent).prompt !== 'function') return
    // Keeping the default from firing is what defers the dialog to the
    // explicit user action in promptInstall.
    candidate.preventDefault()
    deferred = candidate as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export function subscribeToInstallPrompt(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function installPromptAvailable(): boolean {
  return deferred !== null
}

/** Opens the browser's installation dialog, spending the captured event. */
export function promptInstall(): void {
  const current = deferred
  deferred = null
  notify()
  void current?.prompt().catch(() => {
    // The visitor dismissed the dialog; there is nothing to react to.
  })
}
