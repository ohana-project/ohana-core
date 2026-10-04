import { expect, type Page, test } from '@playwright/test'

/*
 * Specs against the /design preview route (issue #6): both themes,
 * both languages, no horizontal overflow, visible focus, overlay
 * focus traps, and the access-code formatting rule.
 */

const DESIGN = '/design'

async function openDesign(page: Page, options: { theme?: string; locale?: string } = {}) {
  await page.addInitScript(
    ([theme, locale]) => {
      if (theme) window.localStorage.setItem('ohana.theme', theme)
      if (locale) window.localStorage.setItem('ohana.locale', locale)
    },
    [options.theme, options.locale] as const,
  )
  const title = options.locale === 'en' ? 'Ohana design system' : 'Дизайн-система Ohana'
  await page.goto(DESIGN)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

test.describe('themes and languages', () => {
  for (const theme of ['light', 'dark']) {
    for (const locale of ['ru', 'en'] as const) {
      test(`renders in ${theme} ${locale}`, async ({ page }) => {
        await openDesign(page, { theme, locale })
        await expect(page).toHaveTitle(/Ohana/)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
      })
    }
  }

  test('dark and light palettes actually differ', async ({ page }) => {
    await openDesign(page, { theme: 'light' })
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await openDesign(page, { theme: 'dark' })
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(lightBg).not.toBe(darkBg)
  })
})

test.describe('layout holds from 360px to 1440px', () => {
  for (const width of [360, 390, 820, 1024, 1440]) {
    test(`no horizontal overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openDesign(page)
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(overflow.scrollWidth, `width ${width}`).toBeLessThanOrEqual(overflow.clientWidth)
    })
  }
})

test.describe('keyboard focus', () => {
  test('every tab stop shows a visible focus indicator', async ({ page }) => {
    await openDesign(page)
    await page.evaluate(() => document.body.focus())

    // fields replace the outline with their own focus ring, so accept
    // either indicator (README "Accessibility")
    const fieldSlots = ['input', 'textarea', 'code-input']
    let first: string | null = null
    let stops = 0
    let withRing = 0
    for (let step = 0; step < 200; step += 1) {
      await page.keyboard.press('Tab')
      const focus = await page.evaluate(
        ([fieldSlots]) => {
          const el = document.activeElement as HTMLElement | null
          if (!el || el === document.body) return null
          const style = getComputedStyle(el)
          const outlineRing =
            style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2
          const fieldRing = fieldSlots.includes(el.dataset.slot ?? '') && style.boxShadow !== 'none'
          return {
            key: `${el.tagName}.${el.dataset.slot ?? ''}.${(el.textContent ?? '').slice(0, 24)}`,
            visible: el.matches(':focus-visible') && (outlineRing || fieldRing),
          }
        },
        [fieldSlots],
      )
      if (!focus) continue
      if (focus.key === first) break // wrapped around to the first stop
      if (first === null) first = focus.key
      stops += 1
      expect(focus.visible, `tab stop ${stops}: ${focus.key}`).toBe(true)
      withRing += 1
    }
    expect(withRing, 'the page has dozens of interactive components').toBeGreaterThanOrEqual(30)
  })
})

test.describe('overlays', () => {
  test('the dialog traps focus and closes on Escape', async ({ page }) => {
    await openDesign(page)
    await page.getByRole('button', { name: 'Диалог' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab')
      // the trap re-focuses asynchronously, so poll instead of reading once
      await expect
        .poll(() =>
          page.evaluate(() => !!document.activeElement?.closest('[data-slot="dialog-content"]')),
        )
        .toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('the sheet traps focus and closes on Escape', async ({ page }) => {
    await openDesign(page)
    await page.getByRole('button', { name: 'Шторка' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab')
      await expect
        .poll(() =>
          page.evaluate(() => !!document.activeElement?.closest('[data-slot="sheet-content"]')),
        )
        .toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  test('the drawer traps focus and closes on Escape', async ({ page }) => {
    await openDesign(page)
    await page.getByRole('button', { name: 'Выдвижная панель' }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()

    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab')
      await expect
        .poll(() =>
          page.evaluate(() => !!document.activeElement?.closest('[data-slot="drawer-popup"]')),
        )
        .toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
  })

  test('checked menu items show an accent check', async ({ page }) => {
    await openDesign(page)
    await page.getByRole('button', { name: 'Вид ленты' }).click()
    // the check is Ohana's accent (shadcn's primary), not shadcn's accent
    // role, which is the near-invisible fg-soft hover fill
    const accent = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent)'
      document.body.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    })
    for (const item of [
      page.getByRole('menuitemradio', { name: 'Сначала новые' }),
      page.getByRole('menuitemcheckbox', { name: 'Только с фото' }),
    ]) {
      const check = item.locator('svg')
      await expect(check).toBeVisible()
      await expect(check).toHaveCSS('color', accent)
    }
  })
})

test.describe('access code input', () => {
  test('formats a pasted code with junk characters', async ({ page }) => {
    await openDesign(page)
    const input = page.getByRole('textbox', { name: 'Код входа' }).first()
    await input.click()
    await input.fill('')
    await page.evaluate(() => navigator.clipboard.writeText('a1b2-c3d4!!'))
    await page.keyboard.press('ControlOrMeta+v')
    await expect(input).toHaveValue('A1B2-C3D4')
  })
})

test.describe('type scale survives class merging', () => {
  // the merger knows the Ohana steps (issue #56); these pin the rendered
  // sizes the ticket names, computed from the real stylesheet
  test('tab labels, hints, badges, tooltips and menu labels keep their size', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)

    const tab = page.locator('[data-slot=tab]').first()
    await expect(tab).toHaveCSS('font-size', '11.5px')
    await expect(tab).toHaveCSS('font-weight', '500')

    await expect(page.locator('[data-slot=field-description]').first()).toHaveCSS(
      'font-size',
      '12.5px',
    )
    await expect(page.locator('[data-slot=count-badge]').first()).toHaveCSS('font-size', '11.5px')

    const trigger = page.locator('[data-slot=tooltip-trigger]').first()
    await trigger.hover()
    await expect(page.locator('[data-slot=tooltip-content]')).toHaveCSS('font-size', '12.5px')

    await page.getByRole('button', { name: 'Вид ленты' }).click()
    await expect(page.locator('[data-slot=dropdown-menu-label]').first()).toHaveCSS(
      'font-size',
      '12.5px',
    )
    await page.keyboard.press('Escape')
  })

  test('avatar monograms keep their hue ink at every size in both themes', async ({ page }) => {
    // the rendered sizes of the four monogram steps (meta, sm, body, h2)
    const INK_FONT_SIZES = { xs: '12.5px', sm: '13.5px', default: '15.5px', lg: '19px' }
    for (const theme of ['light', 'dark'] as const) {
      await openDesign(page, { theme })
      const avatars = page.locator('[data-slot=avatar]')
      const sizes = await avatars.evaluateAll((els) =>
        [...new Set(els.map((el) => el.getAttribute('data-size')))].sort(),
      )
      expect(sizes, theme).toEqual(['default', 'lg', 'sm', 'xs'])
      // light ink is oklch(38% 0.08 hue), dark ink oklch(88% 0.06 hue) —
      // never the page's fg
      const ink = theme === 'light' ? /^oklch\(0\.38 0\.08 / : /^oklch\(0\.88 0\.06 /
      for (let i = 0; i < (await avatars.count()); i += 1) {
        const avatar = avatars.nth(i)
        const colour = await avatar.evaluate((el) => getComputedStyle(el).color)
        expect(colour, `avatar ${i} (${theme})`).toMatch(ink)
        const size = (await avatar.getAttribute('data-size')) as keyof typeof INK_FONT_SIZES
        await expect(avatar, `avatar ${i} (${theme})`).toHaveCSS('font-size', INK_FONT_SIZES[size])
      }
    }
  })

  test('the tab bar keeps the prototype height', async ({ page }) => {
    // the issue's symptom was a 73px bar from body-size labels; with
    // micro labels it sits at 67px (the prototype's 68 includes the
    // 1px glass hairline the implementation drops)
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const box = await page.locator('[data-slot=tabbar]').boundingBox()
    expect(box?.height).toBeCloseTo(67, 0)
  })
})
