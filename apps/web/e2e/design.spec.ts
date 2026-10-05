import { expect, type Page, test } from '@playwright/test'

import { tokenFill } from './tokens.ts'

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
  // every measuring spec reads metrics, so wait out the webfonts
  await page.evaluate(() => document.fonts.ready)
}

/**
 * Measures must see the static layout: the app's own reduced-motion
 * reset (src/index.css) stops every animation, so the pending button's
 * spinner is caught unrotated instead of mid-spin, and the emulation
 * survives any navigation.
 */
async function freezeMotion(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
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
    await page.getByRole('button', { name: 'Диалог', exact: true }).click()
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

test.describe('the theme item of the demo menus (issue #63)', () => {
  // Both demo menus mirror the shipped user menu (the layouts one
  // through the shipped top bar): the item names the theme a press
  // leads to, in both themes.
  for (const [theme, offered] of [
    ['light', 'Тёмная тема'],
    ['dark', 'Светлая тема'],
  ] as const) {
    test(`the demo menus offer the theme a press leads to in ${theme}`, async ({ page }) => {
      await openDesign(page, { theme })

      await page.getByRole('button', { name: 'Меню', exact: true }).click()
      const item = page.getByRole('menuitem', { name: offered })
      await expect(item).toBeVisible()
      await page.keyboard.press('Escape')
      // The first popup must be gone before the second opens: both
      // items share the accessible name.
      await expect(item).toBeHidden()

      await page.getByRole('button', { name: 'Меню пользователя' }).click()
      await expect(item).toBeVisible()
    })
  }
})

test.describe('icon sizes (issue #55)', () => {
  /**
   * Every context sizes its own icons (docs/design/README.md
   * "Components" and the prototype's `svg` rules); the preview passes
   * no size, so the rendered pixels pin the design language.
   */
  test('each context dictates its icon size at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openDesign(page)
    await freezeMotion(page)

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
        noteBlock: boxes('[data-slot="note-block"] > svg'),
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
      noteBlock: [20, 20],
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
    await freezeMotion(page)
    await page.getByRole('button', { name: 'Меню', exact: true }).click()
    // the menu mounts in a portal after the click; the poll rides out
    // the tail of its opening transition before the boxes are read
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll('[role="menuitem"] svg')].map((el) => {
            const rect = el.getBoundingClientRect()
            return [rect.width, rect.height]
          }),
        ),
      )
      .toEqual([
        [18, 18],
        [18, 18],
        [18, 18],
        [18, 18],
        [18, 18],
      ])
    await page.keyboard.press('Escape')
  })

  test('the tab bar keeps its 40×28 plate with a 24px glyph at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    await freezeMotion(page)
    // the FAB demo yields to the action bar demo (the screens that
    // mount the bar never carry a FAB), so drop the bar first
    await page.locator('#layouts').getByRole('switch').click()

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
    // the rendered sizes of the four monogram steps (issue #60: 11, 13,
    // 15 and 20px for the 24, 32, 40 and 56px avatars)
    const INK_FONT_SIZES = { xs: '11px', sm: '13px', default: '15px', lg: '20px' }
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

  test('the tab bar is 68px with micro labels', async ({ page }) => {
    // the issue's symptom was a 73px bar from body-size labels; with
    // micro labels it sits at the prototype's 68px — the glass top
    // hairline came back with issue #62 (docs/design/README.md, "Glass")
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const box = await page.locator('[data-slot=tabbar]').boundingBox()
    expect(box?.height).toBeCloseTo(68, 0)
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

  test('a row carries the prototype padding, gap, type sizes and hover', async ({ page }) => {
    await openDesign(page)
    // the row-heights demo card: the one list card holding an xl row
    const heightsCard = page
      .locator('[data-slot="card"][data-variant="list"]')
      .filter({ has: page.locator('[data-slot="item"][data-size="xl"]') })
    await expect(heightsCard).toHaveCount(1)
    const row = heightsCard.locator('[data-slot="item"][data-size="sm"]')
    await expect(row).toBeVisible()
    const shape = await row.evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        paddingTop: s.paddingTop,
        paddingRight: s.paddingRight,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,
        columnGap: s.columnGap,
      }
    })
    expect(shape).toEqual({
      paddingTop: '10px',
      paddingRight: '14px',
      paddingBottom: '10px',
      paddingLeft: '14px',
      columnGap: '14px',
    })
    const title = row.locator('[data-slot="item-title"]')
    const titleStyle = await title.evaluate((el) => {
      const s = getComputedStyle(el)
      return { fontSize: s.fontSize, fontWeight: s.fontWeight }
    })
    expect(titleStyle).toEqual({ fontSize: '15.5px', fontWeight: '500' })
    const description = row.locator('[data-slot="item-description"]')
    await expect(description).toBeVisible()
    expect(await description.evaluate((el) => getComputedStyle(el).fontSize)).toBe('13.5px')
    // the hover rests on the second surface, read from the token itself
    const surface2 = await tokenFill(page, '--surface-2')
    await row.hover()
    await expect(row).toHaveCSS('background-color', surface2)
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
    // the 38px tinted tile stays available through variant="icon",
    // tinted by its tone
    const tile = page
      .locator('[data-slot="item-media"][data-variant="icon"][data-tone="warn"]')
      .first()
    await expect(tile).toBeVisible()
    expect(await tile.evaluate((el) => getComputedStyle(el).width)).toBe('38px')
    const warnFill = await tokenFill(page, '--warn-fill')
    expect(await tile.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(warnFill)
    // a tone on a bare icon colours it without a tile, like the
    // prototype's accent heart
    const tonedBare = page
      .locator('[data-slot="item-media"][data-variant="default"][data-tone="primary"]')
      .first()
    await expect(tonedBare).toBeVisible()
    const accent = await tokenFill(page, '--accent')
    expect(await tonedBare.evaluate((el) => getComputedStyle(el).color)).toBe(accent)
    expect(await tonedBare.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    )
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

test.describe('overlay parity (issue #59)', () => {
  const WIDTHS = [390, 1280]

  test('the dialog and the sheet have no close X and close on a scrim tap', async ({ page }) => {
    await openDesign(page)
    await freezeMotion(page)

    await page.getByRole('button', { name: 'Диалог', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // the old X carried an sr-only «Закрыть»; the prototype has none —
    // the dialog answers Esc and the scrim alone
    expect(await page.getByRole('button', { name: 'Закрыть' }).count()).toBe(0)
    // the 440px popup is centred; 16px from the edge is the scrim
    await page.mouse.click(16, 450)
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: 'Шторка' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    expect(await page.getByRole('button', { name: 'Закрыть' }).count()).toBe(0)
    await page.mouse.click(16, 450)
    await expect(sheet).toBeHidden()
  })

  test('the mobile sheet closes on a tap above it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    await page.getByRole('button', { name: 'Шторка' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    // the drawer fills the bottom; the strip above it is the scrim
    await page.mouse.click(195, 40)
    await expect(sheet).toBeHidden()
  })

  for (const width of [390, 360]) {
    test(`the long-label confirm keeps equal buttons at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openDesign(page)
      await freezeMotion(page)
      await page.getByRole('button', { name: 'Диалог с длинным действием' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      const row = await page.evaluate(() => {
        const footer = document.querySelector('[data-slot="dialog-footer"]')
        const buttons = [...(footer?.querySelectorAll('button') ?? [])]
        const boxes = buttons.map((button) => button.getBoundingClientRect())
        return {
          labels: buttons.map((button) => button.textContent?.trim()),
          sameRow: boxes.length === 2 && Math.abs(boxes[0].top - boxes[1].top) <= 1,
          equalWidth: boxes.length === 2 && Math.abs(boxes[0].width - boxes[1].width) <= 1,
          cancelLeft: boxes.length === 2 && boxes[0].left < boxes[1].left,
          // «Сделать владельцем» wraps inside its half; nothing may
          // overflow the button or the footer
          buttonsFit:
            boxes.length === 2 &&
            buttons.every((button) => button.scrollWidth <= button.clientWidth),
          footerFits: !!footer && footer.scrollWidth <= footer.clientWidth,
        }
      })
      expect(row.labels, JSON.stringify(row)).toEqual(['Отмена', 'Сделать владельцем'])
      expect(row.sameRow, JSON.stringify(row)).toBe(true)
      expect(row.equalWidth, JSON.stringify(row)).toBe(true)
      expect(row.cancelLeft, JSON.stringify(row)).toBe(true)
      expect(row.buttonsFit, JSON.stringify(row)).toBe(true)
      expect(row.footerFits, JSON.stringify(row)).toBe(true)
      await page.keyboard.press('Escape')
    })
  }

  test('a single long word stays inside its button at the 360px floor', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 })
    await openDesign(page)
    await freezeMotion(page)
    await page.getByRole('button', { name: 'Диалог с длинным действием' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // «Перевыпустить» cannot wrap: with min-w-0 its button stays equal
    // and the word runs into the padding without leaving the button
    const row = await page.evaluate(async () => {
      const footer = document.querySelector('[data-slot="dialog-footer"]')
      const confirm = footer?.querySelectorAll('button')[1]
      if (!confirm) return null
      confirm.textContent = 'Перевыпустить'
      // fonts.ready waits out the load but also accepts a failed face;
      // the family check pins the measurement to Golos Text
      await document.fonts.ready
      const golos = getComputedStyle(confirm).fontFamily.includes('Golos')
      const range = document.createRange()
      range.selectNodeContents(confirm)
      const text = range.getBoundingClientRect()
      const box = confirm.getBoundingClientRect()
      const boxes = [...footer.querySelectorAll('button')].map((button) =>
        button.getBoundingClientRect(),
      )
      return {
        golos,
        equalWidth: Math.abs(boxes[0].width - boxes[1].width) <= 1,
        slackLeft: text.left - box.left,
        slackRight: box.right - text.right,
      }
    })
    expect(row, 'the confirm button renders').not.toBeNull()
    expect(row?.golos, 'the button measures in Golos Text').toBe(true)
    expect(row?.equalWidth, JSON.stringify(row)).toBe(true)
    // exact comparison: the word may sit in the padding, never spill
    expect(row?.slackLeft, JSON.stringify(row)).toBeGreaterThanOrEqual(0)
    expect(row?.slackRight, JSON.stringify(row)).toBeGreaterThanOrEqual(0)
    await page.keyboard.press('Escape')
  })

  for (const [width, height] of [
    [390, 600],
    [1280, 700],
  ] as const) {
    test(`a tall sheet keeps its bottom padding while the popup scrolls at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await openDesign(page)
      await freezeMotion(page)
      await page.getByRole('button', { name: 'Шторка' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()

      // grow the body past the 86dvh cap, then read the geometry at the
      // bottom of the scroll
      const gap = await page.evaluate(() => {
        const popup = document.querySelector('[data-slot="sheet-content"]')
        const body = document.querySelector('[data-slot="sheet-body"]')
        if (!popup || !body) return null
        const spacer = document.createElement('div')
        // like real content, the spacer refuses to shrink below its
        // height — that is the behaviour under test
        spacer.style.height = '900px'
        spacer.style.flexShrink = '0'
        body.append(spacer)
        popup.scrollTop = popup.scrollHeight
        const popupRect = popup.getBoundingClientRect()
        const last = body.lastElementChild
        if (!last) return null
        // the popup's own padding sits under the last child
        const padding = Number.parseFloat(getComputedStyle(popup).paddingBottom)
        return {
          padding,
          gap: popupRect.bottom - last.getBoundingClientRect().bottom,
          scrolls: popup.scrollHeight > popup.clientHeight,
        }
      })
      expect(gap?.scrolls, 'the injected content makes the sheet scroll').toBe(true)
      expect(gap?.padding, 'the sheet declares its 20px bottom padding').toBeCloseTo(20, 0)
      expect(gap?.gap, JSON.stringify(gap)).toBeGreaterThanOrEqual(18)
      await page.keyboard.press('Escape')
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    for (const width of WIDTHS) {
      test(`the confirm dialog keeps its row at ${width}px in the ${theme} theme`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 })
        await openDesign(page, { theme })
        await freezeMotion(page)
        await page.getByRole('button', { name: 'Диалог', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()

        const row = await page.evaluate(() => {
          const buttons = [
            ...(document.querySelector('[data-slot="dialog-footer"]')?.querySelectorAll('button') ??
              []),
          ]
          const description = document.querySelector('[data-slot="dialog-description"]')
          const boxes = buttons.map((button) => button.getBoundingClientRect())
          return {
            labels: buttons.map((button) => button.textContent?.trim()),
            sameRow: boxes.length === 2 && Math.abs(boxes[0].top - boxes[1].top) <= 1,
            equalWidth: boxes.length === 2 && Math.abs(boxes[0].width - boxes[1].width) <= 1,
            cancelLeft: boxes.length === 2 && boxes[0].left < boxes[1].left,
            // the text sits 18px above the buttons (the prototype's
            // confirm: `.sheet-sub` margin-bottom 18px)
            textGap:
              description && boxes[0]
                ? boxes[0].top - description.getBoundingClientRect().bottom
                : null,
          }
        })
        expect(row.labels, JSON.stringify(row)).toEqual(['Отмена', 'Удалить'])
        expect(row.sameRow, JSON.stringify(row)).toBe(true)
        expect(row.equalWidth, JSON.stringify(row)).toBe(true)
        expect(row.cancelLeft, JSON.stringify(row)).toBe(true)
        expect(row.textGap, JSON.stringify(row)).toBeCloseTo(18, 0)
        await page.keyboard.press('Escape')
      })
    }
  }

  test('the confirm dialog reads Cancel in English', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await openDesign(page, { locale: 'en' })
    await page.getByRole('button', { name: 'Dialog', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const labels = await page
      .locator('[data-slot="dialog-footer"] button')
      .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim()))
    expect(labels).toEqual(['Cancel', 'Delete'])
    await page.keyboard.press('Escape')
  })

  for (const width of WIDTHS) {
    test(`the sheet grabber and borders match the prototype at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openDesign(page)
      await freezeMotion(page)
      await page.getByRole('button', { name: 'Шторка' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()

      const shape = await page.evaluate(() => {
        const popup = document.querySelector('[data-slot="sheet-content"]')
        const grabber = document.querySelector('[data-slot="sheet-grabber"]')
        if (!popup || !grabber) return null
        const popupStyle = getComputedStyle(popup)
        const grabberStyle = getComputedStyle(grabber)
        return {
          grabberDisplay: grabberStyle.display,
          grabberMarginTop: grabberStyle.marginTop,
          grabberMarginBottom: grabberStyle.marginBottom,
          borderTop: popupStyle.borderTopWidth,
          borderRight: popupStyle.borderRightWidth,
          borderBottom: popupStyle.borderBottomWidth,
          borderLeft: popupStyle.borderLeftWidth,
        }
      })
      expect(shape, 'the sheet renders').not.toBeNull()

      if (width >= 920) {
        // the desktop modal: no grabber, the full hairline
        expect(shape?.grabberDisplay).toBe('none')
        expect(shape?.borderTop).toBe('1px')
        expect(shape?.borderRight).toBe('1px')
        expect(shape?.borderBottom).toBe('1px')
        expect(shape?.borderLeft).toBe('1px')
      } else {
        // the mobile drawer: the grabber `6px auto 14px`, only the top
        // hairline
        expect(shape?.grabberMarginTop).toBe('6px')
        expect(shape?.grabberMarginBottom).toBe('14px')
        expect(shape?.borderTop).toBe('1px')
        expect(shape?.borderRight).toBe('0px')
        expect(shape?.borderBottom).toBe('0px')
        expect(shape?.borderLeft).toBe('0px')
      }
      await page.keyboard.press('Escape')
    })
  }

  for (const width of WIDTHS) {
    test(`menu items and separators keep the prototype geometry at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await openDesign(page)
      await page.getByRole('button', { name: 'Меню', exact: true }).click()
      const item = page.getByRole('menuitem').first()
      await expect(item).toBeVisible()
      await expect(item).toHaveCSS('min-height', '42px')
      await expect(item).toHaveCSS('font-size', '14.5px')

      const separator = page.locator('[data-slot="dropdown-menu-separator"]').first()
      await expect(separator).toHaveCSS('margin-top', '6px')
      await expect(separator).toHaveCSS('margin-bottom', '6px')
      await expect(separator).toHaveCSS('margin-left', '4px')
      await expect(separator).toHaveCSS('margin-right', '4px')
      await page.keyboard.press('Escape')
    })
  }

  for (const width of WIDTHS) {
    test(`the popover is as wide as its content, never below 208px, at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await openDesign(page)
      await page.getByRole('button', { name: 'Поповер' }).click()
      const popup = page.locator('[data-slot="popover-content"]')
      await expect(popup).toBeVisible()
      const box = await popup.boundingBox()
      expect(box?.width, 'the 208px floor holds').toBeGreaterThanOrEqual(208)
      // not the fixed 288px the audit found: a short phrase sits close
      // to the floor
      expect(box?.width, 'the width follows the content').toBeLessThan(288)
      await page.keyboard.press('Escape')
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`the toast is icon and text only at 14.5px in the ${theme} theme`, async ({ page }) => {
      await openDesign(page, { theme })
      await page.getByRole('button', { name: 'Ок', exact: true }).click()
      const toastRoot = page.locator('[data-slot="toast"]').first()
      await expect(toastRoot).toBeVisible()
      await expect(toastRoot).toHaveCSS('font-size', '14.5px')
      await expect(toastRoot.locator('svg')).toHaveCount(1)
      // no close control: the toast hides itself and answers a swipe
      expect(await toastRoot.locator('button').count()).toBe(0)
    })
  }
})

test.describe('shared pieces (issue #61)', () => {
  /**
   * The demo shell box: the transformed container that pins the
   * member shell's fixed chrome (the tab bar, the action bar) inside
   * the preview.
   */
  function demoShell(page: Page) {
    return page
      .locator('#layouts')
      .locator('div')
      .filter({ has: page.locator('[data-slot="tabbar"]') })
      .first()
  }

  test('the note block carries the prototype values in both themes', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await openDesign(page, { theme })
      const note = page.locator('[data-slot="note-block"]').first()
      await expect(note).toBeVisible()
      const shape = await note.evaluate((el) => {
        const s = getComputedStyle(el)
        return {
          padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
          columnGap: s.columnGap,
          borderRadius: s.borderRadius,
          backgroundColor: s.backgroundColor,
          borderTopColor: s.borderTopColor,
          borderWidth: s.borderTopWidth,
        }
      })
      // soft accent fill and the 22% accent hairline, each read from
      // the token the way the component draws it
      const fill = await tokenFill(page, '--accent-soft')
      const hairline = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.borderColor = 'color-mix(in oklch, var(--accent) 22%, transparent)'
        document.body.append(probe)
        const colour = getComputedStyle(probe).borderTopColor
        probe.remove()
        return colour
      })
      expect(shape).toEqual({
        padding: ['16px', '16px', '16px', '16px'],
        columnGap: '14px',
        borderRadius: '18px',
        backgroundColor: fill,
        borderTopColor: hairline,
        borderWidth: '1px',
      })
      // the accent icon is 20px and coloured by the accent
      const icon = note.locator('> svg')
      const box = await icon.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return { size: [rect.width, rect.height], colour: getComputedStyle(el).color }
      })
      expect(box.size).toEqual([20, 20])
      expect(box.colour).toBe(await tokenFill(page, '--accent'))
    }
  })

  test('the action bar sits flush above the tab bar at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const bar = demoShell(page).locator('[data-slot="action-bar"]')
    await expect(bar).toBeVisible()
    const geometry = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector('#layouts')?.querySelector(selector)?.getBoundingClientRect()
      const barBox = box('[data-slot="action-bar"]')
      const tabBox = box('[data-slot="tabbar"]')
      if (!barBox || !tabBox) return null
      const button = document
        .querySelector('#layouts')
        ?.querySelector('[data-slot="action-bar"] [data-slot="button"]')
        ?.getBoundingClientRect()
      return {
        tuck: barBox.bottom - tabBox.top,
        buttonBottom: button?.bottom,
        tabTop: tabBox.top,
        barHeight: Math.round(barBox.height),
        sameBleed: barBox.left === tabBox.left && barBox.right === tabBox.right,
      }
    })
    expect(geometry, 'the demo shell renders at 390px').not.toBeNull()
    // the demo row renders 1px over the token floor: the button's 15px
    // text on the body's 1.55 leading, its padding and hairlines
    // outgrow the 44px min-height, so the natural bar is 45.25 + 20px —
    // the reserve's 16px gap absorbs the difference. The floor itself
    // is pinned by the class assertion in action-bar.test.tsx.
    expect(geometry?.barHeight).toBe(65)
    // the action bar's lowest 3px tuck under the tab bar's glass — the
    // 64px --tabbar-h offset is 3px less than the rendered 67px tab
    // bar — so the two sit flush, and the tab bar, later in the shell,
    // paints over the tuck
    expect(geometry?.tuck).toBeGreaterThanOrEqual(2)
    expect(geometry?.tuck).toBeLessThanOrEqual(4)
    // the bar's buttons are never covered by the tab bar
    expect(geometry?.buttonBottom).toBeLessThan(geometry?.tabTop ?? 0)
    // edge to edge, like the prototype's bars — the demo box is the
    // fixed bar's containing block, so full bleed means sharing the
    // tab bar's exact span
    expect(geometry?.sameBleed).toBe(true)
  })

  test('the action bar is hidden from 920px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openDesign(page)
    await expect(demoShell(page).locator('[data-slot="action-bar"]')).toBeHidden()
    // the desktop reserve ignores the bar: the has-data rule outranks
    // the plain desktop padding on specificity, so dropping that class
    // would leave the mobile 144px reserve on desktop with nothing
    // failing but this
    await expect(demoShell(page).locator('main')).toHaveCSS('padding-bottom', '48px')
  })

  test('mounting the action bar grows the shell bottom reserve', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const main = demoShell(page).locator('main')
    const paddingBottom = () => main.evaluate((el) => getComputedStyle(el).paddingBottom)
    // the bar is mounted by default: tab bar (64) + safe area (0 in
    // the test browser) + the bar's --action-bar-h (64px) + a 16px gap
    expect(await paddingBottom()).toBe('144px')
    await page.locator('#layouts').getByRole('switch').click()
    // unmounted: the ordinary tab bar reserve returns
    expect(await paddingBottom()).toBe('92px')
    await page.locator('#layouts').getByRole('switch').click()
    expect(await paddingBottom()).toBe('144px')
  })

  test('toasts lift above a mounted action bar', async ({ page }) => {
    const viewport = page.locator('[data-slot="toast-viewport"]')
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page, { locale: 'en' })
    await freezeMotion(page)
    // fire a real toast first, so the run exercises the actual
    // pipeline; what the assertions pin is the toast viewport's bottom
    // offset — the pill renders flush with its bottom edge, which the
    // geometry read below proves while the toast is up — and the
    // element stays mounted with its offset after the toast hides
    await page.locator('#feedback').getByRole('button', { name: 'OK', exact: true }).click()
    // bar mounted by default: the reserve's own measure — tab bar (64)
    // + safe area (0) + the bar's --action-bar-h (64px) + the 16px gap
    await expect(viewport).toHaveCSS('bottom', '144px')
    // the pill sits flush with the toast viewport's bottom edge, so the
    // 144px offset just asserted is the pill's own distance from the
    // page bottom — 16px over the tab bar reserve plus --action-bar-h
    // (on a real screen 15px over a 65px default-button row; this
    // demo's bar lives inside the transformed demo box, so the test
    // does not compare the two)
    const pill = viewport.locator('[data-slot="toast"]')
    await expect(pill).toBeVisible()
    await expect
      .poll(
        async () => {
          const [p, v] = await Promise.all([pill.boundingBox(), viewport.boundingBox()])
          return p && v ? Math.abs(p.y + p.height - (v.y + v.height)) : Number.POSITIVE_INFINITY
        },
        { message: 'the pill stays flush with the toast viewport while the toast is up' },
      )
      .toBeLessThanOrEqual(1)
    await page.locator('#layouts').getByRole('switch').click()
    // bar unmounted: the plain tab-bar-plus-gap offset returns
    await expect(viewport).toHaveCSS('bottom', '80px')
    await page.locator('#layouts').getByRole('switch').click()
    await expect(viewport).toHaveCSS('bottom', '144px')
    // from 920px the bar is gone and the viewport sits at its own 24px
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(viewport).toHaveCSS('bottom', '24px')
  })
})

test.describe('buttons, switch and avatar stack match the prototype (issue #60)', () => {
  test('buttons carry the prototype text sizes and paddings', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openDesign(page)
    const buttons = page.locator('#buttons [data-slot="button"]')

    // .btn 15px, .btn-sm 14px, .btn-lg 16.5px — the prototype's own
    // values, not type-scale steps. Exact text: «Маленькая ссылка»
    // contains «Ссылка», and only strict matching picks the right button
    const fontSizeOf = async (name: string) => {
      const button = buttons.filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) })
      await expect(button).toHaveCount(1)
      return button.first().evaluate((el) => getComputedStyle(el).fontSize)
    }
    await expect(fontSizeOf('Главная')).resolves.toBe('15px')
    await expect(fontSizeOf('Маленькая')).resolves.toBe('14px')
    await expect(fontSizeOf('Большая')).resolves.toBe('16.5px')

    // .btn-link: 8px of side padding — the size's 20px must not win
    const link = buttons.filter({ hasText: /^\s*Ссылка\s*$/ })
    await expect(link).toHaveCount(1)
    const linkPadding = await link.evaluate((el) => {
      const s = getComputedStyle(el)
      return [s.paddingLeft, s.paddingRight]
    })
    expect(linkPadding).toEqual(['8px', '8px'])

    // a small link is an sm button first (.btn-sm follows .btn-link):
    // 36px tall, 6px of vertical and 14px of side padding
    const linkSm = buttons.filter({ hasText: /^\s*Маленькая ссылка\s*$/ })
    await expect(linkSm).toHaveCount(1)
    const linkSmShape = await linkSm.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return {
        height: rect.height,
        padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
      }
    })
    expect(linkSmShape.height).toBeCloseTo(36, 5)
    expect(linkSmShape.padding).toEqual(['6px', '14px', '6px', '14px'])

    // .btn-icon 44px round, .btn-icon.btn-sm 36px round
    const shapeOf = async (label: string) => {
      const button = page.getByRole('button', { name: label, exact: true }).first()
      await expect(button).toBeVisible()
      return button.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return {
          box: [rect.width, rect.height],
          radius: Number.parseFloat(s.borderRadius),
        }
      })
    }
    const icon = await shapeOf('Иконка')
    expect(icon.box).toEqual([44, 44])
    const iconSm = await shapeOf('Маленькая иконка')
    expect(iconSm.box).toEqual([36, 36])
    // rounded-full computes to a huge radius in Tailwind v4
    expect(icon.radius).toBeGreaterThan(100)
    expect(iconSm.radius).toBeGreaterThan(100)
  })

  test('the switch thumb sits 3px inside the track border in both states', async ({ page }) => {
    await openDesign(page)
    // the 20px thumb with 3px of padding: 3px inside the border on the
    // side it rests against, 21px on the other, in either state
    const UNCHECKED = { left: 3, right: 21, top: 3 }
    const CHECKED = { left: 21, right: 3, top: 3 }
    const inset = () =>
      page.evaluate(() => {
        const track = document.querySelector('#controls [data-slot="switch"]')
        const thumb = document.querySelector('#controls [data-slot="switch-thumb"]')
        if (!(track instanceof HTMLElement) || !(thumb instanceof HTMLElement)) return null
        const trackBox = track.getBoundingClientRect()
        const thumbBox = thumb.getBoundingClientRect()
        const style = getComputedStyle(track)
        return {
          left: Math.round(
            thumbBox.left - (trackBox.left + Number.parseFloat(style.borderLeftWidth)),
          ),
          right: Math.round(
            trackBox.right - Number.parseFloat(style.borderRightWidth) - thumbBox.right,
          ),
          top: Math.round(thumbBox.top - (trackBox.top + Number.parseFloat(style.borderTopWidth))),
        }
      })
    const checkedState = () =>
      page.locator('#controls [data-slot="switch"]').getAttribute('data-checked')

    const before = await checkedState()
    await expect.poll(inset).toEqual(before === null ? UNCHECKED : CHECKED)

    await page.locator('#controls [data-slot="switch"]').click()
    const after = await checkedState()
    expect((after === null) === (before === null), 'the click toggled the switch').toBe(false)
    await expect.poll(inset).toEqual(after === null ? UNCHECKED : CHECKED)
  })

  test('the avatar stack overlaps by 8px behind a page-background rim', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openDesign(page)
    const bg = await tokenFill(page, '--bg')

    // wherever the stack sits — free-standing (badges) and inside a
    // list row's media (the admin demo) — the geometry is the same
    const stacks = [
      page.locator('#badges [data-slot="avatar-stack"]'),
      page.locator('#layouts [data-slot="item-media"] [data-slot="avatar-stack"]'),
    ]
    for (const [place, stack] of stacks.entries()) {
      await expect(stack).toBeVisible()
      const shape = await stack.evaluate((el) => {
        const avatars = [...el.querySelectorAll('[data-slot="avatar"]')]
        const boxes = avatars.map((a) => a.getBoundingClientRect())
        return {
          firstMargin: getComputedStyle(avatars[0]).marginLeft,
          travel: boxes.slice(1).map((box, i) => box.left - boxes[i].left),
          restMargins: avatars.slice(1).map((a) => getComputedStyle(a).marginLeft),
          rims: avatars.slice(1).map((a) => {
            const s = getComputedStyle(a)
            return [s.borderTopWidth, s.borderTopColor]
          }),
        }
      })
      // the first avatar carries no pull of its own, the rest sit 8px
      // into it (32px avatars 24px apart), behind the 2px page rim
      expect(shape.firstMargin, `stack ${place} first avatar`).toBe('0px')
      expect(shape.restMargins, `stack ${place} rest`).toEqual(
        new Array(shape.rims.length).fill('-8px'),
      )
      expect(shape.travel, `stack ${place}`).toEqual(new Array(shape.rims.length).fill(24))
      for (const rim of shape.rims) {
        expect(rim, `stack ${place} rim`).toEqual(['2px', bg])
      }
    }
  })

  test('while syncing only the icon is accent and the label stays muted', async ({ page }) => {
    await openDesign(page)
    const accent = await tokenFill(page, '--accent')
    const muted = await tokenFill(page, '--muted')
    const ok = await tokenFill(page, '--ok')
    const colours = (state: string) =>
      page
        .locator(`#feedback [data-slot="sync-status"][data-state="${state}"]`)
        .first()
        .evaluate((el) => {
          const icon = el.querySelector('svg')
          const label = el.querySelector('[data-slot="sync-status-label"]')
          return {
            root: getComputedStyle(el).color,
            icon: icon ? getComputedStyle(icon).color : null,
            label: label ? getComputedStyle(label).color : null,
          }
        })
    for (const state of ['first', 'updating']) {
      const c = await colours(state)
      expect(c.root, `${state} root`).toBe(muted)
      expect(c.icon, `${state} icon`).toBe(accent)
      expect(c.label, `${state} label`).toBe(muted)
    }
    // a settled state keeps its semantic glyph
    const synced = await colours('synced')
    expect(synced.icon).toBe(ok)
    expect(synced.root).toBe(muted)
  })

  test('the sync text hides at 430px and below only in the top bar', async ({ page }) => {
    // sr-only works on the label through a descendant rule, so the
    // hiding is read off the computed position, not the class list
    const labelHidden = () =>
      page.evaluate(() => {
        const chipLabel = document.querySelector(
          '[data-slot="topbar"] [data-slot="sync-status-label"]',
        )
        const fullLabel = document.querySelector('#feedback [data-slot="sync-status-label"]')
        const outOfFlow = (el: Element | null) =>
          el instanceof HTMLElement ? getComputedStyle(el).position === 'absolute' : null
        return { chip: outOfFlow(chipLabel), full: outOfFlow(fullLabel) }
      })

    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    await expect.poll(labelHidden).toEqual({ chip: true, full: false })

    // 430px itself is inside the prototype's max-width: 430px — a real
    // device width, so the boundary is pinned exactly
    await page.setViewportSize({ width: 430, height: 844 })
    await expect.poll(labelHidden).toEqual({ chip: true, full: false })

    await page.setViewportSize({ width: 431, height: 844 })
    await expect.poll(labelHidden).toEqual({ chip: false, full: false })
  })

  test('the focus ring rounds to the small radius', async ({ page }) => {
    await openDesign(page)
    // the app's one global :focus-visible rule carries the small
    // radius; it lives inside the base layer, so the walk descends
    // through grouping rules
    const rule = await page.evaluate(() => {
      const find = (rules: CSSRuleList): string | null => {
        for (const style of rules) {
          if (
            style instanceof CSSStyleRule &&
            style.selectorText.trim() === ':focus-visible' &&
            style.style.borderRadius
          ) {
            return style.style.borderRadius
          }
          if (
            style instanceof CSSLayerBlockRule ||
            style instanceof CSSMediaRule ||
            style instanceof CSSSupportsRule
          ) {
            const nested = find(style.cssRules)
            if (nested) return nested
          }
        }
        return null
      }
      for (const sheet of document.styleSheets) {
        const found = find(sheet.cssRules)
        if (found) return found
      }
      return null
    })
    // the stylesheet declares the token; the computed check below
    // proves it resolves to the 8px small radius
    expect(['8px', 'var(--radius-sm)'], 'the :focus-visible rule').toContain(rule)

    // and a keyboard-focused element without a radius of its own rounds
    // to it: walk to the lists demo's section-header link, a plain <a>
    const TARGET = '#lists [data-slot="section-header"] a[href="#lists"]'
    await page.keyboard.press('Tab')
    let onTarget = false
    for (let step = 0; step < 150; step += 1) {
      onTarget = await page.evaluate(
        ([selector]) => document.activeElement?.matches(selector) ?? false,
        [TARGET],
      )
      if (onTarget) break
      await page.keyboard.press('Tab')
    }
    expect(onTarget, 'tabbed to the section-header link').toBe(true)
    const radius = await page.evaluate(
      ([selector]) => {
        const wanted = document.querySelector(selector)
        return wanted instanceof HTMLElement && wanted.matches(':focus-visible')
          ? getComputedStyle(wanted).borderRadius
          : null
      },
      [TARGET],
    )
    expect(radius, 'the link is :focus-visible and rounds to 8px').toBe('8px')
  })
})

test.describe('the member shell matches the prototype (issue #62)', () => {
  /**
   * The demo shell box: the transformed container that pins the member
   * shell's chrome inside the preview (the same helper the issue #61
   * specs use, read fresh in each block).
   */
  function demoShell(page: Page) {
    return page
      .locator('#layouts')
      .locator('div')
      .filter({ has: page.locator('[data-slot="tabbar"]') })
      .first()
  }

  test('the mobile top bar carries the fg-8% bottom hairline, the token border on desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const bar = demoShell(page).locator('[data-slot="topbar"]')
    const mobile = await bar.evaluate((el) => {
      const s = getComputedStyle(el)
      return { width: s.borderBottomWidth, colour: s.borderBottomColor }
    })
    expect(mobile.width).toBe('1px')
    // the prototype's .topbar hairline: fg 8% over transparency
    const hairline = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.borderColor = 'color-mix(in oklch, var(--fg) 8%, transparent)'
      document.body.append(probe)
      const colour = getComputedStyle(probe).borderTopColor
      probe.remove()
      return colour
    })
    expect(mobile.colour).toBe(hairline)

    await page.setViewportSize({ width: 1280, height: 900 })
    // from 920px up the hairline takes the border token (.topbar's media
    // query), which the dark and light themes both define
    await expect(bar).toHaveCSS('border-bottom-color', await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.borderColor = 'var(--border)'
      document.body.append(probe)
      const colour = getComputedStyle(probe).borderTopColor
      probe.remove()
      return colour
    }))
  })

  test('the tab bar keeps the glass recipe’s top hairline', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const bar = demoShell(page).locator('[data-slot="tabbar"]')
    const hairline = await bar.evaluate((el) => {
      const s = getComputedStyle(el)
      return { top: s.borderTopWidth, bottom: s.borderBottomWidth, left: s.borderLeftWidth }
    })
    // the prototype's .tabbar: the .glass border on the top edge only
    expect(hairline).toEqual({ top: '1px', bottom: '0px', left: '0px' })
  })

  test('the space switcher is as wide as its monogram stack', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const geometry = await demoShell(page).evaluate((root) => {
      const button = root.querySelector<HTMLButtonElement>('[data-slot="topbar-space"]')
      const stack = button?.querySelector('[data-slot="avatar-stack"]')
      if (!button || !stack) return null
      const b = button.getBoundingClientRect()
      const s = stack.getBoundingClientRect()
      return { button: b.width, stack: s.width, left: b.left, stackLeft: s.left }
    })
    expect(geometry, 'the demo shell renders at 390px').not.toBeNull()
    // .topbar .topbar-space { width: auto; padding: 0 6px }: the button
    // hugs the stack, 6px of padding on each side
    expect(geometry?.button).toBeCloseTo((geometry?.stack ?? 0) + 12, 0)
    expect(geometry?.stackLeft).toBeCloseTo((geometry?.left ?? 0) + 6, 0)
  })

  test('the back arrow is the 44px round mobile-only button with an 18px chevron', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const back = demoShell(page).getByRole('link', { name: 'Назад' })
    await expect(back).toBeVisible()
    const shape = await back.evaluate((el) => {
      const s = getComputedStyle(el)
      const icon = el.querySelector('svg')
      const i = icon ? getComputedStyle(icon) : null
      return {
        width: s.width,
        height: s.height,
        radius: s.borderTopLeftRadius,
        colour: s.color,
        iconWidth: i?.width,
        iconColour: i?.color,
      }
    })
    // .btn.btn-icon: 44px round, the main text colour; .btn svg: 18px
    expect(shape.width).toBe('44px')
    expect(shape.height).toBe('44px')
    expect(shape.radius).toBe('999px')
    expect(shape.colour).toBe(await tokenFill(page, '--fg'))
    expect(shape.iconWidth).toBe('18px')
    expect(shape.iconColour).toBe(await tokenFill(page, '--fg'))

    // .m-only: from 920px up the arrow is gone — the sidebar leads back
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(back).toBeHidden()
  })

  test('desktop-only top-bar actions render from 920px and not below', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page, { locale: 'en' })
    const action = demoShell(page).getByRole('button', { name: 'Desktop only' })
    // .d-only: no display below the breakpoint, where the FAB carries
    // the screen's action
    await expect(action).toBeHidden()

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(action).toBeVisible()
  })

  test('the sidebar chevron is 20px', async ({ page }) => {
    await openDesign(page)
    const chevron = demoShell(page).locator('[data-slot="side-space"] svg').last()
    const size = await chevron.evaluate((el) => {
      const s = getComputedStyle(el)
      return [s.width, s.height]
    })
    // the prototype stamps every icon 20px; the switcher's container
    // rule keeps that for the un-sized chevron
    expect(size).toEqual(['20px', '20px'])
  })

  test('an active sidebar item keeps its accent under the pointer', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openDesign(page)
    const active = demoShell(page).locator('[data-slot="nav-item"][aria-current="page"]')
    await expect(active).toBeVisible()
    const atRest = await active.evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, colour: s.color }
    })
    // the hover that greys an active item was the audit's finding: the
    // prototype declares .nav-item.is-active after :hover, so the accent
    // survives the pointer
    await active.hover()
    const onHover = await active.evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, colour: s.color }
    })
    expect(onHover).toEqual(atRest)
    // and it is the accent, not the grey hover fill
    expect(onHover.colour).toBe(await tokenFill(page, '--accent'))
  })
})
