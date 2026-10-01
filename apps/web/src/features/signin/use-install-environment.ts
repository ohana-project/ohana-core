import { useState } from 'react'
import { detectInstallDecision, type InstallDecision } from '@/lib/install-detect.ts'

interface StandaloneNavigator extends Navigator {
  /** Set by iOS Safari when the page runs from the Home Screen. */
  standalone?: boolean
}

function readInstallDecision(): InstallDecision {
  const navigator = window.navigator as StandaloneNavigator
  return detectInstallDecision({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches,
  })
}

/**
 * The device's install situation, read once: installing opens the app in
 * its own context, so the answer cannot change while the page lives.
 */
export function useInstallEnvironment(): InstallDecision {
  return useState(readInstallDecision)[0]
}
