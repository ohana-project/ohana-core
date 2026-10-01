import { devices, expect, test } from '@playwright/test'

/*
 * The install-first sign-in flow (issue #11, ADR-0005): on iOS and iPadOS
 * Safari outside the installed app, Home Screen installation is offered
 * first and the access code follows only after "continue in the browser";
 * on platforms with an install prompt it is offered but never required.
 * The specs run against the dev server, where real device emulation
 * (user agent, touch) decides what the screen offers.
 */

/*
 * Mobile profiles without defaultBrowserType (this suite stays on the
 * chromium project; only the emulation changes). test.use with a full
 * device preset is not allowed inside a describe group.
 */
function mobile(profile: (typeof devices)['iPhone 13']) {
  const { defaultBrowserType: _omitted, ...options } = profile
  return options
}

const IPHONE = mobile(devices['iPhone 13'])
const ANDROID = mobile(devices['Pixel 7'])

test.describe('install-first sign-in on iOS', () => {
  test.use(IPHONE)

  test('asks an iPhone to install before showing the code (ru)', async ({ page }) => {
    await page.goto('/signin')

    await expect(
      page.getByRole('heading', { name: 'Установите Ohana на экран «Домой»' }),
    ).toBeVisible()
    await expect(page.getByLabel('Код входа')).not.toBeVisible()

    // The steps card shows the iPhone gestures, and Android is one tab away.
    await expect(page.getByText('Откройте Ohana в Safari')).toBeVisible()
    await page.getByRole('tab', { name: 'Android' }).click()
    await expect(page.getByText('Откройте Ohana в Chrome')).toBeVisible()
    await expect(page.getByText('Откройте Ohana в Safari')).not.toBeVisible()

    // Continuing in the browser is never blocked.
    await page.getByRole('button', { name: 'Продолжить в браузере' }).click()
    await expect(page.getByLabel('Код входа')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Код входа' })).toBeVisible()
  })

  test('recognises a current iPad, which claims to be a Mac with a touch screen', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', {
        value: 'MacIntel',
        configurable: true,
      })
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
        value: 5,
        configurable: true,
      })
    })
    await page.goto('/signin')

    await expect(
      page.getByRole('heading', { name: 'Установите Ohana на экран «Домой»' }),
    ).toBeVisible()
  })

  test('lets the installed app go straight to the code', async ({ page }) => {
    await page.addInitScript(() => {
      // Inside the installed app iOS sets navigator.standalone, and the
      // display mode answers the standalone media query.
      Object.defineProperty(Navigator.prototype, 'standalone', { value: true, configurable: true })
      const original = window.matchMedia.bind(window)
      window.matchMedia = (query: string) => {
        const media = original(query)
        if (query !== '(display-mode: standalone)') return media
        return Object.defineProperty(media, 'matches', { value: true })
      }
    })
    await page.goto('/signin')

    await expect(page.getByRole('heading', { name: 'Код входа' })).toBeVisible()
    await expect(page.getByText('Установите Ohana на экран «Домой»')).not.toBeVisible()
  })

  test('renders the English install-first screen (en)', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('ohana.locale', 'en'))
    await page.goto('/signin')

    await expect(
      page.getByRole('heading', { name: 'Install Ohana on your Home Screen' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue in the browser' })).toBeVisible()
  })
})

test.describe('installation offer on Android', () => {
  test.use(ANDROID)

  test('offers installation without blocking the code', async ({ page }) => {
    await page.addInitScript(() => {
      // Chromium defers its real dialog to this event once it decides the
      // app is installable; the page has to be listening by then, so the
      // dispatch waits for the load event.
      const fire = () =>
        window.setTimeout(() => {
          const event = new Event('beforeinstallprompt')
          Object.assign(event, { prompt: () => Promise.resolve() })
          window.dispatchEvent(event)
        }, 100)
      if (document.readyState === 'complete') fire()
      else window.addEventListener('load', fire, { once: true })
    })
    await page.goto('/signin')

    // The code is already there; the install offer sits above it, and
    // spending it on the browser dialog makes the offer disappear.
    await expect(page.getByLabel('Код входа')).toBeVisible()
    await page.getByRole('button', { name: 'Установить приложение' }).click()
    await expect(page.getByRole('button', { name: 'Установить приложение' })).not.toBeVisible()
    await expect(page.getByLabel('Код входа')).toBeVisible()
  })
})
