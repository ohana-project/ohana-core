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
 * underlines, carets, gradient stops). A variant chain qualifies when any
 * of its variants is an interaction state, so `hover:not-focus:bg-accent`
 * is allowed too. The design system itself (src/ui) is exempt where the
 * README prescribes an fg-soft fill at rest (the count badge, the
 * switch's off track); state highlights such as data-[state=open] or
 * aria-selected belong there too.
 *
 * The same scan refuses `-accent-soft` utilities: `accent-soft` is a CSS
 * token, not a Tailwind colour, so `bg-accent-soft` compiles to nothing
 * and silently drops the fill — the soft accent tint's utility is
 * `bg-primary-soft`. The scan reads whitespace-separated words as class
 * tokens once their attribute or object-key syntax is stripped, so a
 * bare identifier that ends in `-accent` — a test id, a map key — is
 * refused too. A token whose utility sits inside a closing bracket
 * (`cn(['text-accent'])`) is still read; the one escape is a word that
 * ends inside an arbitrary opacity modifier's brackets, which the parser
 * cannot see and lets through.
 */

/** The directories whose code renders screens (architecture.md, web layout). */
const featureDirs = ['src/features', 'src/app', 'src/routes']

/** The interaction states behind which the hover fill may appear; a
 *  named scope (`group-hover/row:`) counts by its state, and the
 *  group-/peer- passthroughs by the state they pass through. */
const interactionStates = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active'])

const isInteraction = (variant: string): boolean => {
  const name = variant.split('/')[0] ?? variant
  return interactionStates.has(name.replace(/^(?:group|peer)-/, ''))
}

/** A class token split on the colons that sit at bracket depth 0, so the
 *  colons inside arbitrary and Not-variant brackets (`[&:hover]`,
 *  `not-[:focus]`, `data-[state=open]`) never split a variant. */
function segmentsOf(cls: string): string[] {
  const segments: string[] = []
  let current = ''
  let depth = 0
  for (const ch of cls) {
    if (ch === '[') depth += 1
    if (ch === ']') depth = Math.max(0, depth - 1)
    if (ch === ':' && depth === 0) {
      segments.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  segments.push(current)
  return segments
}

/** The utility shape: a name, an optional opacity modifier — plain,
 *  arbitrary-bracketed or function form — and an important mark on
 *  either side. Anything else (a prose word, a URL, a CSS custom
 *  property, an attribute value) is not read as a class. */
const utilityShape = /^!?[a-z][\w-]*(?:\/(?:[\d.%]+|\[[^\]]*\]|\([^()]*\)))?!?$/

/** Whether one class token breaks the rule. The hover-fill colour is
 *  `bg-accent` behind an interaction variant and nothing else: every
 *  other utility on it (`text-accent`, `fill-accent`,
 *  `border-b-accent`, `divide-accent`, `from-accent`, …) is refused, as
 *  is the non-existent `accent-soft` colour and the sidebar's own
 *  `sidebar-accent` role, which belongs to the sidebar shell in src/ui.
 *  The suffixed token colours (`-accent-strong`, `-accent-foreground`)
 *  do not end in `-accent` and are their own business. */
function breaksRule(cls: string): boolean {
  const segments = segmentsOf(cls)
  const stripped = (segments[segments.length - 1] ?? '').replace(/^!/, '').replace(/!$/, '')
  const base = stripped.split('/')[0] ?? ''
  if (!utilityShape.test(stripped)) return false
  if (base.endsWith('-accent-soft')) return true
  if (!base.endsWith('-accent')) return false
  if (base === 'bg-accent') {
    const variants = segments.slice(0, -1)
    return !variants.some(isInteraction)
  }
  return true
}

/** Syntax around a class token in source: the attribute or object-key
 *  punctuation, and everything that can follow a class but never close
 *  an arbitrary modifier (a closer bracket or paren is handled by
 *  balance in tokenOf, so `bg-accent/[0.5]` and `bg-accent/(--o)` keep
 *  their modifiers). */
const attributePrefix = /^[a-zA-Z-]+={1,2}/
const leadingJunk = /^[^a-z0-9_.!(/%-]+/i
const trailingJunk = /["'`}{,:;>+]+$/

/** The class token a source word holds, with its syntax stripped. A
 *  trailing `)` or `]` is stripped only when it closes a bracket the
 *  utility is not inside (`cn(['text-accent'])`), never when it closes
 *  an arbitrary modifier (`bg-accent/[0.5]`). */
function tokenOf(word: string): string {
  let token = word.replace(attributePrefix, '').replace(leadingJunk, '')
  for (;;) {
    const last = token.slice(-1)
    if (last === ')' || last === ']') {
      const opener = last === ')' ? '(' : '['
      if (token.slice(0, -1).includes(opener)) return token
      token = token.slice(0, -1)
      continue
    }
    const stripped = token.replace(trailingJunk, '')
    if (stripped === token) return token
    token = stripped
  }
}

/** line:token pairs for every class token in the source that breaks the
 *  rule — the file scan and the tables below read the same logic, so a
 *  parsing regression cannot stay green. */
function violations(source: string): string[] {
  const found: string[] = []
  source.split('\n').forEach((line, index) => {
    for (const word of line.split(/\s+/)) {
      const cls = tokenOf(word)
      if (cls !== '' && breaksRule(cls)) found.push(`${index + 1}:${cls}`)
    }
  })
  return found
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
    { cls: 'hover:bg-accent/50', allowed: true },
    { cls: 'hover:bg-accent/[0.5]', allowed: true },
    { cls: 'group-data-[x="y"]:hover:bg-accent', allowed: true },
    { cls: 'bg-accent-strong', allowed: true },
    { cls: 'text-accent-foreground', allowed: true },
    { cls: "'--accent'", allowed: true },
    { cls: "'--accent-soft'", allowed: true },
    { cls: 'var(--color-accent)', allowed: true },
    { cls: 'bg-accent', allowed: false },
    { cls: 'md:bg-accent', allowed: false },
    { cls: 'bg-accent/50', allowed: false },
    { cls: 'bg-accent/[0.5]', allowed: false },
    { cls: 'bg-accent/(--o)', allowed: false },
    { cls: '!bg-accent', allowed: false },
    { cls: 'bg-accent!', allowed: false },
    { cls: 'text-accent', allowed: false },
    { cls: 'hover:text-accent', allowed: false },
    { cls: 'text-accent/[0.5]', allowed: false },
    { cls: 'fill-accent', allowed: false },
    { cls: 'border-b-accent', allowed: false },
    { cls: 'divide-accent', allowed: false },
    { cls: 'from-accent', allowed: false },
    { cls: 'accent-accent', allowed: false },
    { cls: 'bg-accent-soft', allowed: false },
    { cls: 'hover:bg-sidebar-accent', allowed: false },
    { cls: 'not-hover:bg-accent', allowed: false },
    { cls: 'data-[state=open]:bg-accent', allowed: false },
    { cls: 'data-[state="open"]:bg-accent', allowed: false },
    { cls: '[&:hover]:bg-accent', allowed: false },
    { cls: 'has-[:focus]:bg-accent', allowed: false },
    { cls: 'not-[:hover:focus]:bg-accent', allowed: false },
    { cls: 'has-[:hover:focus]:bg-accent', allowed: false },
    { cls: 'swatch-accent', allowed: false },
  ])('the class $cls', ({ cls, allowed }) => {
    const source = `className="${cls}"`
    if (allowed) {
      it('is accepted', () => expect(violations(source)).toEqual([]))
    } else {
      it('is refused', () => expect(violations(source)).not.toEqual([]))
    }
  })

  describe.each([
    { line: `className="mt-0.5 size-4 text-accent" />` },
    { line: `<p className="text-sm text-accent">` },
    { line: `className={\`size-5 \${on ? 'fill-current text-accent' : ''}\`}` },
    { line: `cn('flex', on && 'text-accent')` },
    { line: `['bg-accent', 'flex']` },
    { line: `{ 'text-accent': on }` },
    { line: `cn(['flex', 'text-accent'])` },
    { line: `className="text-accent">` },
  ])('the source line $line', ({ line }) => {
    it('refuses the accent token it holds', () => {
      expect(violations(line)).not.toEqual([])
    })
  })

  it('the source line with only the interaction background is accepted', () => {
    expect(violations('className="flex hover:bg-accent">')).toEqual([])
  })
})
