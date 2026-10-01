import { useCallback, useSyncExternalStore } from 'react'
import {
  installPromptAvailable,
  promptInstall as openPromptInstall,
  subscribeToInstallPrompt,
} from '@/lib/install-prompt.ts'

export interface InstallPrompt {
  /** The browser can show its own installation dialog on request. */
  available: boolean
  /** Opens the browser's installation dialog; never navigates anywhere. */
  promptInstall: () => void
}

export function useInstallPrompt(): InstallPrompt {
  const available = useSyncExternalStore(subscribeToInstallPrompt, installPromptAvailable)
  const promptInstall = useCallback(() => openPromptInstall(), [])
  return { available, promptInstall }
}
