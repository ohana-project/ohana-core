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

  test('the tab bar is 67px with micro labels', async ({ page }) => {
    // the issue's symptom was a 73px bar from body-size labels; with
    // micro labels it sits at 67px (the prototype's 68 includes the
    // 1px glass hairline the implementation drops)
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesign(page)
    const box = await page.locator('[data-slot=tabbar]').boundingBox()
    expect(box?.height).toBeCloseTo(67, 0)
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
    // the demo row renders 2px over the token floor: the button's body
    // leading, padding and hairlines outgrow its 44px min-height, so
    // the natural bar is 46 + 20px — the reserve's 16px gap absorbs
    // the difference. The floor itself is pinned by the class assertion
    // in action-bar.test.tsx.
    expect(geometry?.barHeight).toBe(66)
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
    // (on a real screen 14px over a 66px default-button row; this
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
