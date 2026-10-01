import { useCallback, useEffect, useState } from 'react'

/**
 * The non-standard event payload Chromium fires when it can install the
 * app without leaving the page. iOS never fires it — there the screen
 * teaches the Home Screen gesture instead (ADR-0005).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

export interface InstallPrompt {
  /** The browser can show its own installation dialog on request. */
  available: boolean
  /** Opens the browser's installation dialog; never navigates anywhere. */
  promptInstall: () => void
}

export function useInstallPrompt(): InstallPrompt {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onBeforeInstallPrompt = (candidate: Event) => {
      if (typeof (candidate as BeforeInstallPromptEvent).prompt !== 'function') return
      // Keeping the default from firing is what defers the dialog to the
      // explicit user action below.
      candidate.preventDefault()
      setEvent(candidate as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setEvent(null)
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(() => {
    setEvent((current) => {
      void current?.prompt()
      // The event is single-use; the browser resolves the rest itself and
      // confirms through appinstalled.
      return null
    })
  }, [])

  return { available: event !== null, promptInstall }
}
