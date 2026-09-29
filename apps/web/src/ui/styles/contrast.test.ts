import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { type Oklch, parse, type Rgb, rgb } from 'culori'
import { describe, expect, it } from 'vitest'

/*
 * WCAG AA contrast for every text-on-background pair the spec uses
 * (docs/design/README.md, "Colour"), asserted straight against
 * tokens.css in both themes. Body text needs 4.5:1, large text and
 * icons 3:1. Pills, the banner and glass are semi-transparent fills,
 * so they are composited over their backdrop before measuring.
 */

type Tokens = Record<string, string>

// ?raw imports of .css files come back empty through the Tailwind plugin,
// so the file is read from disk (tests always run from apps/web).
const css = readFileSync(resolvePath('src/ui/styles/tokens.css'), 'utf8')

function parseBlock(selector: string): Tokens {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match?.[1]) throw new Error(`tokens.css has no ${selector} block`)
  const tokens: Tokens = {}
  for (const m of match[1].matchAll(/--(?<name>[\w-]+)\s*:\s*(?<value>[^;]+);/g)) {
    const { name, value } = m.groups as { name: string; value: string }
    tokens[name] = value.trim()
  }
  return tokens
}

function resolve(name: string, tokens: Tokens): string {
  const value = tokens[name]
  if (!value) throw new Error(`tokens.css has no --${name}`)
  const ref = value.match(/^var\(--([\w-]+)\)$/)
  return ref?.[1] ? resolve(ref[1], tokens) : value
}

/** Converts a token value (oklch, possibly a color-mix with transparent) to sRGB. */
function asRgb(value: string, tokens: Tokens): Rgb {
  const resolved = value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => resolve(name, tokens))
  const mix = resolved.match(/^color-mix\(in oklch,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/)
  if (mix?.[1] && mix[2]) {
    const base = rgb(parse(mix[1]))
    if (!base) throw new Error(`unparseable colour: ${mix[1]}`)
    return { ...base, alpha: Number(mix[2]) / 100 }
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

/** color-mix(in oklch, A p%, B) — channel mix in oklch with shorter-arc hue. */
function mixTokens(aName: string, pct: number, bName: string, tokens: Tokens): Rgb {
  const a = parse(resolve(aName, tokens)) as Oklch | undefined
  const b = parse(resolve(bName, tokens)) as Oklch | undefined
  if (!a || !b) throw new Error('unparseable colour in mix')
  const t = pct / 100
  let dh = ((a.h ?? 0) - (b.h ?? 0) + 540) % 360
  if (dh > 180) dh -= 360
  return rgb({
    mode: 'oklch',
    l: a.l * t + b.l * (1 - t),
    c: (a.c ?? 0) * t + (b.c ?? 0) * (1 - t),
    h: (b.h ?? 0) + dh * t,
  }) as Rgb
}

const themes: Record<string, Tokens> = {
  light: parseBlock(':root'),
  dark: { ...parseBlock(':root'), ...parseBlock('[data-theme="dark"]') },
}

/* pill fills from the spec's component section: ok 14%, warn 16%, danger 13% */
const PILL_TINTS = { ok: 14, warn: 16, danger: 13 } as const
/* glass is surface at 82% in light and 92% in dark (README "Glass") */
const GLASS_ALPHA = { light: 0.82, dark: 0.92 } as const
const WHITE: Rgb = { mode: 'rgb', r: 1, g: 1, b: 1, alpha: 1 }
const BLACK: Rgb = { mode: 'rgb', r: 0, g: 0, b: 0, alpha: 1 }

describe.each(Object.entries(themes))('%s theme', (_theme, tokens) => {
  const glassAlpha = GLASS_ALPHA[_theme as keyof typeof GLASS_ALPHA]
  const color = (name: string) => ({ ...asRgb(resolve(name, tokens), tokens), alpha: 1 })
  const tinted = (name: string, pct: number, base: string) =>
    over({ ...asRgb(resolve(name, tokens), tokens), alpha: pct / 100 }, color(base))
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
    check(
      color('accent'),
      over(asRgb(resolve('accent-soft', tokens), tokens), color('surface')),
      4.5,
      'primary pill',
    )
    check(color('ok'), tinted('ok', PILL_TINTS.ok, 'surface'), 4.5, 'ok pill')
    check(color('warn'), tinted('warn', PILL_TINTS.warn, 'surface'), 4.5, 'warn pill')
    check(color('danger'), tinted('danger', PILL_TINTS.danger, 'surface'), 4.5, 'danger pill')
    check(
      color('muted'),
      over(asRgb(resolve('fg-soft', tokens), tokens), color('surface')),
      4.5,
      'neutral pill',
    )
  })

  it('the offline banner meets 4.5:1', () => {
    const text = mixTokens('warn', 80, 'fg', tokens)
    const fill = over({ ...asRgb(resolve('warn', tokens), tokens), alpha: 0.14 }, color('surface'))
    check(text, fill, 4.5, 'banner text on its warn fill')
  })

  it('text over glass meets 4.5:1 composited on white and black backdrops', () => {
    for (const backdrop of [WHITE, BLACK]) {
      const name = backdrop === WHITE ? 'white' : 'black'
      check(color('fg'), glass(backdrop), 4.5, `fg on glass over ${name}`)
      check(color('muted'), glass(backdrop), 4.5, `muted on glass over ${name}`)
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
