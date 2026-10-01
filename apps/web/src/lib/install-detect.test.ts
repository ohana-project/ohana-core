import { describe, expect, it } from 'vitest'
import { detectInstallDecision, type InstallEnvironment } from './install-detect.ts'

const DESKTOP_SAFARI: InstallEnvironment = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 0,
  standalone: false,
}

describe('detectInstallDecision', () => {
  it('asks an iPhone in Safari to install before entering the code', () => {
    const decision = detectInstallDecision({
      ...DESKTOP_SAFARI,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })

    expect(decision).toEqual({ platform: 'ios', installed: false, installFirst: true })
  })

  it('recognises a current iPad, which claims to be a Mac with a touch screen', () => {
    const decision = detectInstallDecision({
      ...DESKTOP_SAFARI,
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })

    expect(decision).toEqual({ platform: 'ios', installed: false, installFirst: true })
  })

  it('recognises an older iPad that still names itself in the user agent', () => {
    const decision = detectInstallDecision({
      ...DESKTOP_SAFARI,
      userAgent:
        'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      platform: 'iPad',
      maxTouchPoints: 5,
    })

    expect(decision).toEqual({ platform: 'ios', installed: false, installFirst: true })
  })

  it('lets an installed iPhone app go straight to the code', () => {
    const decision = detectInstallDecision({
      ...DESKTOP_SAFARI,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
      standalone: true,
    })

    expect(decision).toEqual({ platform: 'ios', installed: true, installFirst: false })
  })

  it('offers installation on Android but never before the code', () => {
    const decision = detectInstallDecision({
      ...DESKTOP_SAFARI,
      userAgent:
        'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv81',
      maxTouchPoints: 5,
    })

    expect(decision).toEqual({ platform: 'android', installed: false, installFirst: false })
  })

  it('shows only the code on desktop browsers', () => {
    expect(detectInstallDecision(DESKTOP_SAFARI)).toEqual({
      platform: 'other',
      installed: false,
      installFirst: false,
    })
  })
})
