import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { SignInScreen } from './signin-screen.tsx'

/*
 * The gate decides what a visitor sees before the access code (issue #11,
 * ADR-0005): iOS and iPadOS Safari get the install-first screen and reach
 * the code only through "continue in the browser"; Chromium platforms get
 * an installation offer that never blocks the code; everywhere else the
 * code comes first. The browser is the seam, so each test pretends to be
 * one through navigator and matchMedia.
 */

interface DeviceOptions {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  /** navigator.standalone, set by iOS Safari inside the installed app. */
  standalone?: boolean
  /** matchMedia('(display-mode: standalone)').matches, the other install signal. */
  displayStandalone?: boolean
}

function mockDevice(options: DeviceOptions): () => void {
  const restores: Array<() => void> = []
  const navigator = window.navigator as Navigator & { standalone?: boolean }

  if (options.userAgent !== undefined) {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => options.userAgent,
    })
    restores.push(() => Reflect.deleteProperty(navigator, 'userAgent'))
  }
  if (options.platform !== undefined) {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      get: () => options.platform,
    })
    restores.push(() => Reflect.deleteProperty(navigator, 'platform'))
  }
  if (options.maxTouchPoints !== undefined) {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => options.maxTouchPoints,
    })
    restores.push(() => Reflect.deleteProperty(navigator, 'maxTouchPoints'))
  }
  if (options.standalone !== undefined) {
    Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      get: () => options.standalone,
    })
    restores.push(() => Reflect.deleteProperty(navigator, 'standalone'))
  }
  if (options.displayStandalone !== undefined) {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    if (original === undefined) {
      throw new Error('the test setup must define matchMedia on window')
    }
    const displayStandalone = options.displayStandalone
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)' ? displayStandalone : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
    restores.push(() => Object.defineProperty(window, 'matchMedia', original))
  }

  return () => {
    for (const restore of restores) restore()
  }
}

const IPHONE_SAFARI = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
}

const ANDROID_CHROME = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv81',
  maxTouchPoints: 5,
}

afterEach(() => {
  window.localStorage.clear()
})

describe('SignInScreen install gate', () => {
  it('asks an iPhone in Safari to install before showing the code', () => {
    const restore = mockDevice(IPHONE_SAFARI)
    try {
      renderWithProviders(<SignInScreen onSignedIn={() => {}} />)

      expect(
        screen.getByRole('heading', { name: 'Установите Ohana на экран «Домой»' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Продолжить в браузере' })).toBeInTheDocument()
      expect(screen.queryByLabelText('Код входа')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('recognises a current iPad, which claims to be a Mac with a touch screen', () => {
    const restore = mockDevice({ platform: 'MacIntel', maxTouchPoints: 5 })
    try {
      renderWithProviders(<SignInScreen onSignedIn={() => {}} />)

      expect(
        screen.getByRole('heading', { name: 'Установите Ohana на экран «Домой»' }),
      ).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('reveals the code after "continue in the browser"', async () => {
    const user = userEvent.setup()
    const restore = mockDevice(IPHONE_SAFARI)
    try {
      renderWithProviders(<SignInScreen onSignedIn={() => {}} />)

      await user.click(screen.getByRole('button', { name: 'Продолжить в браузере' }))

      expect(screen.getByLabelText('Код входа')).toBeInTheDocument()
      expect(screen.queryByText('Установите Ohana на экран «Домой»')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('lets an installed iPhone app go straight to the code', () => {
    const restore = mockDevice({ ...IPHONE_SAFARI, standalone: true })
    try {
      renderWithProviders(<SignInScreen onSignedIn={() => {}} />)

      expect(screen.getByLabelText('Код входа')).toBeInTheDocument()
      expect(screen.queryByText('Установите Ohana на экран «Домой»')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('shows only the code on desktop browsers, with no installation offer', () => {
    renderWithProviders(<SignInScreen onSignedIn={() => {}} />)

    expect(screen.getByLabelText('Код входа')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Установить приложение' })).not.toBeInTheDocument()
  })

  it('offers installation on Android when the browser can prompt, without blocking the code', async () => {
    const user = userEvent.setup()
    const prompt = vi.fn(async () => {})
    const restore = mockDevice(ANDROID_CHROME)
    try {
      renderWithProviders(<SignInScreen onSignedIn={() => {}} />)
      const event = new Event('beforeinstallprompt')
      Object.assign(event, { prompt })
      window.dispatchEvent(event)

      const installButton = await screen.findByRole('button', { name: 'Установить приложение' })
      expect(screen.getByLabelText('Код входа')).toBeInTheDocument()

      await user.click(installButton)
      expect(prompt).toHaveBeenCalledTimes(1)
      // The prompt is single-use: the offer disappears once spent.
      expect(
        screen.queryByRole('button', { name: 'Установить приложение' }),
      ).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('renders the English install-first screen (en)', () => {
    const restore = mockDevice(IPHONE_SAFARI)
    try {
      window.localStorage.setItem('ohana.locale', 'en')
      renderWithProviders(<SignInScreen onSignedIn={() => {}} />)

      expect(
        screen.getByRole('heading', { name: 'Install Ohana on your Home Screen' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue in the browser' })).toBeInTheDocument()
    } finally {
      restore()
    }
  })
})
