export type InstallPlatform = 'ios' | 'android' | 'other'

export interface InstallEnvironment {
  userAgent: string
  /** navigator.platform, read for the iPadOS quirk below. */
  platform: string
  maxTouchPoints: number
  /**
   * True when the page already runs as an installed app: navigator.standalone
   * on iOS, or the display-mode: standalone media query elsewhere.
   */
  standalone: boolean
}

export interface InstallDecision {
  platform: InstallPlatform
  /** The page already runs inside the installed app. */
  installed: boolean
  /**
   * iOS and iPadOS Safari must be offered Home Screen installation before the
   * access code (ADR-0005): the installed app keeps its own cookies and is the
   * only place where Web Push works, so the one-time code is spent there.
   */
  installFirst: boolean
}

export function detectInstallDecision(environment: InstallEnvironment): InstallDecision {
  const installed = environment.standalone
  const { platform } = environment

  // iPadOS has claimed the desktop Safari user agent since version 13; a
  // Mac with more than one touch point is an iPad.
  const ios =
    /iPhone|iPad|iPod/.test(environment.userAgent) ||
    (platform === 'MacIntel' && environment.maxTouchPoints > 1)
  if (ios) return { platform: 'ios', installed, installFirst: !installed }

  if (platform.includes('Android') || /Android/.test(environment.userAgent)) {
    return { platform: 'android', installed, installFirst: false }
  }

  return { platform: 'other', installed, installFirst: false }
}
