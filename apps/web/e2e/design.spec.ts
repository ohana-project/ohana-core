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

test.describe('icon sizes (issue #55)', () => {
  /**
   * Every context sizes its own icons (docs/design/README.md
   * "Components" and the prototype's `svg` rules); the caller never
   * passes a size, so the rendered pixels pin the design language.
   */
  test('each context dictates its icon size at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openDesign(page)

    const sizes = await page.evaluate(() => {
      const boxes = (selector: string) =>
        [...document.querySelectorAll(selector)].map((el) => {
          const rect = el.getBoundingClientRect()
          return [rect.width, rect.height]
        })
      return {
        button: boxes('[data-slot="button"] svg'),
        listRowLeading: boxes('[data-slot="item-media"][data-variant="icon"] svg'),
        listRowTrailing: boxes('[data-slot="item"] > svg'),
        listRowActions: boxes('[data-slot="item-actions"] > svg'),
        pickCheck: boxes('[data-slot="pick-row"] > svg'),
        emptyPlate: boxes('[data-slot="empty-icon"] > svg'),
        pill: boxes('[data-slot="badge"] svg'),
        sidebarChevron: boxes('[data-slot="side-space"] > svg'),
      }
    })

    const expected = {
      button: [18, 18],
      listRowLeading: [20, 20],
      listRowTrailing: [18, 18],
      listRowActions: [18, 18],
      pickCheck: [20, 20],
      emptyPlate: [28, 28],
      pill: [12, 12],
      sidebarChevron: [20, 20],
    } as const
    for (const [context, boxes] of Object.entries(sizes)) {
      expect(boxes.length, `${context}: the preview shows the context`).toBeGreaterThan(0)
      for (const box of boxes) {
        expect(box, context).toEqual(expected[context as keyof typeof expected])
      }
    }
  })

  test('menu items dictate 18px once a menu is open', async ({ page }) => {
    await openDesign(page)
    await page.getByRole('button', { name: 'Меню', exact: true }).click()
    // the menu mounts in a portal after the click
    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(4)
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"] svg')].map((el) => {
        const rect = el.getBoundingClientRect()
        return [rect.width, rect.height]
      }),
    )
    expect(boxes).toHaveLength(4)
    for (const box of boxes) expect(box).toEqual([18, 18])
    await page.keyboard.press('Escape')
  })

  test('the tab bar keeps its 40×28 plate with a 24px glyph at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)

    const measured = await page.evaluate(() => {
      const px = (value: string) => Number.parseFloat(value)
      const box = (el: Element | null) => {
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return [rect.width, rect.height]
      }
      const tabSvg = document.querySelector('[data-slot="tab"] svg')
      if (!tabSvg) return null
      const rect = tabSvg.getBoundingClientRect()
      const style = getComputedStyle(tabSvg)
      return {
        plate: [rect.width, rect.height],
        glyph: [
          rect.width - px(style.paddingLeft) - px(style.paddingRight),
          rect.height - px(style.paddingTop) - px(style.paddingBottom),
        ],
        fab: box(document.querySelector('[data-slot="fab"] svg')),
      }
    })
    expect(measured, 'the mobile shell renders inside the preview').not.toBeNull()
    expect(measured?.plate).toEqual([40, 28])
    expect(measured?.glyph).toEqual([24, 24])
    expect(measured?.fab).toEqual([24, 24])
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
