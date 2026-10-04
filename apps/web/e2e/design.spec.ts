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

test.describe('card forms and list rows (issue #58)', () => {
  test('the padded and list card forms carry the prototype values', async ({ page }) => {
    await openDesign(page)
    const padding = (el: Element) => {
      const s = getComputedStyle(el)
      return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft]
    }
    // the padded card: 20px on all sides
    const padded = page.locator('[data-slot="card"][data-variant="padded"]').first()
    await expect(padded).toBeVisible()
    expect(await padded.evaluate(padding)).toEqual(['20px', '20px', '20px', '20px'])
    // the list card: no padding, the corners clip the rows
    const list = page.locator('[data-slot="card"][data-variant="list"]').first()
    await expect(list).toBeVisible()
    expect(await list.evaluate(padding)).toEqual(['0px', '0px', '0px', '0px'])
    expect(await list.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden')
    // the default card is still beside them, unchanged
    const def = page.locator('[data-slot="card"][data-variant="default"]').first()
    await expect(def).toBeVisible()
  })

  test('list rows offer every height the prototypes use', async ({ page }) => {
    await openDesign(page)
    for (const [size, height] of [
      ['sm', '52px'],
      ['default', '56px'],
      ['md', '60px'],
      ['lg', '64px'],
      ['xl', '68px'],
    ]) {
      const row = page.locator(`[data-slot="item"][data-size="${size}"]`).first()
      await expect(row).toBeVisible()
      expect(await row.evaluate((el) => getComputedStyle(el).minHeight), `size ${size}`).toBe(
        height,
      )
    }
  })

  test('a leading icon is bare and an avatar has no tinted square behind it', async ({ page }) => {
    await openDesign(page)
    // a bare leading icon: no tile background, muted colour
    const bare = page
      .locator('[data-slot="item-media"][data-variant="default"]')
      .filter({ has: page.locator('svg') })
      .first()
    await expect(bare).toBeVisible()
    expect(await bare.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    )
    // an avatar as leading content sits on nothing: its media has no
    // background and no 38px tile
    const avatarRow = page
      .locator('[data-slot="item"]')
      .filter({ has: page.locator('[data-slot="avatar"]') })
      .first()
    await expect(avatarRow).toBeVisible()
    const avatarMedia = avatarRow.locator('[data-slot="item-media"]')
    expect(await avatarMedia.getAttribute('data-variant')).toBe('default')
    expect(await avatarMedia.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    )
    // the 38px tinted tile stays available where a tone opts in
    const tile = page
      .locator('[data-slot="item-media"][data-variant="icon"][data-tone="warn"]')
      .first()
    await expect(tile).toBeVisible()
    expect(await tile.evaluate((el) => getComputedStyle(el).width)).toBe('38px')
  })

  test('the empty state stands alone with its action outside the icon plate', async ({ page }) => {
    await openDesign(page)
    const empty = page.locator('[data-slot="empty"]').first()
    await expect(empty).toBeVisible()
    // not inside a card
    expect(await empty.evaluate((el) => el.closest('[data-slot="card"]'))).toBeNull()
    // the action button is not the round icon plate
    const button = empty.getByRole('button')
    await expect(button).toBeVisible()
    expect(await button.evaluate((el) => el.closest('[data-slot="empty-icon"]'))).toBeNull()
  })
})
