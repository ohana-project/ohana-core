import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The brand accent (blackberry) is shadcn's primary role; shadcn's accent
 * role is the 6% fg-soft hover fill (docs/design/README.md,
 * "Implementation"). Feature code that asks for accent text or an accent
 * tile gets near-invisible text or a grey tile (issue #57), so in feature
 * code the hover-fill role may appear only behind a hover, focus or
 * active variant — never as a text colour and never as a resting
 * background. The design system itself (src/ui) is exempt where the
 * README prescribes an fg-soft fill at rest (the count badge, the
 * switch's off track).
 *
 * The same scan refuses `-accent-soft` utilities: `accent-soft` is a CSS
 * token, not a Tailwind colour, so `bg-accent-soft` compiles to nothing
 * and silently drops the fill — the soft accent tint's utility is
 * `bg-primary-soft`.
 */

/** The directories whose code renders screens (architecture.md, web layout). */
const featureDirs = ['src/features', 'src/app', 'src/routes']

/** A class token: any number of variant prefixes (hover:, dark:, group-hover/x:, data-[state=open]:) then the utility. */
const token = (utility: string): RegExp =>
  new RegExp(`(?<![\\w-])((?:[\\w\\-/\\[\\]=.]+:)*)${utility}(?![\\w-])`, 'g')

/** Utilities that would set the accent role as a text colour. */
const textColourUses = token('text-accent')

/** Utilities that would set the accent role as a fill; the only resting
 *  fill the spec prescribes is the soft accent tint, named primary-soft. */
const restingFillUses = token('bg-accent')

/** Any utility on the non-existent accent-soft colour. A word character
 *  before the colour (`bg-accent-soft`) is required, so the CSS token's
 *  own name (`'--accent-soft'`, named by the preview route's swatch list)
 *  does not read as a class. */
const softAccentUses = /(?<![\w-])((?:[\w\-/[\]=.]+:)*)[\w]+-accent-soft(?![\w-])/g

/** The variants behind which the hover fill may appear. */
const interactionVariants = new Set([
  'hover',
  'focus',
  'focus-visible',
  'focus-within',
  'active',
  'group-hover',
  'peer-hover',
  'group-focus',
  'peer-focus',
])

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

/** line:token pairs for every match of `pattern` the checker rejects. */
function violationsOf(
  source: string,
  pattern: RegExp,
  reject: (match: RegExpMatchArray) => boolean,
): string[] {
  return [...source.matchAll(pattern)].flatMap((match) => {
    if (!reject(match)) return []
    const line = source.slice(0, match.index).split('\n').length
    return [`${line}:${match[0]}`]
  })
}

describe('the hover-fill accent role in feature code', () => {
  const sources = featureDirs.flatMap((dir) =>
    walk(dir).map((path) => ({ path, source: readFileSync(path, 'utf8') })),
  )

  it('is never the text colour', () => {
    const found = sources.flatMap(({ path, source }) =>
      violationsOf(source, textColourUses, () => true).map((at) => `${path}:${at}`),
    )
    expect(found, 'accent text is near-invisible: the brand accent is text-primary').toEqual([])
  })

  it('fills only behind hover, focus or active', () => {
    const found = sources.flatMap(({ path, source }) =>
      violationsOf(source, restingFillUses, (match) => {
        const variants = (match[1] ?? '').split(':').filter(Boolean)
        return !variants.some((variant) => interactionVariants.has(variant))
      }).map((at) => `${path}:${at}`),
    )
    expect(
      found,
      'a resting grey fill reads as a disabled tile: use the brand accent (bg-primary) or its soft tint (bg-primary-soft)',
    ).toEqual([])
  })

  it('never uses the non-existent accent-soft utility', () => {
    const found = sources.flatMap(({ path, source }) =>
      violationsOf(source, softAccentUses, () => true).map((at) => `${path}:${at}`),
    )
    expect(
      found,
      'accent-soft is a CSS token, not a Tailwind colour: the soft accent tint is bg-primary-soft',
    ).toEqual([])
  })
})
