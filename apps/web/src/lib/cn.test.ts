import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

import { cn, TYPE_SCALE } from './cn.ts'

/*
 * The class merger knows the Ohana type scale (docs/design/README.md,
 * "Typography", declared as --text-* tokens in src/index.css): a
 * type-scale step and a text colour passed together both survive, in
 * either order, and two steps resolve to the later one. Without the
 * configuration the merger reads every custom step as a colour, so
 * whichever of size or colour comes first is silently deleted — tab
 * labels at body size, hints, tooltips, menu labels, avatar monograms
 * without their hue ink (issue #56).
 */

/** Every --text-* step declared in the app theme, the single source of the scale. */
function typeScaleFromTheme(): string[] {
  const css = readFileSync(resolvePath('src/index.css'), 'utf8')
  const theme = css.match(/@theme[^{]*{([\s\S]*?)\n}/)
  if (!theme?.[1]) throw new Error('no @theme block in src/index.css')
  const names = new Set<string>()
  for (const m of theme[1].matchAll(/^\s*--text-([a-z0-9-]+?)\s*(?:--[a-z-]+)?\s*:/gm)) {
    if (m[1]) names.add(m[1])
  }
  if (names.size === 0) throw new Error('no --text-* tokens in the @theme block')
  return [...names]
}

describe('the merger is taught the whole type scale', () => {
  it('TYPE_SCALE names every --text-* step of the app theme, and nothing else', () => {
    expect([...TYPE_SCALE].sort()).toEqual(typeScaleFromTheme().sort())
  })
})

describe.each(TYPE_SCALE)('text-%s', (step) => {
  it('survives a text colour beside it, in either order', () => {
    // the colour classes the components actually set alongside a size
    for (const colour of ['text-muted-foreground', 'text-primary', 'text-background']) {
      expect(cn(`text-${step}`, colour), `${colour} after`).toBe(`text-${step} ${colour}`)
      expect(cn(colour, `text-${step}`), `${colour} before`).toBe(`${colour} text-${step}`)
    }
  })

  it('survives the avatar hue ink beside it', () => {
    const hue = 'text-[oklch(38%_0.08_var(--hue))]'
    expect(cn(hue, `text-${step}`)).toBe(`${hue} text-${step}`)
    expect(cn(`text-${step}`, hue)).toBe(`text-${step} ${hue}`)
  })
})

describe('two type-scale classes', () => {
  it('resolve to the later one', () => {
    for (const a of TYPE_SCALE) {
      for (const b of TYPE_SCALE) {
        expect(cn(`text-${a}`, `text-${b}`), `text-${a} then text-${b}`).toBe(`text-${b}`)
      }
    }
  })
})

describe('default and arbitrary sizes still merge as sizes', () => {
  it('text-sm resolves against another size and coexists with a colour', () => {
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
    expect(cn('text-sm', 'text-current')).toBe('text-sm text-current')
    expect(cn('text-current', 'text-sm')).toBe('text-current text-sm')
  })

  it('the one-off prototype pixel sizes merge as sizes too (issue #60)', () => {
    // the button's 15/14/16.5px and the avatar's 11/13/15/20px are the
    // prototype's own values, not type-scale steps
    for (const size of [
      'text-[11px]',
      'text-[13px]',
      'text-[14px]',
      'text-[15px]',
      'text-[16.5px]',
      'text-[20px]',
    ]) {
      expect(cn(size, 'text-muted-foreground')).toBe(`${size} text-muted-foreground`)
      expect(cn('text-muted-foreground', size)).toBe(`text-muted-foreground ${size}`)
    }
    expect(cn('text-body', 'text-[15px]')).toBe('text-[15px]')
    expect(cn('text-[15px]', 'text-body')).toBe('text-body')
  })
})

describe('text colours still conflict with each other', () => {
  it('the later colour wins', () => {
    expect(cn('text-primary', 'text-muted-foreground')).toBe('text-muted-foreground')
    expect(cn('text-muted-foreground', 'text-primary')).toBe('text-primary')
  })

  it('a variant-carrying colour keeps its own step beside it', () => {
    // the avatar's dark inversion rides a variant, so it never competes
    // with the base size — and the dark side keeps its hue
    expect(cn('text-meta', 'dark:text-[oklch(88%_0.06_var(--hue))]')).toBe(
      'text-meta dark:text-[oklch(88%_0.06_var(--hue))]',
    )
  })
})

describe('steps and line heights', () => {
  it('a line height after the step survives; one before yields', () => {
    // the standard tailwind-merge direction — a size answers for its own
    // line height. meta and micro carry none, so a caller's custom
    // leading goes after the step, never before.
    expect(cn('text-micro', 'leading-none')).toBe('text-micro leading-none')
    expect(cn('leading-none', 'text-micro')).toBe('text-micro')
    expect(cn('text-meta', 'leading-4')).toBe('text-meta leading-4')
  })
})
