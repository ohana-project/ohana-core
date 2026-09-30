import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { type Oklch, oklch, parse, type Rgb, rgb } from 'culori'
import { describe, expect, it } from 'vitest'

/*
 * WCAG AA contrast for every text-on-background pair the spec uses
 * (docs/design/README.md, "Colour"), asserted straight against
 * tokens.css and glass.css in both themes. Body text needs 4.5:1,
 * large text and icons 3:1. Pills, the banner and glass are
 * semi-transparent fills, so they are composited over their backdrop
 * before measuring. Every percentage below is read from the CSS — the
 * same values the components render with.
 */

type Tokens = Record<string, string>

// ?raw imports of .css files come back empty through the Tailwind plugin,
// so the files are read from disk (tests always run from apps/web).
const tokensCss = readFileSync(resolvePath('src/ui/styles/tokens.css'), 'utf8')
const glassCss = readFileSync(resolvePath('src/ui/styles/glass.css'), 'utf8')

function parseBlock(css: string, selector: string): Tokens {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match?.[1]) throw new Error(`no ${selector} block found`)
  const tokens: Tokens = {}
  for (const m of match[1].matchAll(/--(?<name>[\w-]+)\s*:\s*(?<value>[^;]+);/g)) {
    const { name, value } = m.groups as { name: string; value: string }
    tokens[name] = value.trim()
  }
  return tokens
}

function resolve(name: string, tokens: Tokens): string {
  const value = tokens[name]
  if (!value) throw new Error(`no --${name} token`)
  const ref = value.match(/^var\(--([\w-]+)\)$/)
  return ref?.[1] ? resolve(ref[1], tokens) : value
}

/** Reads a "NN%" custom-property value, e.g. the glass fill alpha. */
function asPercent(name: string, tokens: Tokens): number {
  const value = resolve(name, tokens).match(/^([\d.]+)%$/)
  if (!value?.[1]) throw new Error(`--${name} is not a plain percentage`)
  return Number(value[1]) / 100
}

function asOklch(value: string): Oklch {
  const parsed = parse(value)
  if (!parsed) throw new Error(`unparseable colour: ${value}`)
  // named colours such as `black` parse as rgb
  return oklch(parsed)
}

/** Converts a token value (oklch, possibly a color-mix) to sRGB. */
function asRgb(value: string, tokens: Tokens): Rgb {
  const resolved = value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => resolve(name, tokens))
  const mix = resolved.match(/^color-mix\(in oklch,\s*(.+?)\s+([\d.]+)%,\s*(.+?)\)$/)
  if (mix?.[1] && mix[2] && mix[3]) {
    const [, a, pct, b] = mix
    if (b === 'transparent') {
      const base = rgb(parse(a))
      if (!base) throw new Error(`unparseable colour: ${a}`)
      return { ...base, alpha: Number(pct) / 100 }
    }
    // channel mix in oklch with shorter-arc hue, like the browser
    const ao = asOklch(a)
    const bo = asOklch(b)
    const t = Number(pct) / 100
    // a missing hue (black, white) takes the other colour's, as in CSS
    const ha = ao.h ?? bo.h ?? 0
    const hb = bo.h ?? ao.h ?? 0
    let dh = (ha - hb + 540) % 360
    if (dh > 180) dh -= 360
    return rgb({
      mode: 'oklch',
      l: ao.l * t + bo.l * (1 - t),
      c: (ao.c ?? 0) * t + (bo.c ?? 0) * (1 - t),
      h: hb + dh * t,
    }) as Rgb
  }
  const parsed = rgb(parse(resolved))
  if (!parsed) throw new Error(`unparseable colour: ${resolved}`)
  return { ...parsed, alpha: parsed.alpha ?? 1 }
}

function over(top: Rgb, bottom: Rgb): Rgb {
  const a = top.alpha ?? 1
  return {
    mode: 'rgb',
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    alpha: 1,
  }
}

function luminance(c: Rgb): number {
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

const themes: Record<string, Tokens> = {
  light: parseBlock(tokensCss, ':root'),
  dark: { ...parseBlock(tokensCss, ':root'), ...parseBlock(tokensCss, '[data-theme="dark"]') },
}

/* glass fill alphas, light and dark (glass.css) */
const glassAlphas: Record<string, number> = {
  light: asPercent('glass-a', parseBlock(glassCss, ':root')),
  dark: asPercent('glass-a', {
    ...parseBlock(glassCss, ':root'),
    ...parseBlock(glassCss, '[data-theme="dark"]'),
  }),
}

const WHITE: Rgb = { mode: 'rgb', r: 1, g: 1, b: 1, alpha: 1 }
const BLACK: Rgb = { mode: 'rgb', r: 0, g: 0, b: 0, alpha: 1 }

describe.each(Object.entries(themes))('%s theme', (_theme, tokens) => {
  const glassAlpha = glassAlphas[_theme]
  const color = (name: string) => ({ ...asRgb(resolve(name, tokens), tokens), alpha: 1 })
  const tinted = (fillName: string, base: string) =>
    over(asRgb(resolve(fillName, tokens), tokens), color(base))
  const glass = (backdrop: Rgb) => over({ ...color('surface'), alpha: glassAlpha }, backdrop)
  const check = (fg: Rgb, bg: Rgb, min: number, label: string) => {
    const ratio = contrast(fg, bg)
    expect(ratio, `${label}: ${ratio.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min)
  }

  it('body text meets 4.5:1 on every background', () => {
    for (const background of ['bg', 'surface', 'surface-2']) {
      check(color('fg'), color(background), 4.5, `fg on ${background}`)
    }
    check(color('muted'), color('bg'), 4.5, 'muted on bg')
    check(color('muted'), color('surface'), 4.5, 'muted on surface')
    check(color('accent'), color('bg'), 4.5, 'accent on bg (links)')
    check(color('accent'), color('surface'), 4.5, 'accent on surface (links)')
    check(color('accent-fg'), color('accent'), 4.5, 'accent-fg on accent (primary button)')
    for (const name of ['ok', 'warn', 'danger'] as const) {
      check(color(name), color('bg'), 4.5, `${name} on bg`)
      check(color(name), color('surface'), 4.5, `${name} on surface`)
    }
  })

  it('pill text meets 4.5:1 over its tinted fill', () => {
    check(color('accent'), tinted('accent-fill', 'surface'), 4.5, 'primary pill')
    check(color('ok'), tinted('ok-fill', 'surface'), 4.5, 'ok pill')
    check(color('warn'), tinted('warn-fill', 'surface'), 4.5, 'warn pill')
    check(color('danger'), tinted('danger-fill', 'surface'), 4.5, 'danger pill')
    check(color('muted'), tinted('neutral-fill', 'surface'), 4.5, 'neutral pill')
  })

  it('the offline banner meets 4.5:1', () => {
    check(color('banner-text'), color('banner-fill'), 4.5, 'banner text on its warn fill')
  })

  it('text over glass meets 4.5:1 composited on white and black backdrops', () => {
    // the recipe the overlays and bars render with — popovers, menus and
    // toasts take the plain glass too (README "Glass"). Text on glass:
    // fg; muted (inactive tabs, sync labels, descriptions); accent (the
    // active tab, the syncing label, the retry link) and accent-strong
    // (its hover); danger (the failed sync label, destructive menu items)
    for (const backdrop of [WHITE, BLACK]) {
      const name = backdrop === WHITE ? 'white' : 'black'
      for (const text of ['fg', 'muted', 'accent', 'accent-strong', 'danger']) {
        check(color(text), glass(backdrop), 4.5, `${text} on glass over ${name}`)
      }
      // ok and warn reach glass only as icons (the toast check, the
      // synced and offline sync glyphs), so they need 3:1
      for (const icon of ['ok', 'warn']) {
        check(color(icon), glass(backdrop), 3, `${icon} icon on glass over ${name}`)
      }
    }
  })

  it('text on a tint over glass meets 4.5:1 composited on white and black backdrops', () => {
    // tints that carry text and can sit on glass: the danger button (a
    // dialog footer) at rest and on hover, the destructive menu item's
    // highlight (danger-tint too), and pills inside a sheet. A tint mixed
    // toward transparent lets the backdrop through, so these mix into
    // surface instead (README "Implementation")
    const onTint = [
      ['danger', 'danger-tint'],
      ['danger', 'danger-tint-hover'],
      ['accent', 'accent-fill'],
      ['ok', 'ok-fill'],
      ['warn', 'warn-fill'],
      ['danger', 'danger-fill'],
      ['muted', 'neutral-fill'],
    ] as const
    for (const backdrop of [WHITE, BLACK]) {
      const name = backdrop === WHITE ? 'white' : 'black'
      for (const [text, fill] of onTint) {
        const tint = over(asRgb(resolve(fill, tokens), tokens), glass(backdrop))
        check(color(text), tint, 4.5, `${text} on ${fill} on glass over ${name}`)
      }
    }
  })

  it('icons meet 3:1', () => {
    check(color('accent'), color('surface'), 3, 'accent icon on surface')
    check(color('accent'), color('surface-2'), 3, 'accent icon on surface-2')
    check(color('muted'), color('surface'), 3, 'muted icon on surface')
    check(color('ok'), color('surface'), 3, 'ok icon on surface')
    check(color('warn'), color('surface'), 3, 'warn icon on surface')
    check(color('danger'), color('surface'), 3, 'danger icon on surface')
  })
})
