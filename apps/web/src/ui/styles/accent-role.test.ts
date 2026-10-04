import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The brand accent (blackberry) is shadcn's primary role; shadcn's accent
 * role is the 6% fg-soft hover fill (docs/design/README.md,
 * "Implementation"). Feature code that asks for accent text or an accent
 * tile gets near-invisible text or a grey tile (issue #57), so in feature
 * code the hover-fill role may appear only as a background behind hover,
 * focus or active — never as a text colour, a resting background, or any
 * other utility colour (icon fills, strokes, hairlines, rings, outlines,
 * underlines, carets, gradient stops). The design system itself (src/ui)
 * is exempt where the README prescribes an fg-soft fill at rest (the
 * count badge, the switch's off track).
 *
 * The same scan refuses `-accent-soft` utilities: `accent-soft` is a CSS
 * token, not a Tailwind colour, so `bg-accent-soft` compiles to nothing
 * and silently drops the fill — the soft accent tint's utility is
 * `bg-primary-soft`. Arbitrary variants (`[&:hover]:`, `has-[:focus]:`)
 * are not understood and are refused from the safe side.
 */

/** The directories whose code renders screens (architecture.md, web layout). */
const featureDirs = ['src/features', 'src/app', 'src/routes']

/** A class token: any number of variant prefixes (hover:, dark:, group-hover/x:) then the utility. */
const token = (utility: string): RegExp =>
  new RegExp(`(?<![\\w-])((?:[\\w\\-/\\[\\]=.]+:)*)${utility}(?![\\w-])`, 'g')

/** Any utility on the hover-fill colour: `text-accent`, `bg-accent`,
 *  `fill-accent`, `border-b-accent`, … The prefix crosses the utility's
 *  own hyphens but not a leading one, so the CSS token's own name
 *  (`'--accent'`, named by the preview route's swatch list) does not
 *  read as a class. The suffixed colours (`-accent-strong`,
 *  `-accent-foreground`) carry a suffix after `accent` and fall outside
 *  the match — they are token colours of their own. */
const accentUses = token('[A-Za-z_][\\w-]*-accent')

/** Any utility on the non-existent accent-soft colour. A word character
 *  before the colour (`bg-accent-soft`) is required, so the CSS token's
 *  own name (`'--accent-soft'`, named by the preview route's swatch list)
 *  does not read as a class. */
const softAccentUses = /(?<![\w-])((?:[\w\-/[\]=.]+:)*)[\w]+-accent-soft(?![\w-])/g

/** The interaction states behind which the hover fill may appear; a
 *  named scope (`group-hover/row:`) counts by its state, and the
 *  group-/peer- passthroughs by the state they pass through. */
const interactionStates = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active'])

const isInteraction = (variant: string): boolean =>
  interactionStates.has((variant.split('/')[0] ?? variant).replace(/^(?:group|peer)-/, ''))

/** The one allowed form: `bg-accent` with an interaction variant in the
 *  chain, so the fill only ever manifests mid-interaction. */
function isHoverFill(match: RegExpMatchArray): boolean {
  if (match[0].split(':').at(-1) !== 'bg-accent') return false
  const variants = (match[1] ?? '').split(':').filter(Boolean)
  return variants.some(isInteraction)
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

/** The rule over one source string — the file scan and the class-table
 *  tests below read the same logic, so a regex regression cannot stay
 *  green. */
function violations(source: string): string[] {
  return [
    ...violationsOf(source, accentUses, (match) => !isHoverFill(match)),
    ...violationsOf(source, softAccentUses, () => true),
  ]
}

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    // test files are skipped: a component test may legitimately name the
    // classes it forbids
    return /\.(?:tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}

describe('the hover-fill accent role in feature code', () => {
  const sources = featureDirs.flatMap((dir) =>
    walk(dir).map((path) => ({ path, source: readFileSync(path, 'utf8') })),
  )

  it('appears only as the interaction background', () => {
    const found = sources.flatMap(({ path, source }) =>
      violations(source).map((at) => `${path}:${at}`),
    )
    expect(
      found,
      'the hover fill is only a hover/focus/active background: text and everything else take a token colour — the brand accent is text-primary, the soft tint is bg-primary-soft',
    ).toEqual([])
  })

  describe.each([
    { cls: 'hover:bg-accent', allowed: true },
    { cls: 'focus:bg-accent', allowed: true },
    { cls: 'group-hover/row:bg-accent', allowed: true },
    { cls: 'peer-focus:bg-accent', allowed: true },
    { cls: 'group-active:bg-accent', allowed: true },
    { cls: 'dark:focus-visible:bg-accent', allowed: true },
    { cls: 'md:hover:bg-accent', allowed: true },
    { cls: 'bg-accent-strong', allowed: true },
    { cls: 'text-accent-foreground', allowed: true },
    { cls: 'bg-accent', allowed: false },
    { cls: 'md:bg-accent', allowed: false },
    { cls: 'bg-accent/50', allowed: false },
    { cls: 'text-accent', allowed: false },
    { cls: 'hover:text-accent', allowed: false },
    { cls: 'fill-accent', allowed: false },
    { cls: 'border-b-accent', allowed: false },
    { cls: 'divide-accent', allowed: false },
    { cls: 'from-accent', allowed: false },
    { cls: 'accent-accent', allowed: false },
    { cls: 'bg-accent-soft', allowed: false },
  ])('the class $cls', ({ cls, allowed }) => {
    const source = `className="${cls}"`
    if (allowed) {
      it('is accepted', () => expect(violations(source)).toEqual([]))
    } else {
      it('is refused', () => expect(violations(source)).not.toEqual([]))
    }
  })
})
